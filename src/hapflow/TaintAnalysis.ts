
import { CALLBACK_METHOD_NAME, Scene } from "../arkanalyzer";
import { DataflowProblem, FlowFunction } from "../arkanalyzer";
import { Local } from "../arkanalyzer";
import { Value } from "../arkanalyzer";
import { ArkAssignStmt, ArkInvokeStmt, ArkReturnStmt, ArkThrowStmt, Stmt } from "../arkanalyzer";
import { ArkMethod } from "../arkanalyzer";
import { Constant } from "../arkanalyzer";
import { AbstractRef, ArkArrayRef, ArkCaughtExceptionRef, ArkInstanceFieldRef, ArkStaticFieldRef, ClosureFieldRef, GlobalRef } from "../arkanalyzer";
import { DataflowSolver } from "./DataflowSolver";
import { AbstractInvokeExpr, ArkAwaitExpr, ArkInstanceInvokeExpr, ArkPtrInvokeExpr, ArkStaticInvokeExpr } from "../arkanalyzer";
import { ArrayType, ClassType, ClosureType, FunctionType, LexicalEnvType, UnclearReferenceType, UndefinedType } from "../arkanalyzer";
import { MethodSignature } from "../arkanalyzer";
import { PointerAnalysis } from "../arkanalyzer";
import * as fs from 'fs';
import { Source, validateSourceRuleObject } from "./Source";
import { getPossibleRelatedNodes, INTERNAL_SINK_METHOD_toString, LOG_SINK_METHODS, Json2ArkMethod, Json2ArkMethodSignature, LocalEqual, localDeclaredInCfg, propagateFact, RefEqual, TaintOutcomeEqual, ValueDependsOn, ValueEqual, getThisAssignStmt, callSource, getRecallMethodInParam, isClosureLocal, getClosures, getResolvedCallbackParameters } from "./Util";
import { TaintCarrierState, TaintFact } from "./TaintFact";
import { MultiRef } from "./MuiltiRef";
import { Logger, LOG_MODULE_TYPE } from "../arkanalyzer";
import { ArkThisRef } from "../arkanalyzer";
import {
    isPlatformTaskCallbackSignature,
    isPromiseTypeText,
    SdkPromiseContractResolver,
} from "./SdkContinuationContracts";

// @ts-ignore - ClassCategory may need deep import
import { ClassCategory } from "../arkanalyzer/core/model/ArkClass";
// @ts-ignore - INSTANCE_INIT may need deep import
import { INSTANCE_INIT_METHOD_NAME } from "../arkanalyzer";

const logger = Logger.getLogger(LOG_MODULE_TYPE.ARKANALYZER, 'HapFlow');
const SDK_PATH_PLACEHOLDER = '${OPENHARMONY_SDK_PATH}';
const HMS_SDK_PATH_PLACEHOLDER = '${HMS_SDK_PATH}';

function irRecoveryEnabled(): boolean {
    return process.env.ARKPRISM_DISABLE_IR_RECOVERY !== '1';
}

function continuationFlowEnabled(): boolean {
    return process.env.ARKPRISM_DISABLE_CONTINUATION_FLOW !== '1';
}

export type SdkContinuationEdgeKind = 'source_callback' | 'framework_event' | 'framework_task' | 'promise_fulfillment';

const ARKUI_FRAMEWORK_EVENT_NAMES = new Set(CALLBACK_METHOD_NAME);

export function isArkUIFrameworkEventSignature(
    methodName: string,
    declaringClassName: string
): boolean {
    return declaringClassName === '' && ARKUI_FRAMEWORK_EVENT_NAMES.has(methodName);
}

export function callbackMethodSignatureMatches(
    argumentSignature: MethodSignature,
    callbackMethod: ArkMethod,
    resolvedMethod?: ArkMethod | null
): boolean {
    if (resolvedMethod === callbackMethod) return true;
    return argumentSignature.toString() === callbackMethod.getSignature().toString();
}

function normalizeSdkPathForTypeImports(sdkPath?: string): string {
    return (sdkPath || '').replace(/\\/g, '/').replace(/\/+$/, '');
}

function expandSdkPathPlaceholders(value: unknown, sdkPath?: string): unknown {
    if (typeof value === 'string') {
        const normalizedSdkPath = normalizeSdkPathForTypeImports(sdkPath);
        const normalizedHmsSdkPath = normalizeSdkPathForTypeImports(process.env.HMS_SDK_PATH);
        let expanded = normalizedSdkPath ? value.split(SDK_PATH_PLACEHOLDER).join(normalizedSdkPath) : value;
        expanded = normalizedHmsSdkPath ? expanded.split(HMS_SDK_PATH_PLACEHOLDER).join(normalizedHmsSdkPath) : expanded;
        return expanded;
    }
    if (Array.isArray(value)) {
        return value.map(item => expandSdkPathPlaceholders(item, sdkPath));
    }
    if (value && typeof value === 'object') {
        const expanded: Record<string, unknown> = {};
        for (const [key, child] of Object.entries(value)) {
            expanded[key] = expandSdkPathPlaceholders(child, sdkPath);
        }
        return expanded;
    }
    return value;
}

function loadRuleObjects(filePath: string, sdkPath?: string): any[] {
    const data = fs.readFileSync(filePath, 'utf-8');
    const objects = JSON.parse(data);
    return expandSdkPathPlaceholders(objects, sdkPath) as any[];
}

function canonicalizeFieldAccess(ref: ArkInstanceFieldRef): MultiRef | undefined {
    const fields = [ref.getFieldSignature()];
    let base = ref.getBase();
    const visited = new Set<Local>();

    while (!visited.has(base)) {
        visited.add(base);
        const declaringStmt = base.getDeclaringStmt();
        if (!(declaringStmt instanceof ArkAssignStmt)) break;
        const rightOp = declaringStmt.getRightOp();
        if (!(rightOp instanceof ArkInstanceFieldRef)) break;
        fields.unshift(rightOp.getFieldSignature());
        base = rightOp.getBase();
    }

    return fields.length > 1 ? new MultiRef(base, fields) : undefined;
}

export function getParameterInstanceForArgument(method: ArkMethod, argumentIndex: number): Value | undefined {
    if (!Number.isInteger(argumentIndex) || argumentIndex < 0) return undefined;

    const parameters = method.getParameters();
    const parameterOffset = parameters[0]?.getType() instanceof LexicalEnvType ? 1 : 0;
    return method.getParameterInstances()[argumentIndex + parameterOffset];
}

export function shouldPropagateErrorPayload(
    isZeroFact: boolean,
    arguments_: Value[],
    dataValue: Value
): boolean {
    return !isZeroFact && arguments_.some(argument => ValueDependsOn(argument, dataValue));
}

export class TaintAnalysisChecker extends DataflowProblem<TaintFact> {
    private zeroValue: TaintFact;
    private entryPoint: Stmt;
    private entryMethod: ArkMethod;
    private scene: Scene;
    private sources: Map<string, Source> = new Map();
    private sinks: MethodSignature[] = [];
    private sinkMatchers: Array<{ method: string, owners: string[] }> = [];
    private santizations: MethodSignature[] = [];
    private pointerAnalysis: PointerAnalysis | undefined;
    private detectOutcome: TaintFact[] = [];
    private promiseContractResolver: SdkPromiseContractResolver;

    // Budget options for callback analysis
    private callbackBudgetOptions = {
        maxMethods: 100000,
        maxSources: 5000,
        maxStates: 10000,
        maxPathLen: 100
    };

    constructor(stmt: Stmt, method: ArkMethod, pta?: PointerAnalysis) {
        super();
        this.zeroValue = new TaintFact(new Constant('zeroValue', UndefinedType.getInstance()));
        this.entryPoint = stmt;
        this.entryMethod = method;
        this.scene = method.getDeclaringArkFile().getScene();
        this.promiseContractResolver = new SdkPromiseContractResolver(this.scene);
        this.pointerAnalysis = pta;
    }

    private createSourceFact(value: Value, statement: Stmt, source: Source): TaintFact {
        const sourceKind = source.rule.sourceKind;
        if (!sourceKind) {
            throw new Error(`Source rule lacks source_kind: ${source.methodSignature.toString()}`);
        }
        const returnType = source.rule.returnType || '';
        const carrierState: TaintCarrierState = source.sourceType === 'callback'
            ? 'callback_payload'
            : source.sourceType === 'ArgIn'
                ? 'framework_argument'
                : /^\s*Promise\s*</.test(returnType)
                    ? 'promise_payload'
                    : 'direct_value';
        return new TaintFact(value, [statement], TaintFact.createSourceEvidence(
            statement,
            sourceKind,
            source.sourceType,
            source.methodSignature.toString(),
            source.rule,
            source.sourceIndex,
            source.callbackIndex
        ), [], carrierState);
    }

    /**
     * Set budget options for callback analysis.
     */
    public setCallbackBudgetOptions(options: {
        maxMethods?: number;
        maxSources?: number;
        maxStates?: number;
        maxPathLen?: number;
    }): void {
        if (options.maxMethods !== undefined) this.callbackBudgetOptions.maxMethods = options.maxMethods;
        if (options.maxSources !== undefined) this.callbackBudgetOptions.maxSources = options.maxSources;
        if (options.maxStates !== undefined) this.callbackBudgetOptions.maxStates = options.maxStates;
        if (options.maxPathLen !== undefined) this.callbackBudgetOptions.maxPathLen = options.maxPathLen;
    }

    /**
     * Get callback budget options.
     */
    public getCallbackBudgetOptions() {
        return { ...this.callbackBudgetOptions };
    }

    /**
     * Get current analysis stats for logging.
     */
    public getStats(): { budgetExceeded: boolean; edgesProcessed: number } {
        return { budgetExceeded: false, edgesProcessed: 0 };
    }

    /**
     * Direct analysis for SDK callback data flows.
     * This complements IFDS by analyzing methods that may not be reachable from DummyMain
     * but contain source API calls with callbacks.
     */
    public analyzeCallbackDataFlows(): void {
        // Bounded callback analysis - uses conservative settings to prevent OOM
        const MAX_METHODS = this.callbackBudgetOptions.maxMethods;
        const MAX_SOURCES = this.callbackBudgetOptions.maxSources;
        const MAX_STATES = this.callbackBudgetOptions.maxStates;
        const MAX_PATH_LEN = this.callbackBudgetOptions.maxPathLen;

        console.log(`[HAPFLOW] Running bounded callback analysis...`);
        console.log(`[HAPFLOW]   maxMethods=${MAX_METHODS}, maxSources=${MAX_SOURCES}, maxStates=${MAX_STATES}, maxPathLen=${MAX_PATH_LEN}`);

        let methodCount = 0;
        let sourceCount = 0;
        let stateCount = 0;

        // Collect all callback-type sources first
        const callbackSources: Array<{ method: ArkMethod, stmt: Stmt, invokeExpr: AbstractInvokeExpr, source: Source }> = [];
        const returnSources: Array<{ method: ArkMethod, stmt: Stmt, invokeExpr: AbstractInvokeExpr, source: Source }> = [];

        for (const method of this.scene.getMethods()) {
            const fileName = method.getDeclaringArkFile().getName();
            if (fileName.startsWith('api/') || fileName.includes("build") || fileName.includes("cache") ||
                fileName.includes("node_modules") || fileName.includes("oh_modules") ||
                fileName.includes(".preview")) {
                continue;
            }

            if (methodCount++ >= MAX_METHODS) {
                console.log(`[HAPFLOW] Callback analysis: reached method limit ${MAX_METHODS}`);
                break;
            }

            const cfg = method.getCfg();
            if (!cfg) continue;

            for (const block of cfg.getBlocks()) {
                for (const stmt of block.getStmts()) {
                    if (stmt.containsInvokeExpr()) {
                        const invokeExpr = stmt.getInvokeExpr();
                        if (!invokeExpr) continue;

                        const source = callSource(invokeExpr, this.sources, this.scene, this.pointerAnalysis);
                        if (source && source.sourceType === 'callback') {
                            callbackSources.push({ method, stmt, invokeExpr, source });
                        } else if (source && source.sourceType === 'return' && stmt instanceof ArkAssignStmt) {
                            returnSources.push({ method, stmt, invokeExpr, source });
                        }
                    }
                }
            }
        }

        console.log(`[HAPFLOW]   Found ${callbackSources.length} callback source invocations`);
        console.log(`[HAPFLOW]   Found ${returnSources.length} return source invocations`);

        if (callbackSources.length === 0 && returnSources.length === 0) {
            console.log(`[HAPFLOW] Callback analysis: no direct sources found`);
            return;
        }

        // Process callback sources with budget limits
        for (const { method, stmt, invokeExpr, source } of callbackSources) {
            if (sourceCount++ >= MAX_SOURCES) {
                console.log(`[HAPFLOW] Callback analysis: reached source limit ${MAX_SOURCES}`);
                break;
            }

            try {
                this.analyzeCallbackSourceSafe(method, stmt, invokeExpr, source, MAX_STATES, MAX_PATH_LEN, () => {
                    stateCount++;
                    return stateCount <= MAX_STATES * 10;
                });
            } catch (e) {
                console.log(`[HAPFLOW]   Callback source failed: ${e}`);
            }
        }

        for (const { method, stmt, invokeExpr, source } of returnSources) {
            if (sourceCount++ >= MAX_SOURCES) {
                console.log(`[HAPFLOW] Callback analysis: reached source limit ${MAX_SOURCES}`);
                break;
            }

            try {
                this.analyzePromiseChaining(method, stmt, invokeExpr, source);
            } catch (e) {
                console.log(`[HAPFLOW]   Return source failed: ${e}`);
            }
        }

        console.log(`[HAPFLOW] Callback analysis complete: sources=${sourceCount}, states=${stateCount}, flows=${this.detectOutcome.length}`);
    }

    /**
     * Safe version of analyzeCallbackSource with budget checks.
     */
    private analyzeCallbackSourceSafe(
        method: ArkMethod,
        stmt: Stmt,
        invokeExpr: AbstractInvokeExpr,
        source: Source,
        maxStates: number,
        maxPathLen: number,
        shouldContinue: () => boolean
    ): number {
        const args = invokeExpr.getArgs();
        if (source.callbackIndex < 0 || source.callbackIndex >= args.length) return 0;

        const callbackArg = args[source.callbackIndex];
        const callbackArgType = callbackArg.getType();

        let callbackMethod: ArkMethod | null = null;

        // Approach 1: FunctionType
        if (callbackArgType instanceof FunctionType) {
            const callbackSig = callbackArgType.getMethodSignature();
            callbackMethod = method.getDeclaringArkClass().getMethod(callbackSig);
        }

        // Approach 2: ClosureType
        if (!callbackMethod && callbackArgType && callbackArgType.constructor.name === 'ClosureType') {
            try {
                const typeStr = callbackArgType.toString();
                const match = typeStr.match(/closures:\s*([^\s,]+)/);
                if (match) {
                    const closureName = match[1].trim();
                    const declaringClass = method.getDeclaringArkClass();
                    for (const m of declaringClass.getMethods()) {
                        if (m.getName() === closureName) {
                            callbackMethod = m;
                            break;
                        }
                    }
                }
            } catch { /* ignore */ }
        }

        if (!callbackMethod && callbackArg instanceof Local) {
            callbackMethod = this.findLambdaMethodForLocal(method, callbackArg);
        }

        if (!callbackMethod) {
            return 0;
        }

        const sourceParam = this.getConfiguredCallbackSourceParameter(callbackMethod, source);
        if (!sourceParam) return 0;

        const fact = this.createSourceFact(sourceParam, stmt, source);
        const prevOutcomeCount = this.detectOutcome.length;
        this.traceCallbackParamDataFlowSafe(
            callbackMethod,
            sourceParam,
            fact,
            maxStates,
            maxPathLen,
            shouldContinue
        );
        return this.detectOutcome.length - prevOutcomeCount;
    }

    /**
     * Safe version of traceCallbackParamDataFlow with budget checks.
     */
    private traceCallbackParamDataFlowSafe(
        method: ArkMethod,
        startVar: Value,
        startFact: TaintFact,
        maxStates: number,
        maxPathLen: number,
        shouldContinue: () => boolean
    ): void {
        const cfg = method.getCfg();
        if (!cfg) return;

        const visited = new Set<string>();
        const worklist: Array<{ var: Value, fact: TaintFact }> = [{ var: startVar, fact: startFact }];

        // Pre-collect all statements for efficiency
        let allStmts: Stmt[] = [];
        if (cfg) {
            for (const block of cfg.getBlocks()) {
                allStmts.push(...block.getStmts());
            }
        }

        // Debug: show all statements and their structure
        const startVarStr = startVar.toString();

        // Debug: print all statements that contain the start variable
        for (const s of allStmts) {
            const stmtStr = s.toString();
            if (stmtStr.includes(startVarStr)) {
            }
        }

        // Debug: print all invoke/sink statements
        for (const s of allStmts) {
            if (s.containsInvokeExpr()) {
                const invokeExpr = s.getInvokeExpr()!;
                const methodName = invokeExpr.getMethodSignature().getMethodSubSignature().getMethodName();
                if (this.callSink(invokeExpr)) {
                    const args = invokeExpr.getArgs();
                    const argStrs = args.map(a => a.toString());
                }
            }
        }

        while (worklist.length > 0) {
            if (!shouldContinue()) {
                break;
            }

            const { var: currentVar, fact: currentFact } = worklist.pop()!;
            // Use method signature + variable string for visited key
            const key = method.getSignature().toString() + '|' + currentVar.toString()
                + '|' + currentFact.getSourceIdentityKey();
            if (visited.has(key)) continue;
            visited.add(key);

            // Check path length budget
            if (currentFact.getPath().length > maxPathLen) {
                continue;
            }

            // Check for sink usage
            for (const s of allStmts) {
                if (!s.containsInvokeExpr()) continue;
                const invokeExpr = s.getInvokeExpr();
                if (!invokeExpr) continue;

                if (this.callSink(invokeExpr)) {
                    const sinkMethodName = invokeExpr.getMethodSignature().getMethodSubSignature().getMethodName();
                    const sinkArgs = invokeExpr.getArgs();

                    for (let argIdx = 0; argIdx < sinkArgs.length; argIdx++) {
                        const arg = sinkArgs[argIdx];
                        if (ValueDependsOn(arg, currentVar)) {
                            const sinkFact = currentFact.copyForValue(currentVar, s);

                            this.appendDistinctOutcome(sinkFact);
                        }
                    }
                }
            }

            // Propagate through assignments
            for (const s of allStmts) {
                if (!(s instanceof ArkAssignStmt)) continue;
                const leftOp = s.getLeftOp();
                const rightOp = s.getRightOp();

                if (ValueDependsOn(rightOp, currentVar) && leftOp instanceof Local) {
                    const newFact = currentFact.copyForValue(leftOp, s);
                    worklist.push({ var: leftOp, fact: newFact });
                }
            }
        }
    }

    /**
     * Analyze callback-style source API: getData((err, data) => { ... })
     * For callback-style sources, we need to find the callback lambda that is passed as an argument.
     * The callback parameter contains the actual callback implementation, not the callback type declaration.
     */
    private analyzeCallbackSource(method: ArkMethod, stmt: Stmt, invokeExpr: AbstractInvokeExpr, source: Source): void {
        const args = invokeExpr.getArgs();
        if (source.callbackIndex < 0 || source.callbackIndex >= args.length) return;

        const callbackArg = args[source.callbackIndex];
        const callbackArgType = callbackArg.getType();

        // The callbackArg is typically a Local (variable reference) or a reference to an inline lambda
        // We need to find the method that implements this callback

        let callbackMethod: ArkMethod | null = null;

        // Approach 1: If callbackArgType is a FunctionType, get the method signature
        if (callbackArgType instanceof FunctionType) {
            const callbackSig = callbackArgType.getMethodSignature();
            callbackMethod = method.getDeclaringArkClass().getMethod(callbackSig);
        }

        // Approach 2: If callbackArgType is a ClosureType, extract the lambda method from closures field
        if (!callbackMethod && callbackArgType instanceof ClosureType) {
            const typeStr = callbackArgType.toString();
            const match = typeStr.match(/closures:\s*(.+)/);
            if (match) {
                const closureSigStr = match[1].trim();
                callbackMethod = method.getDeclaringArkClass().getMethod(closureSigStr as unknown as MethodSignature);
            }
        }

        // Approach 3: If callbackArg is a Local, try to find its definition and get the lambda method
        if (!callbackMethod && callbackArg instanceof Local) {
            callbackMethod = this.findLambdaMethodForLocal(method, callbackArg);
        }

        // Approach 4: Try findCallbackMethod
        if (!callbackMethod) {
            callbackMethod = this.findCallbackMethod(method, invokeExpr);
        }

        if (!callbackMethod) {
            return;
        }

        const sourceParam = this.getConfiguredCallbackSourceParameter(callbackMethod, source);
        if (!sourceParam) return;
        const fact = this.createSourceFact(sourceParam, stmt, source);
        this.traceCallbackParamDataFlow(callbackMethod, sourceParam, fact);
    }

    private getConfiguredCallbackSourceParameter(callbackMethod: ArkMethod, source: Source): Local | null {
        const paramInstances = callbackMethod.getParameterInstances();
        if (!paramInstances || paramInstances.length === 0 || source.sourceIndex < 0) {
            return null;
        }
        const parameters = callbackMethod.getParameters();
        const lexicalOffset = parameters.length > 0
            && parameters[0].getType() instanceof LexicalEnvType
            ? 1
            : 0;
        const parameter = paramInstances[source.sourceIndex + lexicalOffset];
        return parameter instanceof Local ? parameter : null;
    }

    /**
     * Find the lambda method that assigns to a given Local variable
     * e.g., for: %AM9$%AM7$requestPermissions = new SomeLambda()
     * Find the lambda method referenced by the Local
     */
    private findLambdaMethodForLocal(method: ArkMethod, local: Local): ArkMethod | null {
        const cfg = method.getCfg();
        if (!cfg) return null;

        // Find the statement where the local is assigned
        for (const block of cfg.getBlocks()) {
            for (const s of block.getStmts()) {
                if (s instanceof ArkAssignStmt) {
                    const leftOp = s.getLeftOp();
                    if (leftOp instanceof Local && leftOp.toString() === local.toString()) {
                        const rightOp = s.getRightOp();
                        // Check if it's a new expression or a reference to a lambda
                        if (rightOp instanceof ArkInstanceInvokeExpr) {
                            // Could be a constructor call
                            const methodSig = rightOp.getMethodSignature();
                            const type = rightOp.getType();
                            if (type && type instanceof ClosureType) {
                                // This is a closure - try to find the lambda method
                                const typeStr = type.toString();
                                const match = typeStr.match(/closures:\s*(.+)/);
                                if (match) {
                                    const closureSigStr = match[1].trim();
                                    return method.getDeclaringArkClass().getMethod(closureSigStr as unknown as MethodSignature);
                                }
                            }
                        }
                    }
                }
            }
        }
        return null;
    }

    /**
     * Analyze Promise-style source API: selectContacts().then(info => { ... })
     * or async/await: const info = await selectContacts()
     */
    private analyzePromiseChaining(method: ArkMethod, stmt: Stmt, invokeExpr: AbstractInvokeExpr, source: Source): void {
        // Pattern 1: API().then(callback) or promise.then(callback).
        if (stmt instanceof ArkAssignStmt) {
            const resultVar = stmt.getDef();
            if (resultVar instanceof Local) {
                this.analyzeThenChaining(method, resultVar, stmt, source);
                this.analyzeAwaitChaining(method, resultVar, stmt, source);
            }
        }

        // Pattern 2: const value = await API(). The fallback is deliberately
        // limited to an explicit await; ordinary synchronous return sources are
        // handled by IFDS so flow-sensitive kills and reachability are preserved.
        if (stmt instanceof ArkAssignStmt) {
            const leftOp = stmt.getLeftOp();
            const rightOp = stmt.getRightOp();
            if (rightOp instanceof ArkAwaitExpr && leftOp instanceof Local) {
                const promise = rightOp.getPromise();
                const sourceCheck = promise instanceof AbstractInvokeExpr
                    ? callSource(promise, this.sources, this.scene, this.pointerAnalysis)
                    : undefined;
                if (promise === invokeExpr || sourceCheck?.sourceType === 'return') {
                    const fact = this.createSourceFact(leftOp, stmt, sourceCheck || source);
                    this.traceReturnedValueDataFlow(method, leftOp, fact);
                }
            }
        }
    }

    private analyzeAwaitChaining(
        method: ArkMethod,
        promiseVar: Local,
        sourceStmt: Stmt,
        source: Source
    ): void {
        const cfg = method.getCfg();
        if (!cfg) return;

        for (const block of cfg.getBlocks()) {
            for (const stmt of block.getStmts()) {
                if (!(stmt instanceof ArkAssignStmt)) continue;
                const leftOp = stmt.getLeftOp();
                const rightOp = stmt.getRightOp();
                if (!(leftOp instanceof Local) || !(rightOp instanceof ArkAwaitExpr)) continue;
                if (!ValueEqual(rightOp.getPromise(), promiseVar)) continue;

                const fact = this.createSourceFact(leftOp, sourceStmt, source);
                fact.addPath(stmt);
                this.traceReturnedValueDataFlow(method, leftOp, fact);
            }
        }
    }

    /**
     * Analyze chained .then() calls where the base is itself an invoke returning a Promise.
     * Pattern: sourceApi().then(callback) - no intermediate variable assignment.
     */
    private analyzeChainedThenInvoke(method: ArkMethod, stmt: Stmt, invokeExpr: AbstractInvokeExpr): void {
        // Check if this is a .then() call
        const methodName = invokeExpr.getMethodSignature().getMethodSubSignature().getMethodName();
        if (methodName !== 'then') return;

        if (!(invokeExpr instanceof ArkInstanceInvokeExpr)) return;

        const base = invokeExpr.getBase();

        // Case 1: Direct chaining - sourceApi().then(callback)
        if (base instanceof AbstractInvokeExpr) {
            const source = callSource(base, this.sources, this.scene, this.pointerAnalysis);
            if (source && source.sourceType === 'return') {
                this.processThenCallback(method, stmt, invokeExpr, source, stmt);
            }
            return;
        }

        // Case 2: Intermediate variable - let x = sourceApi(); x.then(callback)
        if (!(base instanceof Local)) return;

        const sourceCall = this.findSourceInvokeForVariable(method, base);
        if (!sourceCall) return;

        const source = callSource(sourceCall.invokeExpr, this.sources, this.scene, this.pointerAnalysis);
        if (!source || source.sourceType !== 'return') return;

        this.processThenCallback(method, stmt, invokeExpr, source, sourceCall.statement);
    }

    /**
     * Process the callback of a .then() call and trace data flow.
     */
    private processThenCallback(
        method: ArkMethod,
        stmt: Stmt,
        invokeExpr: AbstractInvokeExpr,
        source: Source,
        sourceStmt: Stmt
    ): void {
        const args = invokeExpr.getArgs();
        if (args.length === 0) return;

        const callbackArg = args[0];
        const callbackArgType = callbackArg.getType();

        // For .then() callbacks with ClosureType, we need special handling
        // because the FunctionType signature might point to the wrong method
        let callbackMethod: ArkMethod | null = null;

        // Try FunctionType first
        if (callbackArgType instanceof FunctionType) {
            const callbackSig = callbackArgType.getMethodSignature();
            callbackMethod = method.getDeclaringArkClass().getMethod(callbackSig);
            if (callbackMethod) {
                const params = callbackMethod.getParameters();
                const names = params.map(p => p.getName());
                if (names.includes('resolve') || names.includes('reject')) {
                    callbackMethod = null;
                }
            }
        }

        // If not found, try ClosureType
        if (!callbackMethod && callbackArgType instanceof ClosureType) {
            const typeStr = callbackArgType.toString();
            const match = typeStr.match(/closures:\s*(.+)/);
            if (match) {
                const closureSigStr = match[1].trim();
                const cls = method.getDeclaringArkClass();
                // Try direct method lookup first
                callbackMethod = cls.getMethod(closureSigStr as unknown as MethodSignature);
                // Fallback: find by method name pattern
                if (!callbackMethod) {
                    const sigParts = closureSigStr.split('.');
                    const callbackName = sigParts[sigParts.length - 1].split('(')[0];
                    for (const m of cls.getMethods(true)) {
                        if (m.getName() === callbackName) {
                            callbackMethod = m;
                            break;
                        }
                    }
                }
            }
        }

        if (!callbackMethod) {
            callbackMethod = this.findCallbackMethodFromInvoke(method, invokeExpr);
        }

        if (!callbackMethod) return;

        // Get callback parameters with closure resolution
        const resolvedParams = getResolvedCallbackParameters(callbackMethod);

        if (resolvedParams.length === 0) return;

        // For .then() success callback, find the first non-closure parameter
        // Skip closure variables (%closures*) as they are from Promise constructor, not .then() callback
        let resolvedParam: Value | null = null;
        for (const param of resolvedParams) {
            if (param instanceof Local) {
                const paramName = param.getName();
                // Skip closure variables
                if (paramName.startsWith('%closures')) {
                    continue;
                }
                // This is a regular callback parameter
                resolvedParam = param;
                break;
            }
        }

        if (resolvedParam) {
            const fact = this.createSourceFact(resolvedParam, sourceStmt, source);
            if (sourceStmt !== stmt) fact.addPath(stmt);
            this.traceCallbackParamDataFlow(callbackMethod, resolvedParam, fact);
        }
    }

    /**
     * Find the source invoke statement that assigns a value to the given variable.
     * Also handles Promise chains like: let x = sourceApi().then(callback)
     */
    private findSourceInvokeForVariable(
        method: ArkMethod,
        localVar: Local
    ): { invokeExpr: AbstractInvokeExpr, statement: Stmt } | null {
        const cfg = method.getCfg();
        if (!cfg) return null;

        for (const block of cfg.getBlocks()) {
            for (const stmt of block.getStmts()) {
                if (!(stmt instanceof ArkAssignStmt)) continue;
                const leftOp = stmt.getLeftOp();
                if (!ValueEqual(leftOp, localVar)) continue;

                const rightOp = stmt.getRightOp();
                if (rightOp instanceof AbstractInvokeExpr) {
                    // Check if this is a .then() call
                    if (rightOp instanceof ArkInstanceInvokeExpr) {
                        const methodName = rightOp.getMethodSignature().getMethodSubSignature().getMethodName();
                        if (methodName === 'then') {
                            // Get the base of .then() - this is the source API call
                            const thenBase = rightOp.getBase();
                            if (thenBase instanceof AbstractInvokeExpr) {
                                const source = callSource(thenBase, this.sources, this.scene, this.pointerAnalysis);
                                if (source && source.sourceType === 'return') {
                                    return { invokeExpr: thenBase, statement: stmt };
                                }
                            }
                        }
                    }
                    return { invokeExpr: rightOp, statement: stmt };
                }
            }
        }
        return null;
    }

    /**
     * Analyze .then() chaining: resultVar.then(callback)
     */
    private analyzeThenChaining(method: ArkMethod, promiseVar: Local, sourceStmt: Stmt, source: Source): void {
        const cfg = method.getCfg();
        if (!cfg) return;

        // Look for .then() calls on promiseVar
        for (const block of cfg.getBlocks()) {
            for (const stmt of block.getStmts()) {
                if (!stmt.containsInvokeExpr()) continue;

                const invokeExpr = stmt.getInvokeExpr();
                if (!invokeExpr) continue;

                // Check if this is a .then() call
                const methodName = invokeExpr.getMethodSignature().getMethodSubSignature().getMethodName();
                if (methodName !== 'then') continue;

                // Check if the base is our promise variable
                if (invokeExpr instanceof ArkInstanceInvokeExpr) {
                    const base = invokeExpr.getBase();
                    if (!ValueEqual(base, promiseVar)) continue;
                }

                // Get the callback argument (index 0 is success callback, index 1 is error)
                const args = invokeExpr.getArgs();
                if (args.length === 0) continue;

                const callbackArg = args[0];
                const callbackArgType = callbackArg.getType();

                let callbackMethod: ArkMethod | null = null;
                if (callbackArgType instanceof FunctionType) {
                    const callbackSig = callbackArgType.getMethodSignature();
                    callbackMethod = method.getDeclaringArkClass().getMethod(callbackSig);
                }

                // If not found, try scanning for anonymous methods
                if (!callbackMethod) {
                    callbackMethod = this.findCallbackMethodFromInvoke(method, invokeExpr);
                }

                if (!callbackMethod) continue;

                // Get callback parameters with closure resolution
                const resolvedParams = getResolvedCallbackParameters(callbackMethod);
                if (resolvedParams.length === 0) continue;

                // For .then() success callback, the resolved value is the first param
                const resolvedParam = resolvedParams[0];
                if (resolvedParam instanceof Local) {
                    const fact = this.createSourceFact(resolvedParam, sourceStmt, source);
                    fact.addPath(stmt);
                    this.traceCallbackParamDataFlow(callbackMethod, resolvedParam, fact);
                    this.tracePromiseResolveToAwaitSinks(method, callbackMethod, resolvedParam, fact);
                }
            }
        }
    }

    /**
     * Handles Promise wrapper methods:
     * source().then(data => resolve(data)); return promise;
     * const data = await wrapper(); sink(data);
     */
    private tracePromiseResolveToAwaitSinks(executorMethod: ArkMethod, callbackMethod: ArkMethod, startVar: Local, startFact: TaintFact): void {
        const resolveFacts = this.collectResolveFacts(callbackMethod, startVar, startFact);
        if (resolveFacts.length === 0) return;

        const promiseOwner = this.findPromiseOwnerMethod(executorMethod);
        if (!promiseOwner) return;

        this.traceAwaitedMethodResultToSinks(promiseOwner, resolveFacts);
    }

    private collectResolveFacts(method: ArkMethod, startVar: Local, startFact: TaintFact): TaintFact[] {
        const cfg = method.getCfg();
        if (!cfg) return [];

        const resolved: TaintFact[] = [];
        const visited = new Set<string>();
        const worklist: Array<{ var: Value, fact: TaintFact }> = [{ var: startVar, fact: startFact }];
        const allStmts: Stmt[] = [];
        for (const block of cfg.getBlocks()) {
            allStmts.push(...block.getStmts());
        }

        let stateCount = 0;
        while (worklist.length > 0) {
            stateCount++;
            if (stateCount > this.callbackBudgetOptions.maxStates) {
                console.log(`[HAPFLOW] collectResolveFacts: budget exceeded (${stateCount} states)`);
                break;
            }

            const { var: currentVar, fact: currentFact } = worklist.pop()!;
            const key = method.getSignature().toString() + '|' + currentVar.toString()
                + '|' + currentFact.getSourceIdentityKey();
            if (visited.has(key)) continue;
            visited.add(key);

            if (currentFact.getPath().length > this.callbackBudgetOptions.maxPathLen) {
                continue;
            }

            for (const stmt of allStmts) {
                if (!stmt.containsInvokeExpr()) continue;
                const invokeExpr = stmt.getInvokeExpr();
                if (!invokeExpr) continue;

                const methodName = invokeExpr.getMethodSignature().getMethodSubSignature().getMethodName();
                if (methodName !== 'resolve') continue;

                for (const arg of invokeExpr.getArgs()) {
                    if (ValueDependsOn(arg, currentVar)) {
                        const resolveFact = currentFact.copyForValue(currentVar, stmt);
                        resolved.push(resolveFact);
                        break;
                    }
                }
            }

            for (const stmt of allStmts) {
                if (!(stmt instanceof ArkAssignStmt)) continue;
                const leftOp = stmt.getLeftOp();
                const rightOp = stmt.getRightOp();

                if (ValueEqual(rightOp, currentVar) && leftOp instanceof Local) {
                    this.pushTaintWorkItem(worklist, leftOp, currentFact, stmt);
                }

                if (currentVar instanceof Local && rightOp instanceof ArkInstanceFieldRef && LocalEqual(rightOp.getBase(), currentVar)) {
                    this.pushTaintWorkItem(worklist, rightOp, currentFact, stmt);
                }

                if (currentVar instanceof Local && rightOp instanceof ArkArrayRef && LocalEqual(rightOp.getBase(), currentVar)) {
                    this.pushTaintWorkItem(worklist, rightOp, currentFact, stmt);
                }

                if (currentVar instanceof ArkArrayRef && rightOp instanceof ArkInstanceFieldRef && ValueEqual(rightOp.getBase(), currentVar)) {
                    this.pushTaintWorkItem(worklist, rightOp, currentFact, stmt);
                }

                if (leftOp instanceof Local && ValueDependsOn(rightOp, currentVar)) {
                    this.pushTaintWorkItem(worklist, leftOp, currentFact, stmt);
                }
            }
        }

        return resolved;
    }

    private pushTaintWorkItem(worklist: Array<{ var: Value, fact: TaintFact }>, value: Value, currentFact: TaintFact, stmt: Stmt): void {
        const newFact = currentFact.copyForValue(value, stmt);
        worklist.push({ var: value, fact: newFact });
    }

    private findPromiseOwnerMethod(executorMethod: ArkMethod): ArkMethod | null {
        const cls = executorMethod.getDeclaringArkClass();
        const executorName = executorMethod.getName();

        for (const method of cls.getMethods(true)) {
            if (method === executorMethod) continue;
            const cfg = method.getCfg();
            if (!cfg) continue;

            for (const block of cfg.getBlocks()) {
                for (const stmt of block.getStmts()) {
                    if (!stmt.containsInvokeExpr()) continue;
                    const invokeExpr = stmt.getInvokeExpr();
                    if (!(invokeExpr instanceof ArkInstanceInvokeExpr)) continue;

                    const methodName = invokeExpr.getMethodSignature().getMethodSubSignature().getMethodName();
                    if (methodName !== 'constructor') continue;
                    if (!invokeExpr.getBase().getType().toString().includes('Promise')) continue;
                    if (!invokeExpr.getArgs().some(arg => this.callbackArgMatchesMethod(arg, executorMethod, executorName))) continue;

                    if (this.methodReturnsValue(method, invokeExpr.getBase())) {
                        return method;
                    }
                }
            }
        }

        return null;
    }

    private callbackArgMatchesMethod(arg: Value, method: ArkMethod, methodName: string): boolean {
        if (arg instanceof Local && arg.getName() === methodName) return true;
        const argType = arg.getType();
        if (argType instanceof FunctionType) {
            return argType.getMethodSignature().toString() === method.getSignature().toString();
        }
        return arg.toString() === methodName;
    }

    private methodReturnsValue(method: ArkMethod, value: Value): boolean {
        const cfg = method.getCfg();
        if (!cfg) return false;

        for (const block of cfg.getBlocks()) {
            for (const stmt of block.getStmts()) {
                if (stmt instanceof ArkReturnStmt && ValueEqual(stmt.getOp(), value)) {
                    return true;
                }
            }
        }

        return false;
    }

    private traceAwaitedMethodResultToSinks(sourceMethod: ArkMethod, resolveFacts: TaintFact[]): void {
        const sourceSig = sourceMethod.getSignature().toString();
        const cls = sourceMethod.getDeclaringArkClass();

        for (const method of cls.getMethods(true)) {
            const cfg = method.getCfg();
            if (!cfg) continue;

            const awaitedResults: Array<{ value: Local, stmt: Stmt, fact: TaintFact }> = [];
            for (const block of cfg.getBlocks()) {
                for (const stmt of block.getStmts()) {
                    if (!(stmt instanceof ArkAssignStmt)) continue;
                    const leftOp = stmt.getLeftOp();
                    const rightOp = stmt.getRightOp();
                    if (!(leftOp instanceof Local)) continue;
                    if (!(rightOp instanceof ArkAwaitExpr)) continue;

                    const promise = rightOp.getPromise();
                    const promiseStmt = this.findAssignmentToInvoke(method, promise, sourceSig);
                    if (!promiseStmt) continue;

                    for (const resolveFact of resolveFacts) {
                        const awaitedFact = resolveFact.copyForValue(leftOp);
                        awaitedFact.addPath(promiseStmt);
                        awaitedFact.addPath(stmt);
                        awaitedResults.push({ value: leftOp, stmt, fact: awaitedFact });
                    }
                }
            }

            for (const result of awaitedResults) {
                this.traceReturnedValueDataFlow(method, result.value, result.fact);
            }
        }
    }

    private findAssignmentToInvoke(method: ArkMethod, assignedValue: Value, sourceSig: string): ArkAssignStmt | null {
        const cfg = method.getCfg();
        if (!cfg) return null;

        for (const block of cfg.getBlocks()) {
            for (const stmt of block.getStmts()) {
                if (!(stmt instanceof ArkAssignStmt)) continue;
                if (!ValueEqual(stmt.getLeftOp(), assignedValue)) continue;

                const rightOp = stmt.getRightOp();
                if (rightOp instanceof AbstractInvokeExpr && rightOp.getMethodSignature().toString() === sourceSig) {
                    return stmt;
                }
            }
        }

        return null;
    }

    /**
     * Find callback method from a .then() invoke expression
     * DISABLED: This fallback was causing incorrect callback bindings.
     * Now returns null to require explicit FunctionType/ClosureType resolution.
     */
    private findCallbackMethodFromInvoke(callerMethod: ArkMethod, invokeExpr: AbstractInvokeExpr): ArkMethod | null {
        // DISABLED - no longer using regex fallback for callback method lookup
        // Only FunctionType.getMethodSignature() and ClosureType closures: resolution is allowed
        return null;
    }

    /**
     * Trace data flow from a returned Promise value
     * e.g., let contacts = await selectContacts(); ... use contacts ...
     */
    private traceReturnedValueDataFlow(method: ArkMethod, startVar: Local, startFact: TaintFact): void {
        const cfg = method.getCfg();
        if (!cfg) return;

        const visited = new Set<string>();
        const worklist: Array<{ var: Value, fact: TaintFact }> = [{ var: startVar, fact: startFact }];

        // Pre-collect all statements for efficiency
        let allStmts: Stmt[] = [];
        if (cfg) {
            for (const block of cfg.getBlocks()) {
                allStmts.push(...block.getStmts());
            }
        }

        // Track state count for budget
        let stateCount = 0;

        while (worklist.length > 0) {
            // Check state budget
            stateCount++;
            if (stateCount > this.callbackBudgetOptions.maxStates) {
                console.log(`[HAPFLOW] traceReturnedValueDataFlow: budget exceeded (${stateCount} states)`);
                break;
            }

            const { var: currentVar, fact: currentFact } = worklist.pop()!;
            // Use method signature + variable string for visited key (no path, to avoid state explosion)
            const key = method.getSignature().toString() + '|' + currentVar.toString()
                + '|' + currentFact.getSourceIdentityKey();
            if (visited.has(key)) continue;
            visited.add(key);

            // Check path length budget
            if (currentFact.getPath().length > this.callbackBudgetOptions.maxPathLen) {
                continue;
            }

            // Check for sink usage
            for (const block of cfg.getBlocks()) {
                for (const stmt of block.getStmts()) {
                    if (!stmt.containsInvokeExpr()) continue;
                    const invokeExpr = stmt.getInvokeExpr();
                    if (!invokeExpr) continue;

                    if (this.callSink(invokeExpr)) {
                        const args = invokeExpr.getArgs();
                        for (const arg of args) {
                            if (ValueDependsOn(arg, currentVar)) {
                                const sinkFact = currentFact.copyForValue(currentVar, stmt);

                                this.appendDistinctOutcome(sinkFact);
                            }
                        }
                    }
                }
            }

            // Propagate through assignments
            for (const block of cfg.getBlocks()) {
                for (const stmt of block.getStmts()) {
                    if (!(stmt instanceof ArkAssignStmt)) continue;
                    const leftOp = stmt.getLeftOp();
                    const rightOp = stmt.getRightOp();

                    if (ValueEqual(rightOp, currentVar) && leftOp instanceof Local) {
                        const newFact = currentFact.copyForValue(leftOp, stmt);
                        worklist.push({ var: leftOp, fact: newFact });
                    }

                    if (leftOp instanceof Local && ValueDependsOn(rightOp, currentVar)) {
                        const newFact = currentFact.copyForValue(leftOp, stmt);
                        worklist.push({ var: leftOp, fact: newFact });
                    }

                    // Handle method calls: let result = var.method()
                    if (rightOp instanceof ArkInstanceInvokeExpr && leftOp instanceof Local) {
                        const base = rightOp.getBase();
                        if (ValueEqual(base, currentVar)) {
                            const newFact = currentFact.copyForValue(leftOp, stmt);
                            worklist.push({ var: leftOp, fact: newFact });
                        }
                    }

                    if (rightOp instanceof AbstractInvokeExpr && leftOp instanceof Local) {
                        const args = rightOp.getArgs();
                        if (args.some(arg => ValueDependsOn(arg, currentVar))) {
                            const newFact = currentFact.copyForValue(leftOp, stmt);
                            worklist.push({ var: leftOp, fact: newFact });
                        }
                    }
                }
            }
        }
    }

    /**
     * Find callback method by scanning anonymous methods in the class.
     * DISABLED: This fallback was causing incorrect callback bindings.
     * Now returns null to require explicit FunctionType/ClosureType resolution.
     */
    private findCallbackMethod(callerMethod: ArkMethod, invokeExpr: AbstractInvokeExpr): ArkMethod | null {
        // DISABLED - no longer using regex fallback for callback method lookup
        // Only FunctionType.getMethodSignature() and ClosureType closures: resolution is allowed
        return null;
    }

    /**
     * Trace data flow from a callback parameter to sinks.
     */
    private traceCallbackParamDataFlow(method: ArkMethod, startVar: Value, startFact: TaintFact): void {
        const cfg = method.getCfg();
        if (!cfg) return;

        const visited = new Set<string>();
        const worklist: Array<{ var: Value, fact: TaintFact }> = [{ var: startVar, fact: startFact }];

        // Pre-collect all statements for efficiency (moved outside loop)
        let allStmts: Stmt[] = [];
        if (cfg) {
            for (const block of cfg.getBlocks()) {
                allStmts.push(...block.getStmts());
            }
        }

        // Track state count for budget
        let stateCount = 0;

        while (worklist.length > 0) {
            // Check state budget
            stateCount++;
            if (stateCount > this.callbackBudgetOptions.maxStates) {
                console.log(`[HAPFLOW] traceCallbackParamDataFlow: budget exceeded (${stateCount} states)`);
                break;
            }

            const { var: currentVar, fact: currentFact } = worklist.pop()!;

            // Use method signature + variable string for visited key (no path, to avoid state explosion)
            const key = method.getSignature().toString() + '|' + currentVar.toString()
                + '|' + currentFact.getSourceIdentityKey();
            if (visited.has(key)) continue;
            visited.add(key);

            // Check path length budget
            if (currentFact.getPath().length > this.callbackBudgetOptions.maxPathLen) {
                continue;
            }

            // Check for sink usage first
            for (const stmt of allStmts) {
                if (!stmt.containsInvokeExpr()) continue;
                const invokeExpr = stmt.getInvokeExpr();
                if (!invokeExpr) continue;

                const isSink = this.callSink(invokeExpr);
                if (isSink) {
                    const args = invokeExpr.getArgs();
                    for (const arg of args) {
                        if (ValueEqual(arg, currentVar)) {
                            // Found a sink!
                            const sinkFact = currentFact.copyForValue(currentVar, stmt);

                            this.appendDistinctOutcome(sinkFact);
                        }
                    }
                }
            }

            // Then propagate through assignments
            for (const stmt of allStmts) {
                if (!(stmt instanceof ArkAssignStmt)) continue;
                const leftOp = stmt.getLeftOp();
                const rightOp = stmt.getRightOp();

                if (ValueEqual(rightOp, currentVar)) {
                    // currentVar is assigned to leftOp
                    const newFact = currentFact.copyForValue(leftOp, stmt);

                    if (leftOp instanceof Local) {
                        worklist.push({ var: leftOp, fact: newFact });
                    } else if (leftOp instanceof ArkInstanceFieldRef) {
                        worklist.push({ var: leftOp, fact: newFact });
                    } else if (leftOp instanceof ArkArrayRef) {
                        worklist.push({ var: leftOp.getBase(), fact: newFact });
                    }
                }

                // Check if currentVar is used as base for field access
                if (currentVar instanceof Local && rightOp instanceof ArkInstanceFieldRef && LocalEqual(rightOp.getBase(), currentVar)) {
                    const newFact = currentFact.copyForValue(rightOp, stmt);
                    worklist.push({ var: rightOp, fact: newFact });
                }

                // Check if currentVar is used as base for array access (e.g., data[0])
                if (currentVar instanceof Local && rightOp instanceof ArkArrayRef && LocalEqual(rightOp.getBase(), currentVar)) {
                    const newFact = currentFact.copyForValue(rightOp, stmt);
                    worklist.push({ var: rightOp, fact: newFact });
                }

                // Check if currentVar is an ArkArrayRef and rightOp is field access on it (e.g., data[0].placeName)
                if (currentVar instanceof ArkArrayRef && rightOp instanceof ArkInstanceFieldRef && ValueEqual(rightOp.getBase(), currentVar)) {
                    const newFact = currentFact.copyForValue(rightOp, stmt);
                    worklist.push({ var: rightOp, fact: newFact });
                }

                // Check if rightOp is a method call on currentVar (e.g., pasteData.getPrimaryText())
                // The return value depends on the tainted receiver
                if (currentVar instanceof Local && rightOp instanceof AbstractInvokeExpr) {
                    const methodInvoke = rightOp as AbstractInvokeExpr;
                    let baseUsed = false;

                    if (methodInvoke instanceof ArkInstanceInvokeExpr) {
                        const invokeBase = methodInvoke.getBase();
                        if (ValueEqual(invokeBase, currentVar)) {
                            baseUsed = true;
                        }
                    }

                    if (baseUsed && leftOp instanceof Local) {
                        // leftOp depends on tainted data from method call
                        const newFact = currentFact.copyForValue(leftOp, stmt);
                        worklist.push({ var: leftOp, fact: newFact });
                    }
                }

                // Handle string concatenation: taint propagates through string operations
                // e.g., 'Clipboard Data: ' + text
                if (leftOp instanceof Local) {
                    // Check if rightOp references currentVar in any way
                    const uses = rightOp.getUses ? rightOp.getUses() : [];
                    for (const use of uses) {
                        if (ValueEqual(use, currentVar)) {
                            const newFact = currentFact.copyForValue(leftOp, stmt);
                            worklist.push({ var: leftOp, fact: newFact });
                            break;
                        }
                    }
                }
            }
        }
    }

    private appendDistinctOutcome(outcome: TaintFact): void {
        const duplicate = this.detectOutcome.some(existing => TaintOutcomeEqual(existing, outcome));
        if (!duplicate) {
            this.detectOutcome.push(outcome);
        }
    }

    getEntryPoint(): Stmt {
        return this.entryPoint;
    }

    getEntryMethod(): ArkMethod {
        return this.entryMethod;
    }

    public callSink(expr: AbstractInvokeExpr): boolean {
        const methodSignature = expr.getMethodSignature().toString();
        const methodName = expr.getMethodSignature().getMethodSubSignature().getMethodName().toLowerCase();

        // Check internal sinks first (these are guaranteed sinks)
        if (INTERNAL_SINK_METHOD_toString.includes(methodSignature)) {
            return true;
        }

        // Also check for common log sink methods
        if (LOG_SINK_METHODS.map(name => name.toLowerCase()).includes(methodName)) {
            return true;
        }

        const declaringClass = expr.getMethodSignature().getDeclaringClassSignature().toString().toLowerCase();
        const receiver = expr instanceof ArkInstanceInvokeExpr
            ? expr.getBase().toString().toLowerCase()
            : declaringClass;

        // Built-in console and system hilog receivers are explicit log sinks.
        if (declaringClass.includes('console') || receiver === 'console' || receiver === 'hilog') {
            return true;
        }

        // Exact match against configured sinks
        for (const sink of this.sinks) {
            if (sink.toString() == methodSignature) {
                return true;
            }
        }

        // Unknown SDK signatures require both an exact method token and receiver
        // evidence. Substring-only matching incorrectly treats Map.set() as
        // pasteboard.setData() and arbitrary Logger.info() as hilog.info().
        if (methodSignature.includes('@%unk') || methodSignature.includes('@unk')) {
            const normalizedReceiver = receiver.replace(/[^a-z0-9_.]/g, '');
            for (const matcher of this.sinkMatchers) {
                if (matcher.method !== methodName) continue;
                if (matcher.owners.some(owner =>
                    normalizedReceiver === owner
                    || normalizedReceiver.endsWith(`.${owner}`)
                    || normalizedReceiver.includes(owner))) {
                    return true;
                }
            }
        }

        return false;
    }

    data2Sink(srcStmt: Stmt, dataFact: TaintFact): void {
        const callExpr = srcStmt.getInvokeExpr();
        const dataValue = dataFact.getValue();
        if (callExpr && this.callSink(callExpr)) {
            if (process.env.ARKPRISM_DEBUG_IFDS === '1') {
                console.log(`[HAPFLOW][SINK-FACT] ${srcStmt.toString()} <= ${dataValue.toString()}`);
            }
            for (const param of callExpr.getArgs()) {
                if (ValueEqual(param, dataValue) || dataValue instanceof ArkInstanceFieldRef && param instanceof Local && LocalEqual(dataValue.getBase(), param)) {
                    dataFact.addPath(srcStmt);
                    const dataFactPaths = dataFact.getPath()
                    let newOutcome = true;
                    for (let i = 0; i < this.detectOutcome.length; i++) {
                        const outcomeValue = this.detectOutcome[i].getValue();
                        const outcomePath = this.detectOutcome[i].getPath();
                        if (ValueEqual(outcomeValue, dataFact.getValue())
                            && this.detectOutcome[i].hasSameSource(dataFact)
                            && outcomePath[outcomePath.length - 1] == srcStmt) {
                            if (outcomePath.every(item => dataFactPaths.includes(item))) {
                                newOutcome = false;
                            } else if (dataFactPaths.every(item => outcomePath.includes(item))) {
                                this.detectOutcome[i] = dataFact;
                                newOutcome = false;
                            }
                        }
                    }
                    if (newOutcome) {
                        this.detectOutcome.push(dataFact);
                    }
                }
            }
        }
    }

    protected addTaintFromSourceAssgin(dataFact: TaintFact, stmt: ArkAssignStmt, ret: Set<TaintFact>) {
        const source = callSource(stmt.getRightOp(), this.sources, this.scene, this.pointerAnalysis);
        if (this.getZeroValue() == dataFact && source) {
            ret.add(this.createSourceFact(stmt.getDef()!, stmt, source));
        }
    }

    protected addTaintFromSourceCall(stmt: Stmt, method: ArkMethod, ret: Set<TaintFact>) {
        const source = callSource(stmt.getInvokeExpr()!, this.sources, this.scene, this.pointerAnalysis);
        if (source) {
            const invokeExpr = stmt.getInvokeExpr()!;
            if (source.sourceType == 'callback') {
                const arg = invokeExpr.getArgs()[source.callbackIndex];
                if (!arg || !(arg.getType() instanceof FunctionType)) {
                    return;
                }
                const methodSignature = (arg.getType() as FunctionType).getMethodSignature();
                const callbackMethod = stmt.getCfg()?.getDeclaringMethod().getDeclaringArkClass().getMethod(methodSignature);
                if (callbackMethod) {
                    if (method.getParameters().length <= source.sourceIndex) {
                        return;
                    }
                    const paramOffset = method.getParameters()[0]?.getType() instanceof LexicalEnvType ? 1 : 0;
                    const paramRef = callbackMethod.getParameterInstances()[source.sourceIndex + paramOffset];
                    if (!paramRef) {
                        return;
                    }
                    ret.add(this.createSourceFact(paramRef, stmt, source));
                }
            } else if (source.sourceType == 'ArgIn') {
                const paramOffset = method.getParameters()[0]?.getType() instanceof LexicalEnvType ? 1 : 0;
                const param = method.getParameterInstances()[source.sourceIndex + paramOffset];
                if (param) ret.add(this.createSourceFact(param, stmt, source));
            }
        }
    }

    private getCallbackArgumentIndex(callStmt: Stmt, callbackMethod: ArkMethod): number {
        const callerClass = callStmt.getCfg()?.getDeclaringMethod().getDeclaringArkClass();
        const invokeExpr = callStmt.getInvokeExpr();
        if (!invokeExpr) return -1;
        return invokeExpr.getArgs().findIndex(argument => {
            const argumentType = argument.getType();
            if (!(argumentType instanceof FunctionType)) return false;
            const argumentSignature = argumentType.getMethodSignature();
            return callbackMethodSignatureMatches(
                argumentSignature,
                callbackMethod,
                callerClass?.getMethod(argumentSignature)
            );
        });
    }

    private valueOriginatesFromPromise(
        value: Value,
        depth: number = 0,
        visited: Set<Value> = new Set()
    ): boolean {
        if (depth > 8 || visited.has(value)) return false;
        visited.add(value);

        const typeName = value.getType().toString();
        if (isPromiseTypeText(typeName)) return true;
        if (!(value instanceof Local)) return false;

        const declaration = value.getDeclaringStmt();
        if (!(declaration instanceof ArkAssignStmt)) return false;
        const rightOp = declaration.getRightOp();
        if (rightOp instanceof Local) {
            return this.valueOriginatesFromPromise(rightOp, depth + 1, visited);
        }
        if (!(rightOp instanceof AbstractInvokeExpr)) return false;

        const source = callSource(rightOp, this.sources, this.scene, this.pointerAnalysis);
        if (/^\s*Promise\s*</.test(source?.rule.returnType || '')) return true;
        if (this.promiseContractResolver.invocationReturnsPromise(rightOp)) return true;

        if (rightOp instanceof ArkInstanceInvokeExpr
            && rightOp.getMethodSignature().getMethodSubSignature().getMethodName() === 'then') {
            return this.valueOriginatesFromPromise(rightOp.getBase(), depth + 1, visited);
        }

        const target = rightOp.getMethodSignature().toString();
        return isPromiseTypeText(target);
    }

    private hasStaticPromiseOwnerWitness(invokeExpr: ArkInstanceInvokeExpr): boolean {
        const baseType = invokeExpr.getBase().getType().toString();
        const target = invokeExpr.getMethodSignature().toString();
        if (isPromiseTypeText(baseType) || isPromiseTypeText(target)) {
            return true;
        }

        const targetFileSignature = invokeExpr.getMethodSignature()
            .getDeclaringClassSignature()
            .getDeclaringFileSignature();
        const targetFile = this.scene.getFile(targetFileSignature);
        if (targetFile && !this.scene.hasSdkFile(targetFileSignature)) return false;
        if (!target.includes('@%unk/%unk')) return false;

        return this.valueOriginatesFromPromise(invokeExpr.getBase());
    }

    private hasArkUIFrameworkEventWitness(invokeExpr: ArkInstanceInvokeExpr): boolean {
        const methodSignature = invokeExpr.getMethodSignature();
        const classSignature = methodSignature.getDeclaringClassSignature();
        if (!isArkUIFrameworkEventSignature(
            methodSignature.getMethodSubSignature().getMethodName(),
            classSignature.getClassName()
        )) {
            return false;
        }

        const targetFileSignature = classSignature.getDeclaringFileSignature();
        const targetFile = this.scene.getFile(targetFileSignature);
        if (targetFile) return this.scene.hasSdkFile(targetFileSignature);

        return methodSignature.toString().includes('@%unk/%unk');
    }

    private hasPlatformTaskCallbackWitness(
        invokeExpr: AbstractInvokeExpr,
        callbackIndex: number
    ): boolean {
        const methodSignature = invokeExpr.getMethodSignature();
        const classSignature = methodSignature.getDeclaringClassSignature();
        if (!isPlatformTaskCallbackSignature(
            methodSignature.getMethodSubSignature().getMethodName(),
            classSignature.getClassName(),
            callbackIndex,
            invokeExpr instanceof ArkInstanceInvokeExpr
                ? [invokeExpr.getBase().getType().toString(), invokeExpr.getBase().toString()]
                : []
        )) {
            return false;
        }

        const targetFileSignature = classSignature.getDeclaringFileSignature();
        const targetFile = this.scene.getFile(targetFileSignature);
        if (targetFile) return this.scene.hasSdkFile(targetFileSignature);
        return methodSignature.toString().includes('@%unk/%unk');
    }

    public getSdkContinuationEdgeKind(
        callStmt: Stmt,
        callbackMethod: ArkMethod
    ): SdkContinuationEdgeKind | null {
        const invokeExpr = callStmt.getInvokeExpr();
        if (!invokeExpr) return null;

        const callbackIndex = this.getCallbackArgumentIndex(callStmt, callbackMethod);
        if (callbackIndex < 0) return null;

        const source = callSource(invokeExpr, this.sources, this.scene, this.pointerAnalysis);
        if (source?.sourceType === 'callback' && source.callbackIndex === callbackIndex) {
            return 'source_callback';
        }

        if (this.hasPlatformTaskCallbackWitness(invokeExpr, callbackIndex)) {
            return 'framework_task';
        }

        if (invokeExpr instanceof ArkInstanceInvokeExpr
            && this.hasArkUIFrameworkEventWitness(invokeExpr)) {
            return 'framework_event';
        }

        if (continuationFlowEnabled()
            && callbackIndex === 0
            && invokeExpr instanceof ArkInstanceInvokeExpr
            && invokeExpr.getMethodSignature().getMethodSubSignature().getMethodName() === 'then'
            && this.hasStaticPromiseOwnerWitness(invokeExpr)) {
            return 'promise_fulfillment';
        }

        return null;
    }

    private hasPromiseOwnerWitness(invokeExpr: ArkInstanceInvokeExpr, dataFact: TaintFact): boolean {
        if (dataFact.getCarrierState() !== 'promise_payload') return false;

        const sourceReturn = dataFact.getSourceEvidence()?.rule.returnType || '';
        if (!/^\s*Promise\s*</.test(sourceReturn)) return false;

        const baseType = invokeExpr.getBase().getType().toString();
        const target = invokeExpr.getMethodSignature().toString();
        if (/(^|[<:.\s])Promise(?:<|[.:\s])/i.test(baseType)
            || /(^|[<:./\s])Promise(?:<|[.:\s])/i.test(target)) {
            return true;
        }
        return target.includes('@%unk/%unk');
    }

    private addPromiseContinuationFact(
        callStmt: Stmt,
        callbackMethod: ArkMethod,
        dataFact: TaintFact,
        ret: Set<TaintFact>
    ): void {
        if (!continuationFlowEnabled()) return;

        const invokeExpr = callStmt.getInvokeExpr();
        if (process.env.ARKPRISM_DEBUG_IFDS === '1'
            && invokeExpr instanceof ArkInstanceInvokeExpr
            && invokeExpr.getMethodSignature().getMethodSubSignature().getMethodName() === 'then') {
            console.log(
                `[HAPFLOW][PROMISE-THEN] base=${invokeExpr.getBase().toString()} `
                + `baseType=${invokeExpr.getBase().getType().constructor.name}:`
                + `${invokeExpr.getBase().getType().toString()} `
                + `target=${invokeExpr.getMethodSignature().toString()} `
                + `sourceReturn=${dataFact.getSourceEvidence()?.rule.returnType || '<none>'}`
            );
        }
        if (!(invokeExpr instanceof ArkInstanceInvokeExpr)
            || invokeExpr.getMethodSignature().getMethodSubSignature().getMethodName() !== 'then'
            || this.getCallbackArgumentIndex(callStmt, callbackMethod) !== 0
            || !this.hasPromiseOwnerWitness(invokeExpr, dataFact)) {
            return;
        }

        const callbackValue = getParameterInstanceForArgument(callbackMethod, 0);
        if (!callbackValue) return;

        if (dataFact === this.getZeroValue()) return;

        const base = invokeExpr.getBase();
        const dataValue = dataFact.getValue();
        let carrierMatches = ValueEqual(base, dataValue);
        if (!carrierMatches && this.pointerAnalysis) {
            for (const candidate of getPossibleRelatedNodes(base, this.pointerAnalysis)) {
                if (ValueEqual(candidate, dataValue)) {
                    carrierMatches = true;
                    break;
                }
            }
        }
        if (!carrierMatches) return;

        const continuationFact = propagateFact(
            callbackValue,
            callStmt,
            ret,
            dataFact,
            'callback_payload'
        );
        continuationFact?.addDerivation('promise_then');
    }

    getNormalFlowFunction(srcStmt: Stmt, tgtStmt: Stmt): FlowFunction<TaintFact> {
        let checkerInstance: TaintAnalysisChecker = this;
        return new class implements FlowFunction<TaintFact> {
            getDataFacts(dataFact: TaintFact): Set<TaintFact> {
                const dataValue = dataFact.getValue();
                let ret: Set<TaintFact> = new Set();
                if (checkerInstance.getEntryPoint() == srcStmt && checkerInstance.getZeroValue() == dataFact) {
                    ret.add(checkerInstance.getZeroValue());
                    return ret;
                }
                const stmtDef = srcStmt.getDef();
                let reDef = stmtDef && ValueEqual(stmtDef, dataValue);
                if (stmtDef && checkerInstance.pointerAnalysis) {
                    for (const v of getPossibleRelatedNodes(dataValue, checkerInstance.pointerAnalysis)) {
                        if (ValueEqual(v, dataValue)) {
                            reDef = true;
                            break;
                        }
                    }
                }
                if (!(reDef || srcStmt.getDef() && ValueEqual(srcStmt.getDef()!, dataFact.getValue()))) {
                    let santiza = false;
                    const expr = srcStmt.getInvokeExpr()
                    if (expr) {
                        const args = expr.getArgs();
                        if (args.includes(dataValue)) {
                            const methodSignature = expr.getMethodSignature();
                            for (const santi of checkerInstance.santizations) {
                                if (santi == methodSignature) {
                                    santiza = true;
                                    break;
                                }
                            }
                        }
                    }
                    if (!santiza && !(dataValue instanceof Local && dataValue.toString()[0] == '%' && srcStmt.getUses().includes(dataValue) && dataValue.getUses().length == 1)) {
                        ret.add(dataFact);
                    }
                }
                if (srcStmt instanceof ArkAssignStmt) {
                    let stmt: ArkAssignStmt = (srcStmt as ArkAssignStmt);
                    let assigned: Value = stmt.getLeftOp();
                    let rightOp: Value = stmt.getRightOp();
                    if (process.env.ARKPRISM_DEBUG_IFDS === '1'
                        && rightOp instanceof ArkInstanceFieldRef
                        && rightOp.getBase().getName() === 'err') {
                        console.log(
                            `[HAPFLOW][EXCEPTION-FIELD] fact=${dataValue.toString()} `
                            + `base=${rightOp.getBase().toString()} equal=${ValueEqual(rightOp.getBase(), dataValue)}`
                        );
                    }
                    checkerInstance.addTaintFromSourceAssgin(dataFact, stmt, ret);

                    if (irRecoveryEnabled()
                        && rightOp instanceof ArkCaughtExceptionRef
                        && ValueEqual(assigned, dataValue)) {
                        ret.add(dataFact);
                    }

                    if (irRecoveryEnabled()
                        && rightOp instanceof ArkInstanceInvokeExpr
                        && rightOp.getBase().getName() === 'JSON'
                        && rightOp.getMethodSignature().getMethodSubSignature().getMethodName() === 'stringify') {
                        const serializedValue = rightOp.getArgs()[0];
                        const taintedContainer = dataValue instanceof ArkInstanceFieldRef
                            || dataValue instanceof ArkArrayRef
                            || dataValue instanceof MultiRef
                            ? dataValue.getBase()
                            : undefined;
                        if (serializedValue && taintedContainer && ValueEqual(serializedValue, taintedContainer)) {
                            propagateFact(assigned, srcStmt, ret, dataFact);
                        }
                    }

                    if (dataValue instanceof ArkInstanceFieldRef && rightOp == dataValue.getBase()) {
                        const leftOp = srcStmt.getLeftOp();
                        if (leftOp instanceof Local) {
                            const field = new ArkInstanceFieldRef(leftOp, dataValue.getFieldSignature());
                            propagateFact(field, srcStmt, ret, dataFact);
                        } else if (leftOp instanceof ArkInstanceFieldRef) {
                            const field = new MultiRef(leftOp.getBase(), [leftOp.getFieldSignature(), dataValue.getFieldSignature()]);
                            propagateFact(field, srcStmt, ret, dataFact);
                        }
                    } else if (dataValue instanceof MultiRef) {
                        if (checkerInstance.pointerAnalysis) {
                            for (const v of getPossibleRelatedNodes(rightOp, checkerInstance.pointerAnalysis)) {
                                if (ValueEqual(dataValue, v)) {
                                    propagateFact(assigned, srcStmt, ret, dataFact);
                                    break;
                                }
                            }
                        }
                        if ((assigned instanceof Local || assigned instanceof ArkInstanceFieldRef) && rightOp instanceof ArkInstanceFieldRef && LocalEqual(rightOp.getBase(), dataValue.getBase()) && rightOp.getFieldSignature().toString() == dataValue.getFieldSignatures()[0].toString()) {
                            if (assigned instanceof Local && dataValue.getFieldSignatures().length == 2) {
                                const field = new ArkInstanceFieldRef(assigned, dataValue.getFieldSignatures()[1]);
                                propagateFact(field, srcStmt, ret, dataFact);
                            } else {
                                const fileds = [];
                                let base: Local;
                                if (assigned instanceof Local) {
                                    base = assigned;
                                } else {
                                    base = assigned.getBase();
                                    fileds.push(assigned.getFieldSignature());
                                }
                                for (let i = 1; i < dataValue.getFieldSignatures().length; i++) {
                                    fileds.push(dataValue.getFieldSignatures()[i]);
                                }
                                const m = new MultiRef(base, fileds);
                                propagateFact(m, srcStmt, ret, dataFact);
                            }
                        }
                    } else {
                        let tainted = false;
                        const uses = new Set([...rightOp.getUses(), rightOp]);
                        for (const use of uses) {
                            if (ValueEqual(use, dataFact.getValue())) {
                                if (process.env.ARKPRISM_DEBUG_IFDS === '1') {
                                    console.log(
                                        `[HAPFLOW][ASSIGN] ${dataFact.getValue().toString()} -> `
                                        + `${assigned.toString()} at ${srcStmt.toString()}`
                                    );
                                }
                                tainted = true;
                                propagateFact(assigned, srcStmt, ret, dataFact);
                                if (irRecoveryEnabled() && assigned instanceof ArkInstanceFieldRef) {
                                    const canonicalAccess = canonicalizeFieldAccess(assigned);
                                    if (canonicalAccess) {
                                        propagateFact(canonicalAccess, srcStmt, ret, dataFact);
                                    }
                                }
                                if (assigned instanceof ArkArrayRef &&
                                    !(assigned.getIndex() instanceof Constant)) {
                                    propagateFact(assigned.getBase(), srcStmt, ret, dataFact);
                                }

                                if (!checkerInstance.pointerAnalysis) {
                                    break;
                                }
                                try {
                                    const possibleRelatedNodes = getPossibleRelatedNodes(assigned, checkerInstance.pointerAnalysis);
                                    possibleRelatedNodes.forEach(v => {
                                        if (v instanceof Local && localDeclaredInCfg(v, srcStmt.getCfg())
                                            || (v instanceof ArkInstanceFieldRef || v instanceof ArkArrayRef || v instanceof MultiRef) && localDeclaredInCfg(v.getBase(), srcStmt.getCfg())
                                            || v instanceof ArkStaticFieldRef) {
                                            propagateFact(v, srcStmt, ret, dataFact);
                                        }
                                    });
                                } catch (err) {
                                    console.error(err);
                                }
                                break;
                            }
                        }
                        if (!tainted) {
                            if (checkerInstance.pointerAnalysis) {
                                for (const v of getPossibleRelatedNodes(assigned, checkerInstance.pointerAnalysis)) {
                                    if (ValueEqual(v, dataValue)) {
                                        return ret;
                                    }
                                }
                            } else if (ValueEqual(assigned, dataValue)) {
                                return ret;
                            }
                        }

                    }
                } else if (srcStmt.getInvokeExpr()) {
                    const invokeExpr = srcStmt.getInvokeExpr();
                    const source = callSource(invokeExpr!, checkerInstance.sources, checkerInstance.scene, checkerInstance.pointerAnalysis);
                    if (source && source.sourceType == 'ArgIn') {
                        const argument = invokeExpr!.getArgs()[source.sourceIndex];
                        if (argument) ret.add(checkerInstance.createSourceFact(argument, srcStmt, source));
                    }
                    // Handle return-type sources: when the API returns sensitive data (e.g., getAddressesFromLocation)
                    // The return value flows through Promise.then() to the callback parameter
                    if (source && source.sourceType == 'return') {
                        // Create a special taint fact for the invoke expression result
                        // This will propagate through .then() callbacks automatically
                        const invokeResultFact = checkerInstance.createSourceFact(invokeExpr!, srcStmt, source);
                        ret.add(invokeResultFact);
                    }
                    if (invokeExpr instanceof ArkInstanceInvokeExpr
                        && invokeExpr.getMethodSignature().getMethodSubSignature().getMethodName() == 'constructor'
                        && invokeExpr.getBase().getType().toString().includes('Error')
                        && shouldPropagateErrorPayload(
                            dataFact === checkerInstance.getZeroValue(),
                            invokeExpr.getArgs(),
                            dataValue
                        )) {
                        propagateFact(invokeExpr.getBase(), srcStmt, ret, dataFact);
                    }
                } else if (srcStmt instanceof ArkThrowStmt && ValueEqual(srcStmt.getOp(), dataFact.getValue())) {
                    if (process.env.ARKPRISM_DEBUG_IFDS === '1') {
                        console.log(`[HAPFLOW][EXCEPTION] throw ${dataFact.getValue().toString()} -> ${tgtStmt.toString()}`);
                    }
                    propagateFact(tgtStmt.getDef()!, srcStmt, ret, dataFact);
                }
                // Map.set, Set.add, Array.push
                if (srcStmt instanceof ArkInvokeStmt && srcStmt.getInvokeExpr() instanceof ArkInstanceInvokeExpr) {
                    const expr = srcStmt.getInvokeExpr() as ArkInstanceInvokeExpr
                    const base = expr.getBase();
                    const baseType = base.getType();
                    if ((baseType.toString().includes('@internal/lib.es2015.collection.d.ts: Map') || baseType instanceof UnclearReferenceType && baseType.getName() == 'Map') && expr.getMethodSignature().getMethodSubSignature().getMethodName() == 'set' && ValueEqual(expr.getArgs()[1], dataValue)
                        || (baseType.toString().includes('@internal/lib.es2015.collection.d.ts: Set') || baseType instanceof UnclearReferenceType && baseType.getName() == 'Set') && expr.getMethodSignature().getMethodSubSignature().getMethodName() == 'add' && ValueEqual(expr.getArgs()[0], dataValue)
                        || baseType instanceof ArrayType && expr.getMethodSignature().getMethodSubSignature().getMethodName() == 'push' && ValueEqual(expr.getArgs()[0], dataValue)
                    ) {
                        const taint = dataFact.copyForValue(base, srcStmt);
                        ret.add(taint);
                    }
                }
                // sink为api函数进normal flow
                checkerInstance.data2Sink(srcStmt, dataFact);
                return ret;
            }
        }
    }

    getCallFlowFunction(srcStmt: Stmt, method: ArkMethod): FlowFunction<TaintFact> {
        let checkerInstance: TaintAnalysisChecker = this;
        return new class implements FlowFunction<TaintFact> {
            getDataFacts(dataFact: TaintFact): Set<TaintFact> {
                const dataValue = dataFact.getValue();
                const ret: Set<TaintFact> = new Set();
                const callbackTarget = getRecallMethodInParam(srcStmt).includes(method);
                const sdkContinuation = callbackTarget
                    ? checkerInstance.getSdkContinuationEdgeKind(srcStmt, method)
                    : null;

                if (sdkContinuation === 'promise_fulfillment'
                    && (dataFact === checkerInstance.getZeroValue()
                        || dataFact.getCarrierState() === 'promise_payload')) {
                    if (dataFact === checkerInstance.getZeroValue()) {
                        ret.add(checkerInstance.getZeroValue());
                    } else {
                        checkerInstance.addPromiseContinuationFact(srcStmt, method, dataFact, ret);
                    }
                    return ret;
                }

                if (checkerInstance.getZeroValue() == dataFact) {
                    ret.add(checkerInstance.getZeroValue());
                    checkerInstance.addTaintFromSourceCall(srcStmt, method, ret);

                } else if (dataValue instanceof GlobalRef) {
                    ret.add(dataFact);
                } else if (dataValue instanceof ArkStaticFieldRef) {
                    ret.add(dataFact);
                } else if (method.getDeclaringArkClass().getCategory() == ClassCategory.OBJECT && (method.getName() == INSTANCE_INIT_METHOD_NAME || method.getName() == "constructor") && !(dataValue instanceof ArkInstanceFieldRef && dataValue.getBase().getName() == 'this')) {
                    ret.add(dataFact);
                } else {
                    const callExpr = srcStmt.getInvokeExpr()!;
                    if (callExpr instanceof ArkInstanceInvokeExpr
                        && (dataValue instanceof ArkInstanceFieldRef || dataValue instanceof MultiRef)
                        && (callExpr.getBase().getName() == dataValue.getBase().getName()
                            || (irRecoveryEnabled()
                                && callExpr.getBase().getName() === 'super'
                                && dataValue.getBase().getName() === 'this'))) {
                        const _this = getThisAssignStmt(method).getDef();
                        let ref;
                        if (dataValue instanceof ArkInstanceFieldRef) {
                            ref = new ArkInstanceFieldRef(_this as Local, dataValue.getFieldSignature());
                        } else {
                            ref = new MultiRef(_this as Local, dataValue.getFieldSignatures())
                        }
                        propagateFact(ref, srcStmt, ret, dataFact);
                    } else if (callExpr instanceof ArkStaticInvokeExpr && dataValue instanceof ArkStaticFieldRef && callExpr.getMethodSignature().getDeclaringClassSignature() == dataValue.getFieldSignature().getDeclaringSignature()) {
                        ret.add(dataFact);
                    }

                    // Older ArkAnalyzer IR keeps the lexical environment on the
                    // call argument rather than materializing ClosureFieldRef
                    // assignments at the nested method entry. Transfer only
                    // captures explicitly listed by that lexical environment.
                    for (const arg of irRecoveryEnabled() ? callExpr.getArgs() : []) {
                        const argType = arg.getType();
                        const lexicalEnv = argType instanceof ClosureType
                            ? argType.getLexicalEnv()
                            : argType instanceof LexicalEnvType
                                ? argType
                                : undefined;
                        if (!lexicalEnv) continue;

                        for (const captured of lexicalEnv.getClosures()) {
                            const capturedLocal = method.getBody()?.getLocals().get(captured.getName());
                            if (!capturedLocal) continue;

                            if (dataValue instanceof Local && ValueEqual(captured, dataValue)) {
                                propagateFact(capturedLocal, srcStmt, ret, dataFact);
                            } else if (dataValue instanceof ArkInstanceFieldRef
                                && ValueEqual(captured, dataValue.getBase())) {
                                propagateFact(
                                    new ArkInstanceFieldRef(capturedLocal, dataValue.getFieldSignature()),
                                    srcStmt,
                                    ret,
                                    dataFact
                                );
                            } else if (dataValue instanceof MultiRef
                                && ValueEqual(captured, dataValue.getBase())) {
                                propagateFact(
                                    new MultiRef(capturedLocal, dataValue.getFieldSignatures()),
                                    srcStmt,
                                    ret,
                                    dataFact
                                );
                            }
                        }
                    }

                    let closures = getClosures(method);
                    if (process.env.ARKPRISM_DEBUG_IFDS === '1' && method.getSignature().toString().includes('[')) {
                        const entryStmts = method.getCfg()?.getStartingBlock()?.getStmts() ?? [];
                        for (const entryStmt of entryStmts) {
                            const rightOp = entryStmt instanceof ArkAssignStmt ? entryStmt.getRightOp() : undefined;
                            console.log(
                                `[HAPFLOW][CLOSURE-IR] ${entryStmt.toString()} `
                                + `rightType=${rightOp?.getType()?.constructor?.name || '<none>'}:`
                                + `${rightOp?.getType()?.toString() || '<none>'}`
                            );
                        }
                    }
                    if (process.env.ARKPRISM_DEBUG_IFDS === '1' && closures) {
                        console.log(
                            `[HAPFLOW][CLOSURE] callee=${method.getSignature().toString()} `
                            + `fact=${dataValue.toString()} captured=${closures.map(value => value.toString()).join(',')}`
                        );
                    }
                    if (closures) {
                        for (const cl of closures) {
                            if (dataValue instanceof Local && ValueEqual(cl, dataValue)) {
                                for (const stmt of method.getCfg()!.getStartingBlock()!.getStmts()) {
                                    if (stmt instanceof ArkAssignStmt && stmt.getRightOp() instanceof ClosureFieldRef) {
                                        const cfr = (stmt.getRightOp() as ClosureFieldRef).getFieldName()
                                        if (dataValue.getName() == cfr) {
                                            propagateFact(stmt.getDef()!, stmt, ret, dataFact);
                                        }
                                        break;
                                    }
                                }
                                break;
                            } else if (dataValue instanceof ArkInstanceFieldRef && ValueEqual(cl, dataValue.getBase())) {
                                for (const stmt of method.getCfg()!.getStartingBlock()!.getStmts()) {
                                    if (stmt instanceof ArkAssignStmt && stmt.getRightOp() instanceof ClosureFieldRef) {
                                        const cfr = (stmt.getRightOp() as ClosureFieldRef).getFieldName()
                                        if (dataValue.getBase().getName() == cfr) {
                                            propagateFact(new ArkInstanceFieldRef(stmt.getDef() as Local, dataValue.getFieldSignature()), stmt, ret, dataFact);
                                        }
                                        break;
                                    }
                                }
                                break;
                            } else if (dataValue instanceof MultiRef && ValueEqual(cl, dataValue.getBase())) {
                                for (const stmt of method.getCfg()!.getStartingBlock()!.getStmts()) {
                                    if (stmt instanceof ArkAssignStmt && stmt.getRightOp() instanceof ClosureFieldRef) {
                                        const cfr = (stmt.getRightOp() as ClosureFieldRef).getFieldName()
                                        if (dataValue.getBase().getName() == cfr) {
                                            propagateFact(new MultiRef(stmt.getDef() as Local, dataValue.getFieldSignatures()), stmt, ret, dataFact);
                                        }
                                        break;
                                    }
                                }
                                break;
                            }
                        }
                    }

                    for (const sink of checkerInstance.sinks) {
                        const callSig = callExpr.getMethodSignature().toString();
                        const sinkSig = sink.toString();
                        // Exact match or fuzzy match for unknown signatures
                        if (callSig === sinkSig ||
                            (callSig.includes('@%unk') && sinkSig.includes(callExpr.getMethodSignature().getMethodSubSignature().getMethodName()))) {
                            for (const param of callExpr.getArgs()) {
                                if (ValueEqual(param, dataFact.getValue())) {
                                    dataFact.addPath(srcStmt);
                                    checkerInstance.detectOutcome.push(dataFact);
                                }
                            }
                        }
                    }
                }
                const callStmt = srcStmt;
                if (callbackTarget) {
                    if (sdkContinuation === 'promise_fulfillment') {
                        checkerInstance.addPromiseContinuationFact(callStmt, method, dataFact, ret);
                    }
                    return ret;
                }
                const args = callStmt.getInvokeExpr()?.getArgs() || [];
                for (let i = 0; i < args.length; i++) {
                    const realParameter = getParameterInstanceForArgument(method, i);
                    const argType = args[i].getType();
                    const lexicalEnv = argType instanceof ClosureType
                        ? argType.getLexicalEnv()
                        : argType instanceof LexicalEnvType
                            ? argType
                            : undefined;
                    if (lexicalEnv && lexicalEnv.getClosures().some(captured => ValueEqual(captured, dataValue))) {
                        if (realParameter) {
                            propagateFact(realParameter, srcStmt, ret, dataFact);
                        }
                    }

                    if (dataValue instanceof ArkInstanceFieldRef && dataValue.getBase().getName() == args[i].toString()) {
                        if (realParameter instanceof Local) {
                            const retRef = new ArkInstanceFieldRef(realParameter, dataValue.getFieldSignature());
                            propagateFact(retRef, srcStmt, ret, dataFact);
                        }
                    } else if (dataValue instanceof Local && dataValue.toString() == args[i].toString()) {
                        if (realParameter) {
                            propagateFact(realParameter, srcStmt, ret, dataFact);
                        }
                    }
                }

                const invokeExpr = callStmt.getInvokeExpr();
                if (invokeExpr instanceof ArkPtrInvokeExpr
                    && dataValue instanceof Local
                    && ValueEqual(invokeExpr.getFuncPtrLocal(), dataValue)) {
                    let ancestor: TaintFact | undefined | null = dataFact.getLast();
                    while (ancestor && ValueEqual(ancestor.getValue(), dataValue)) {
                        ancestor = ancestor.getLast();
                    }
                    const capturedValue = ancestor?.getValue();
                    if (capturedValue instanceof Local) {
                        const capturedLocal = method.getBody()?.getLocals().get(capturedValue.getName());
                        if (capturedLocal) {
                            propagateFact(capturedLocal, srcStmt, ret, dataFact);
                        }
                    }
                }

                checkerInstance.data2Sink(srcStmt, dataFact);
                return ret;
            }

        }
    }

    getExitToReturnFlowFunction(srcStmt: Stmt, tgtStmt: Stmt, callStmt: Stmt): FlowFunction<TaintFact> {
        let checkerInstance: TaintAnalysisChecker = this;
        return new class implements FlowFunction<TaintFact> {
            getDataFacts(dataFact: TaintFact): Set<TaintFact> {
                const dataValue = dataFact.getValue();
                let ret: Set<TaintFact> = new Set<TaintFact>();
                if (dataFact == checkerInstance.getZeroValue()) {
                    ret.add(checkerInstance.getZeroValue());
                } else {
                    if (dataValue instanceof Local && srcStmt.getCfg().getDeclaringMethod().getBody()?.getUsedGlobals()?.has(dataValue.getName())) {
                        const globalLocal = srcStmt.getCfg().getDeclaringMethod().getBody()?.getUsedGlobals()?.get(dataValue.getName());
                        if (globalLocal instanceof GlobalRef) {
                            propagateFact(globalLocal, srcStmt, ret, dataFact);
                        }
                    } else if (dataValue instanceof ArkInstanceFieldRef && srcStmt.getCfg().getDeclaringMethod().getBody()?.getUsedGlobals()?.has(dataValue.getBase().getName())) {
                        const globalLocal = srcStmt.getCfg().getDeclaringMethod().getBody()?.getUsedGlobals()?.get(dataValue.getBase().getName());
                        if (globalLocal instanceof GlobalRef && globalLocal.getRef() instanceof Local) {
                            const fieldRef = new ArkInstanceFieldRef(globalLocal.getRef() as Local, dataValue.getFieldSignature());
                            propagateFact(fieldRef, srcStmt, ret, dataFact);
                        }
                    } else if (dataValue instanceof ArkStaticFieldRef) {
                        ret.add(dataFact);
                        const callee = srcStmt.getCfg().getDeclaringMethod();
                        const expr = callStmt.getInvokeExpr();
                        if (irRecoveryEnabled()
                            && callee.getDeclaringArkClass().getCategory() === ClassCategory.OBJECT
                            && callee.getName() === INSTANCE_INIT_METHOD_NAME
                            && expr instanceof ArkInstanceInvokeExpr) {
                            // Object-literal fields are emitted as static refs
                            // in this ArkAnalyzer IR. The initialized object
                            // carries that field taint back to its call site.
                            propagateFact(expr.getBase(), srcStmt, ret, dataFact);
                        }
                    } else if (dataValue instanceof ArkInstanceFieldRef && dataValue.getBase().getName() == "this") {
                        const expr = callStmt.getInvokeExpr();
                        if (expr instanceof ArkInstanceInvokeExpr) {
                            const fieldRef = new ArkInstanceFieldRef(expr.getBase(), dataValue.getFieldSignature());
                            const newFact = propagateFact(fieldRef, srcStmt, ret, dataFact);
                            if (newFact && dataFact.getLast() && ValueEqual(fieldRef, dataFact.getLast()!.getValue())) {
                                newFact.setLast(dataFact.getLast()!.getLast());
                                newFact.getPath().pop();
                                newFact.getPath().pop();
                            }
                            if (checkerInstance.pointerAnalysis) {
                                getPossibleRelatedNodes(expr.getBase(), checkerInstance.pointerAnalysis).forEach(v => {
                                    if (v instanceof Local && localDeclaredInCfg(v, callStmt.getCfg())) {
                                        const field = new ArkInstanceFieldRef(v, dataValue.getFieldSignature());
                                        propagateFact(field, srcStmt, ret, dataFact);
                                    } else if (v instanceof ArkInstanceFieldRef && localDeclaredInCfg(v.getBase(), callStmt.getCfg())) {
                                        const fieldSignatures = [v.getFieldSignature(), dataValue.getFieldSignature()];
                                        const mRef = new MultiRef(v.getBase(), fieldSignatures);
                                        propagateFact(mRef, srcStmt, ret, dataFact);
                                    } else if (v instanceof MultiRef && localDeclaredInCfg(v.getBase(), callStmt.getCfg())) {
                                        const fieldSignatures = [...v.getFieldSignatures(), dataValue.getFieldSignature()];
                                        const mRef = new MultiRef(v.getBase(), fieldSignatures);
                                        propagateFact(mRef, srcStmt, ret, dataFact);
                                    }
                                });
                            }
                        } else if (irRecoveryEnabled()
                            && expr instanceof ArkStaticInvokeExpr
                            && expr.getMethodSignature().getMethodSubSignature().getMethodName() === 'super') {
                            const callerThis = getThisAssignStmt(callStmt.getCfg().getDeclaringMethod()).getDef();
                            if (callerThis instanceof Local) {
                                propagateFact(
                                    new ArkInstanceFieldRef(callerThis, dataValue.getFieldSignature()),
                                    srcStmt,
                                    ret,
                                    dataFact
                                );
                            }
                        } else if (expr instanceof ArkPtrInvokeExpr) {
                            const method = checkerInstance.scene.getMethod((expr.getFuncPtrLocal().getType() as FunctionType).getMethodSignature());
                            if (method?.getDeclaringArkClass() == callStmt.getCfg().getDeclaringMethod().getDeclaringArkClass()) {
                                ret.add(dataFact);
                            }
                        }
                    } else if (dataValue instanceof MultiRef && dataValue.getBase().getName() == "this") {
                        const expr = callStmt.getInvokeExpr();
                        if (expr instanceof ArkInstanceInvokeExpr) {
                            const mRef = new MultiRef(expr.getBase(), dataValue.getFieldSignatures());
                            propagateFact(mRef, srcStmt, ret, dataFact);
                        }
                    } else {
                        const callee = srcStmt.getCfg().getDeclaringMethod();
                        const calleeEnvType = callee.getParameters()[0]?.getType();
                        if (irRecoveryEnabled() && calleeEnvType instanceof LexicalEnvType) {
                            for (const captured of calleeEnvType.getClosures()) {
                                if (dataValue instanceof Local && dataValue.getName() === captured.getName()) {
                                    propagateFact(captured, srcStmt, ret, dataFact);
                                } else if (dataValue instanceof ArkInstanceFieldRef
                                    && dataValue.getBase().getName() === captured.getName()) {
                                    propagateFact(
                                        new ArkInstanceFieldRef(captured, dataValue.getFieldSignature()),
                                        srcStmt,
                                        ret,
                                        dataFact
                                    );
                                } else if (dataValue instanceof MultiRef
                                    && dataValue.getBase().getName() === captured.getName()) {
                                    propagateFact(
                                        new MultiRef(captured, dataValue.getFieldSignatures()),
                                        srcStmt,
                                        ret,
                                        dataFact
                                    );
                                }
                            }
                        }

                        let closures = getClosures(srcStmt.getCfg().getDeclaringMethod());
                        if (closures) {
                            if (dataValue instanceof Local && isClosureLocal(dataValue)) {
                                for (const local of closures) {
                                    if (local.getName() == dataValue.getName()) {
                                        const newFact = propagateFact(local, srcStmt, ret, dataFact);
                                        if (newFact && dataFact.getLast() && ValueEqual(local, dataFact.getLast()!.getValue())) {
                                            newFact.setLast(dataFact.getLast()!.getLast());
                                            newFact.getPath().pop();
                                            newFact.getPath().pop();
                                        }
                                        break;
                                    }
                                }
                            } else if (dataValue instanceof ArkInstanceFieldRef && isClosureLocal(dataValue.getBase())) {
                                for (const local of closures) {
                                    if (local.getName() == dataValue.getBase().getName()) {
                                        const fieldRef = new ArkInstanceFieldRef(local, dataValue.getFieldSignature());
                                        const newFact = propagateFact(fieldRef, srcStmt, ret, dataFact);
                                        if (newFact && dataFact.getLast() && ValueEqual(fieldRef, dataFact.getLast()!.getValue())) {
                                            newFact.setLast(dataFact.getLast()!.getLast());
                                            newFact.getPath().pop();
                                            newFact.getPath().pop();
                                        }
                                        break;
                                    }
                                }
                            } else if (dataValue instanceof MultiRef && isClosureLocal(dataValue.getBase())) {
                                for (const local of closures) {
                                    if (local.getName() == dataValue.getBase().getName()) {
                                        propagateFact(local, srcStmt, ret, dataFact);
                                        break;
                                    }
                                }
                            }
                        }

                        // Older IR records captured variables only on the
                        // ClosureType argument. Map writes in the nested method
                        // back to those exact caller locals on callback return.
                        const callExpr = callStmt.getInvokeExpr();
                        for (const arg of irRecoveryEnabled() ? callExpr?.getArgs() || [] : []) {
                            const argType = arg.getType();
                            const lexicalEnv = argType instanceof ClosureType
                                ? argType.getLexicalEnv()
                                : argType instanceof LexicalEnvType
                                    ? argType
                                    : undefined;
                            if (!lexicalEnv) continue;

                            for (const captured of lexicalEnv.getClosures()) {
                                if (dataValue instanceof Local && dataValue.getName() === captured.getName()) {
                                    propagateFact(captured, srcStmt, ret, dataFact);
                                } else if (dataValue instanceof ArkInstanceFieldRef
                                    && dataValue.getBase().getName() === captured.getName()) {
                                    propagateFact(
                                        new ArkInstanceFieldRef(captured, dataValue.getFieldSignature()),
                                        srcStmt,
                                        ret,
                                        dataFact
                                    );
                                } else if (dataValue instanceof MultiRef
                                    && dataValue.getBase().getName() === captured.getName()) {
                                    propagateFact(
                                        new MultiRef(captured, dataValue.getFieldSignatures()),
                                        srcStmt,
                                        ret,
                                        dataFact
                                    );
                                }
                            }
                        }

                    }
                    if (checkerInstance.pointerAnalysis) {
                        try {
                            const possibleRelatedNodes = getPossibleRelatedNodes(dataValue, checkerInstance.pointerAnalysis);
                            possibleRelatedNodes.forEach(v => {
                                if (v instanceof Local && localDeclaredInCfg(v, callStmt.getCfg())
                                    || (v instanceof ArkInstanceFieldRef || v instanceof ArkArrayRef || v instanceof MultiRef) && localDeclaredInCfg(v.getBase(), callStmt.getCfg())
                                    || v instanceof ArkStaticFieldRef) {
                                    propagateFact(v, srcStmt, ret, dataFact);
                                }
                            });
                        } catch (err) {
                            console.error(err);
                        }
                    }
                }
                if (!(callStmt instanceof ArkAssignStmt)) {
                    return ret;
                }
                if (srcStmt instanceof ArkReturnStmt) {
                    let ass: ArkAssignStmt = callStmt as ArkAssignStmt;
                    let leftOp: Value = ass.getLeftOp();
                    let retVal: Value = (srcStmt as ArkReturnStmt).getOp();
                    if (dataFact == checkerInstance.getZeroValue()) {
                        ret.add(checkerInstance.getZeroValue());
                    } else if (ValueEqual(retVal, dataValue)) {
                        const callInvoke = callStmt.getInvokeExpr();
                        const callbackMethod = srcStmt.getCfg().getDeclaringMethod();
                        const promiseReturn = callInvoke instanceof ArkInstanceInvokeExpr
                            && callInvoke.getMethodSignature().getMethodSubSignature().getMethodName() === 'then'
                            && checkerInstance.getCallbackArgumentIndex(
                                callStmt,
                                callbackMethod
                            ) === 0;
                        const returnedFact = propagateFact(
                            leftOp,
                            srcStmt,
                            ret,
                            dataFact,
                            promiseReturn ? 'promise_payload' : dataFact.getCarrierState()
                        );
                        if (promiseReturn) returnedFact?.addDerivation('promise_return');
                    }
                }
                return ret;
            }
        }
    }

    getCallToReturnFlowFunction(srcStmt: Stmt, tgtStmt: Stmt): FlowFunction<TaintFact> {
        let checkerInstance: TaintAnalysisChecker = this;
        return new class implements FlowFunction<TaintFact> {
            getDataFacts(dataFact: TaintFact): Set<TaintFact> {
                const dataValue = dataFact.getValue();
                const ret: Set<TaintFact> = new Set();
                if (checkerInstance.getZeroValue() == dataFact) {
                    ret.add(checkerInstance.getZeroValue());
                }
                const defValue = srcStmt.getDef();
                if (defValue && checkerInstance.pointerAnalysis) {
                    for (const v of getPossibleRelatedNodes(defValue, checkerInstance.pointerAnalysis)) {
                        if (ValueEqual(v, dataValue) || dataValue instanceof ArkInstanceFieldRef && ValueEqual(v, dataValue.getBase())) {
                            return ret;
                        }
                    }
                }
                if (!(defValue && defValue == dataValue)) {
                    ret.add(dataFact);
                }
                const invokeExpr = srcStmt.getInvokeExpr();
                if (invokeExpr instanceof ArkInstanceInvokeExpr
                    && invokeExpr.getMethodSignature().getMethodSubSignature().getMethodName() === 'constructor'
                    && invokeExpr.getBase().getType().toString().includes('Error')
                    && invokeExpr.getArgs().some(arg => ValueEqual(arg, dataValue))) {
                    if (process.env.ARKPRISM_DEBUG_IFDS === '1') {
                        console.log(`[HAPFLOW][EXCEPTION] Error payload ${dataValue.toString()} -> ${invokeExpr.getBase().toString()}`);
                    }
                    propagateFact(invokeExpr.getBase(), srcStmt, ret, dataFact);
                }
                return ret;
            }

        }
    }



    createZeroValue(): TaintFact {
        return this.zeroValue;
    }

    getZeroValue(): TaintFact {
        return this.zeroValue;
    }

    factEqual(d1: TaintFact, d2: TaintFact): boolean {
        let value1 = d1.getValue(), value2 = d2.getValue();
        return ValueEqual(value1, value2)
            && d1.hasSameSource(d2)
            && d1.getCarrierState() === d2.getCarrierState();
    }

    public addSinksFromJson(filePath: string, sdkPath?: string) {
        const objects = loadRuleObjects(filePath, sdkPath);
        for (const object of objects) {
            const method = String(object.api_name || '')
                .split('.')
                .filter(Boolean)
                .pop()
                ?.toLowerCase();
            const owners = [
                object.namespace,
                object.class,
                String(object.api_name || '').includes('.') ? String(object.api_name).split('.')[0] : '',
                String(object.module || '').split(/[./]/).filter(Boolean).pop(),
            ]
                .map(value => String(value || '').toLowerCase().replace(/[^a-z0-9_]/g, ''))
                .filter(Boolean);
            if (method) {
                this.sinkMatchers.push({ method, owners: [...new Set(owners)] });
            }
            let methodSignatures: MethodSignature[] = [];
            methodSignatures = Json2ArkMethodSignature(object.module, object.namespace || '', object.class || '', object.api_name, this.scene, object.parameters);

            for (const ms of methodSignatures) {
                this.sinks.push(ms);
            }

            // If no signatures found (e.g., for builtin methods like console.info), add the method name as a pattern
            if (methodSignatures.length === 0) {
                // We'll handle this via fuzzy matching in callSink instead
            }
        }
    }

    public addSourcesFromJson(filePath: string, sdkPath?: string) {
        const objects = loadRuleObjects(filePath, sdkPath)
        for (const [index, object] of objects.entries()) {
            const sourceKind = validateSourceRuleObject(object, filePath, index);
            let methodSignatures: MethodSignature[] = [];
            methodSignatures = Json2ArkMethodSignature(object.module, object.namespace || '', object.class || '', object.api_name, this.scene, object.parameters);

            const sourceType: string = object.source_type || 'return';
            let sourceIndex: number = -1;
            let callbackIndex: number = -1;
            if (sourceType === 'ArgIn') {
                sourceIndex = (object.tainted_param_index ?? 0) - 1;
            } else if (sourceType === 'callback') {
                callbackIndex = (object.tainted_param_index ?? 0) - 1;
                const param = object.parameters && object.parameters[callbackIndex]?.type?.trim() || '';
                const VALID_CALLBACK_PATTERN: RegExp = /^(?:.*?\.)?(?:Async)?Callback<.*>$/;
                const ASYNC_CALLBACK_PATTERN: RegExp = /^(?:.*?\.)?AsyncCallback<.*>$/;
                if (ASYNC_CALLBACK_PATTERN.test(param)) {
                    sourceIndex = 1;
                } else if (VALID_CALLBACK_PATTERN.test(param)) {
                    sourceIndex = 0;
                }
                if (callbackIndex < 0 || sourceIndex < 0) {
                    continue;
                }
            }
            for (const ms of methodSignatures) {
                this.sources.set(ms.toString(), new Source(ms, sourceType, sourceIndex, callbackIndex, {
                    module: String(object.module || ''),
                    namespace: String(object.namespace || ''),
                    className: String(object.class || ''),
                    apiName: String(object.api_name || ''),
                    parameterTypes: Array.isArray(object.parameters)
                        ? object.parameters.map((parameter: any) => String(parameter?.type || ''))
                        : [],
                    returnType: String(object.returnType || ''),
                    sourceKind,
                    ruleOrigin: String(object.rule_origin || '')
                }));
            }
        }
    }

    public addSantizationsFromJson(path: string) {
        const data = fs.readFileSync(path, 'utf-8');
        const objects = JSON.parse(data)
        for (const object of objects) {
            const method = Json2ArkMethod(object.method, this.scene);
            if (method) {
                this.santizations.push(method);
            }
        }
    }

    getSinks(): MethodSignature[] {
        return this.sinks;
    }

    getSources(): Map<string, Source> {
        return this.sources;
    }

    getOutcome(): TaintFact[] {
        return this.detectOutcome;
    }

}
