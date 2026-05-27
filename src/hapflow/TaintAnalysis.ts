
import { Scene } from "../arkanalyzer";
import { ArkBody } from "../arkanalyzer";
import { DataflowProblem, FlowFunction } from "../arkanalyzer";
import { Local } from "../arkanalyzer";
import { Value } from "../arkanalyzer";
import { ArkAssignStmt, ArkInvokeStmt, ArkReturnStmt, ArkThrowStmt, Stmt } from "../arkanalyzer";
import { ArkMethod } from "../arkanalyzer";
import { Constant } from "../arkanalyzer";
import { AbstractFieldRef, AbstractRef, ArkArrayRef, ArkInstanceFieldRef, ArkParameterRef, ArkStaticFieldRef, ClosureFieldRef, GlobalRef } from "../arkanalyzer";
import { DataflowSolver } from "./DataflowSolver";
import { AbstractInvokeExpr, ArkInstanceInvokeExpr, ArkPtrInvokeExpr, ArkStaticInvokeExpr } from "../arkanalyzer";
import { ArrayType, ClassType, FunctionType, LexicalEnvType, UnclearReferenceType, UndefinedType, VoidType } from "../arkanalyzer";
import { MethodSignature } from "../arkanalyzer";
import { PointerAnalysis } from "../arkanalyzer";
import { PointerAnalysisConfig } from "../arkanalyzer";
import * as fs from 'fs';
import { Source } from "./Source";
import { Santization } from "./Santization";
import { getPossibleRelatedNodes, INTERNAL_PARAMETER_SOURCE, INTERNAL_SINK_METHOD_toString, LOG_SINK_METHODS, Json2ArkMethod, LocalEqual, localDeclaredInCfg, propagateFact, RefEqual, ValueEqual, getThisAssignStmt, callSource, getRecallMethodInParam, Json2ArkMethod_LLM, Json2ArkMethodSignature, isClosureLocal, getClosures, getResolvedCallbackParameters } from "./Util";
import { TaintFact } from "./TaintFact";
import { MultiRef } from "./MuiltiRef";
import { PathEdgePoint } from "../arkanalyzer";
import { Logger, LOG_MODULE_TYPE } from "../arkanalyzer";
import { ArkThisRef } from "../arkanalyzer";

// @ts-ignore - ClassCategory/ArkClass may need deep import  
import { ClassCategory } from "../arkanalyzer/core/model/ArkClass";
// @ts-ignore - ANONYMOUS/INSTANCE_INIT constants
import { ANONYMOUS_CLASS_PREFIX, ANONYMOUS_METHOD_PREFIX, INSTANCE_INIT_METHOD_NAME } from "../arkanalyzer";
// @ts-ignore - FileSignature, NamespaceSignature may need deep import
import { FileSignature, NamespaceSignature } from "../arkanalyzer";

const logger = Logger.getLogger(LOG_MODULE_TYPE.ARKANALYZER, 'HapFlow');

export class TaintAnalysisChecker extends DataflowProblem<TaintFact> {
    private zeroValue: TaintFact;
    private entryPoint: Stmt;
    private entryMethod: ArkMethod;
    private scene: Scene;
    private sources: Map<string, Source> = new Map();
    private sinks: MethodSignature[] = [];
    private santizations: MethodSignature[] = [];
    private pointerAnalysis: PointerAnalysis | undefined;
    private detectOutcome: TaintFact[] = [];
    constructor(stmt: Stmt, method: ArkMethod, pta?: PointerAnalysis) {
        super();
        this.zeroValue = new TaintFact(new Constant('zeroValue', UndefinedType.getInstance()));
        this.entryPoint = stmt;
        this.entryMethod = method;
        this.scene = method.getDeclaringArkFile().getScene();
        this.pointerAnalysis = pta;
    }

    /**
     * Direct analysis for SDK callback data flows.
     * This complements IFDS by analyzing methods that may not be reachable from DummyMain
     * but contain source API calls with callbacks.
     */
    public analyzeCallbackDataFlows(): void {
        let sourceCount = 0;
        for (const method of this.scene.getMethods()) {
            const cfg = method.getCfg();
            if (!cfg) continue;

            for (const block of cfg.getBlocks()) {
                for (const stmt of block.getStmts()) {
                    if (!stmt.containsInvokeExpr()) continue;
                    const invokeExpr = stmt.getInvokeExpr();
                    if (!invokeExpr) continue;

                    // Check if this is a source API call
                    const source = callSource(invokeExpr, this.sources, this.scene, this.pointerAnalysis);
                    if (source) {
                        sourceCount++;
                        if (source.sourceType === 'callback') {
                            this.analyzeCallbackSource(method, stmt, invokeExpr, source);
                        } else if (source.sourceType === 'return') {
                            this.analyzePromiseChaining(method, stmt, invokeExpr, source);
                        }
                        continue;
                    }

                    // Also check for .then() calls whose base might be a source API
                    this.analyzeChainedThenInvoke(method, stmt, invokeExpr);
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
        if (!callbackMethod && callbackArgType && callbackArgType.constructor?.name === 'ClosureType') {
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

        // Get callback parameters from the lambda method
        const paramInstances = callbackMethod.getParameterInstances();
        if (!paramInstances || paramInstances.length === 0) return;

        // Check each callback parameter (skip error parameter if present)
        const startIndex = paramInstances.length > 1 && paramInstances[0]?.toString().includes('err') ? 1 : 0;

        for (let i = startIndex; i < paramInstances.length; i++) {
            const param = paramInstances[i];
            if (param instanceof Local) {
                const fact = new TaintFact(param);
                fact.addPath(stmt);
                this.traceCallbackParamDataFlow(callbackMethod, param, fact);
            }
        }
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
                            if (type && type.constructor?.name === 'ClosureType') {
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
        // Pattern 1: API().then(callback) - the invoke result is passed to .then()
        if (stmt instanceof ArkAssignStmt) {
            const resultVar = stmt.getDef();
            if (resultVar instanceof Local) {
                this.analyzeThenChaining(method, resultVar, stmt, source);
            }
        }

        // Pattern 2: async/await - trace returned Promise value
        if (stmt instanceof ArkAssignStmt) {
            const leftOp = stmt.getLeftOp();
            const rightOp = stmt.getRightOp();

            if (rightOp instanceof AbstractInvokeExpr) {
                const sourceCheck = callSource(rightOp, this.sources, this.scene, this.pointerAnalysis);
                if (sourceCheck && sourceCheck.sourceType === 'return' && leftOp instanceof Local) {
                    const fact = new TaintFact(leftOp);
                    fact.addPath(stmt);
                    this.traceReturnedValueDataFlow(method, leftOp, fact);
                }
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
                this.processThenCallback(method, stmt, invokeExpr);
            }
            return;
        }

        // Case 2: Intermediate variable - let x = sourceApi(); x.then(callback)
        if (!(base instanceof Local)) return;

        const sourceInvoke = this.findSourceInvokeForVariable(method, base);
        if (!sourceInvoke) return;

        const source = callSource(sourceInvoke, this.sources, this.scene, this.pointerAnalysis);
        if (!source || source.sourceType !== 'return') return;

        this.processThenCallback(method, stmt, invokeExpr);
    }

    /**
     * Process the callback of a .then() call and trace data flow.
     */
    private processThenCallback(method: ArkMethod, stmt: Stmt, invokeExpr: AbstractInvokeExpr): void {
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
        if (!callbackMethod && callbackArgType && callbackArgType.constructor?.name === 'ClosureType') {
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
            const fact = new TaintFact(resolvedParam);
            fact.addPath(stmt);
            this.traceCallbackParamDataFlow(callbackMethod, resolvedParam, fact);
        }
    }

    /**
     * Find the source invoke statement that assigns a value to the given variable.
     * Also handles Promise chains like: let x = sourceApi().then(callback)
     */
    private findSourceInvokeForVariable(method: ArkMethod, localVar: Local): AbstractInvokeExpr | null {
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
                                    return thenBase;
                                }
                            }
                        }
                    }
                    return rightOp;
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
                    const fact = new TaintFact(resolvedParam);
                    fact.addPath(sourceStmt);
                    fact.addPath(stmt);
                    this.traceCallbackParamDataFlow(callbackMethod, resolvedParam, fact);
                }
            }
        }
    }

    /**
     * Find callback method from a .then() invoke expression
     */
    private findCallbackMethodFromInvoke(callerMethod: ArkMethod, invokeExpr: AbstractInvokeExpr): ArkMethod | null {
        const cls = callerMethod.getDeclaringArkClass();

        // Look for patterns: %AC0$methodName or %AM0$methodName
        for (const m of cls.getMethods(true)) {
            const name = m.getName();
            if ((name.startsWith('%AC') || name.startsWith('%AM')) && name.includes('$')) {
                const body = m.getBody();
                if (body && body.getCfg()) {
                    return m;
                }
            }
        }
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

        while (worklist.length > 0) {
            const { var: currentVar, fact: currentFact } = worklist.pop()!;
            const key = currentVar.toString() + '|' + currentFact.getPath().map(s => s.toString()).join('->');
            if (visited.has(key)) continue;
            visited.add(key);

            // Check for sink usage
            for (const block of cfg.getBlocks()) {
                for (const stmt of block.getStmts()) {
                    if (!stmt.containsInvokeExpr()) continue;
                    const invokeExpr = stmt.getInvokeExpr();
                    if (!invokeExpr) continue;

                    if (this.callSink(invokeExpr)) {
                        const args = invokeExpr.getArgs();
                        for (const arg of args) {
                            if (ValueEqual(arg, currentVar)) {
                                const sinkFact = new TaintFact(currentVar);
                                for (const p of currentFact.getPath()) {
                                    sinkFact.addPath(p);
                                }
                                sinkFact.addPath(stmt);

                                let isNew = true;
                                for (const existing of this.detectOutcome) {
                                    const existingPath = existing.getPath();
                                    const newPath = sinkFact.getPath();
                                    if (existingPath.length > 0 && newPath.length > 0 &&
                                        existingPath[existingPath.length - 1] === newPath[newPath.length - 1]) {
                                        isNew = false;
                                        break;
                                    }
                                }
                                if (isNew) {
                                    this.detectOutcome.push(sinkFact);
                                }
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
                        const newFact = new TaintFact(leftOp);
                        for (const p of currentFact.getPath()) {
                            newFact.addPath(p);
                        }
                        newFact.addPath(stmt);
                        worklist.push({ var: leftOp, fact: newFact });
                    }

                    // Handle method calls: let result = var.method()
                    if (rightOp instanceof ArkInstanceInvokeExpr && leftOp instanceof Local) {
                        const base = rightOp.getBase();
                        if (ValueEqual(base, currentVar)) {
                            const newFact = new TaintFact(leftOp);
                            for (const p of currentFact.getPath()) {
                                newFact.addPath(p);
                            }
                            newFact.addPath(stmt);
                            worklist.push({ var: leftOp, fact: newFact });
                        }
                    }
                }
            }
        }
    }

    /**
     * Find callback method by scanning anonymous methods in the class.
     */
    private findCallbackMethod(callerMethod: ArkMethod, invokeExpr: AbstractInvokeExpr): ArkMethod | null {
        const cls = callerMethod.getDeclaringArkClass();

        // Look for anonymous callback methods that follow naming patterns
        for (const m of cls.getMethods(true)) {
            const name = m.getName();
            // Match patterns like %AC0$MethodName or %AM0$MethodName
            if ((name.startsWith('%AC') || name.startsWith('%AM')) && name.includes('$')) {
                const body = m.getBody();
                if (body && body.getCfg()) {
                    return m;
                }
            }
        }
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

        while (worklist.length > 0) {
            const { var: currentVar, fact: currentFact } = worklist.pop()!;
            const key = currentVar.toString() + '|' + currentFact.getPath().map(s => s.toString()).join('->');
            if (visited.has(key)) continue;
            visited.add(key);

            // Collect all statements in the method
            const allStmts: Stmt[] = [];
            for (const block of cfg.getBlocks()) {
                for (const stmt of block.getStmts()) {
                    allStmts.push(stmt);
                }
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
                            const sinkFact = new TaintFact(currentVar);
                            for (const p of currentFact.getPath()) {
                                sinkFact.addPath(p);
                            }
                            sinkFact.addPath(stmt);

                            // Check if this is a new detection
                            let isNew = true;
                            for (const existing of this.detectOutcome) {
                                const existingPath = existing.getPath();
                                const newPath = sinkFact.getPath();
                                if (existingPath.length > 0 && newPath.length > 0 &&
                                    existingPath[existingPath.length - 1] === newPath[newPath.length - 1]) {
                                    isNew = false;
                                    break;
                                }
                            }
                            if (isNew) {
                                this.detectOutcome.push(sinkFact);
                            }
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
                    const newFact = new TaintFact(leftOp);
                    for (const p of currentFact.getPath()) {
                        newFact.addPath(p);
                    }
                    newFact.addPath(stmt);

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
                    const newFact = new TaintFact(rightOp);
                    for (const p of currentFact.getPath()) {
                        newFact.addPath(p);
                    }
                    newFact.addPath(stmt);
                    worklist.push({ var: rightOp, fact: newFact });
                }

                // Check if currentVar is used as base for array access (e.g., data[0])
                if (currentVar instanceof Local && rightOp instanceof ArkArrayRef && LocalEqual(rightOp.getBase(), currentVar)) {
                    const newFact = new TaintFact(rightOp);
                    for (const p of currentFact.getPath()) {
                        newFact.addPath(p);
                    }
                    newFact.addPath(stmt);
                    worklist.push({ var: rightOp, fact: newFact });
                }

                // Check if currentVar is an ArkArrayRef and rightOp is field access on it (e.g., data[0].placeName)
                if (currentVar instanceof ArkArrayRef && rightOp instanceof ArkInstanceFieldRef && ValueEqual(rightOp.getBase(), currentVar)) {
                    const newFact = new TaintFact(rightOp);
                    for (const p of currentFact.getPath()) {
                        newFact.addPath(p);
                    }
                    newFact.addPath(stmt);
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
                        const newFact = new TaintFact(leftOp);
                        for (const p of currentFact.getPath()) {
                            newFact.addPath(p);
                        }
                        newFact.addPath(stmt);
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
                            const newFact = new TaintFact(leftOp);
                            for (const p of currentFact.getPath()) {
                                newFact.addPath(p);
                            }
                            newFact.addPath(stmt);
                            worklist.push({ var: leftOp, fact: newFact });
                            break;
                        }
                    }
                }
            }
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
        const methodName = expr.getMethodSignature().getMethodSubSignature().getMethodName();

        // Check internal sinks first (these are guaranteed sinks)
        if (INTERNAL_SINK_METHOD_toString.includes(methodSignature)) {
            return true;
        }

        // Also check for common log sink methods
        if (LOG_SINK_METHODS.includes(methodName)) {
            return true;
        }

        // Exact match against configured sinks
        for (const sink of this.sinks) {
            if (sink.toString() == methodSignature) {
                return true;
            }
        }

        // For SDK methods with unknown signature, fuzzy match by method name
        if (methodSignature.includes('@%unk') || methodSignature.includes('@unk')) {
            for (const sink of this.sinks) {
                if (sink.toString().includes(methodName)) {
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
            for (const param of callExpr.getArgs()) {
                if (ValueEqual(param, dataValue) || dataValue instanceof ArkInstanceFieldRef && param instanceof Local && LocalEqual(dataValue.getBase(), param)) {
                    dataFact.addPath(srcStmt);
                    const dataFactPaths = dataFact.getPath()
                    let newOutcome = true;
                    for (let i = 0; i < this.detectOutcome.length; i++) {
                        const outcomeValue = this.detectOutcome[i].getValue();
                        const outcomePath = this.detectOutcome[i].getPath();
                        if (ValueEqual(outcomeValue, dataFact.getValue()) && outcomePath[outcomePath.length - 1] == srcStmt) {
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
        if (this.getZeroValue() == dataFact && callSource(stmt.getRightOp(), this.sources, this.scene, this.pointerAnalysis)) {
            propagateFact(stmt.getDef()!, stmt, ret);
        }
    }

    protected addTaintFromSourceCall(stmt: Stmt, method: ArkMethod, ret: Set<TaintFact>) {
        const source = callSource(stmt.getInvokeExpr()!, this.sources, this.scene, this.pointerAnalysis);
        if (source) {
            const invokeExpr = stmt.getInvokeExpr()!;
            if (source.sourceType == 'callback') {
                const arg = invokeExpr.getArgs()[source.callbackIndex];
                const methodSignature = (arg.getType() as FunctionType).getMethodSignature();
                const callbackMethod = stmt.getCfg()?.getDeclaringMethod().getDeclaringArkClass().getMethod(methodSignature);
                if (callbackMethod) {
                    if (method.getParameters().length <= source.sourceIndex) {
                        return;
                    }
                    const paramRef = callbackMethod.getParameterInstances()[source.sourceIndex + (method.getParameters()[0].getType() instanceof LexicalEnvType ? 1 : 0)];
                    if (!paramRef) {
                        return;
                    }
                    propagateFact(paramRef, stmt, ret);
                }
            } else if (source.sourceType == 'ArgIn') {
                const param = method.getParameterInstances()[source.sourceIndex + (method.getParameters()[0].getType() instanceof LexicalEnvType ? 1 : 0)];
                propagateFact(param, stmt, ret);
            }
        }
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
                    checkerInstance.addTaintFromSourceAssgin(dataFact, stmt, ret);

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
                                tainted = true;
                                propagateFact(assigned, srcStmt, ret, dataFact);
                                if (assigned instanceof ArkArrayRef) {
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
                        propagateFact(invokeExpr!.getArgs()[source.sourceIndex], srcStmt, ret);
                    }
                    // Handle return-type sources: when the API returns sensitive data (e.g., getAddressesFromLocation)
                    // The return value flows through Promise.then() to the callback parameter
                    if (source && source.sourceType == 'return') {
                        // Create a special taint fact for the invoke expression result
                        // This will propagate through .then() callbacks automatically
                        const invokeResultFact = new TaintFact(invokeExpr!);
                        invokeResultFact.addPath(srcStmt);
                        ret.add(invokeResultFact);
                    }
                    if (invokeExpr instanceof ArkInstanceInvokeExpr && invokeExpr.getMethodSignature().getMethodSubSignature().getMethodName() == 'constructor' &&
                        invokeExpr.getBase().getType().toString().includes('Error')) {
                        propagateFact(invokeExpr.getBase(), srcStmt, ret, dataFact);
                    }
                } else if (srcStmt instanceof ArkThrowStmt && ValueEqual(srcStmt.getOp(), dataFact.getValue())) {
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
                        const taint = new TaintFact(base);
                        taint.addPath(srcStmt);
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
                    if (callExpr instanceof ArkInstanceInvokeExpr && (dataValue instanceof ArkInstanceFieldRef || dataValue instanceof MultiRef) && callExpr.getBase().getName() == dataValue.getBase().getName()) {
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
                    let closures = getClosures(method);
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
                const callStmt = srcStmt as ArkInvokeStmt;
                if (getRecallMethodInParam(callStmt).includes(method)) {
                    return ret;
                }
                const args = callStmt.getInvokeExpr().getArgs();
                const stmts = [...method.getCfg()!.getBlocks()][0].getStmts();
                for (let i = 0; i < args.length; i++) {
                    if (dataValue instanceof ArkInstanceFieldRef && dataValue.getBase().getName() == args[i].toString()) {
                        const realParameter = stmts[i].getDef();
                        if (realParameter) {
                            const retRef = new ArkInstanceFieldRef(realParameter as Local, dataValue.getFieldSignature());
                            propagateFact(retRef, srcStmt, ret, dataFact);
                        }
                    } else if (dataValue instanceof Local && dataValue.toString() == args[i].toString()) {
                        if (method.getParameters().length <= i) {
                            break;
                        }
                        propagateFact(method.getParameterInstances()[i + (method.getParameters()[0].getType() instanceof LexicalEnvType ? 1 : 0)], srcStmt, ret, dataFact);
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
                    } else if (retVal == dataValue) {
                        propagateFact(leftOp, srcStmt, ret, dataFact);
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
        return ValueEqual(value1, value2);
    }

    public addSinksFromJson(path: string) {
        const data = fs.readFileSync(path, 'utf-8');
        const objects = JSON.parse(data);
        for (const object of objects) {
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

    public addSourcesFromJson(path: string) {
        const data = fs.readFileSync(path, 'utf-8');
        const objects = JSON.parse(data)
        for (const object of objects) {
            let methodSignatures: MethodSignature[] = [];
            methodSignatures = Json2ArkMethodSignature(object.module, object.namespace || '', object.class || '', object.api_name, this.scene, object.parameters);

            const sourceType: string = object.source_type || 'return';
            let sourceIndex: number = -1;
            let callbackIndex: number = -1;
            if (sourceType === 'ArgIn') {
                sourceIndex = (object.tainted_param_index ?? 0) - 1;
            } else if (sourceType === 'callback') {
                callbackIndex = (object.tainted_param_index ?? 0) - 1;
                const param = object.parameters[callbackIndex].type.trim();
                const VALID_CALLBACK_PATTERN: RegExp = /^(?:.*?\.)?(?:Async)?Callback<.*>$/;
                const ASYNC_CALLBACK_PATTERN: RegExp = /^(?:.*?\.)?AsyncCallback<.*>$/;
                if (ASYNC_CALLBACK_PATTERN.test(param)) {
                    sourceIndex = 1;
                } else if (VALID_CALLBACK_PATTERN.test(param)) {
                    sourceIndex = 0;
                }
            }
            for (const ms of methodSignatures) {
                this.sources.set(ms.toString(), new Source(ms, sourceType, sourceIndex, callbackIndex));
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
