/*
 * Copyright (c) 2024 Huawei Device Co., Ltd.
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { Scene } from '../arkanalyzer';
import { AbstractInvokeExpr, ArkInstanceInvokeExpr, ArkNewExpr, ArkPtrInvokeExpr, ArkStaticInvokeExpr } from '../arkanalyzer';
import { ArkAssignStmt, ArkInvokeStmt, ArkReturnStmt, ArkReturnVoidStmt, ArkThrowStmt, Stmt } from '../arkanalyzer';
import { ArkMethod } from '../arkanalyzer';
import { DataflowProblem, FlowFunction } from '../arkanalyzer';
import { PathEdge, PathEdgePoint } from '../arkanalyzer';
import { BasicBlock } from '../arkanalyzer';
import { getPossibleRelatedNodes, getRecallMethodInParam, getThisAssignStmt, ValueEqual } from './Util';
import { CallGraph } from '../arkanalyzer';
import { ClassHierarchyAnalysis } from '../arkanalyzer';
import { RapidTypeAnalysis } from '../arkanalyzer';
import { Logger, LOG_MODULE_TYPE } from '../arkanalyzer';
import { TaintFact } from './TaintFact';
import { AnalysisWorklist } from './AnalysisWorklist';
import { Local } from '../arkanalyzer';
import { ArkArrayRef, ArkInstanceFieldRef, ArkParameterRef } from '../arkanalyzer';
import { ClassType, FunctionType } from '../arkanalyzer';
import { PointerAnalysis } from '../arkanalyzer';
import { CallGraphBuilder } from '../arkanalyzer';

// @ts-ignore - addCfg2Stmt may need deep import
import { addCfg2Stmt } from '../arkanalyzer/utils/entryMethodUtils';
// @ts-ignore - AliasType may need deep import
import { AliasType } from '../arkanalyzer/core/base/Type';
// @ts-ignore - CallSite type
import { CallSite } from '../arkanalyzer/callgraph/model/CallGraph';

const logger_hapflow = Logger.getLogger(LOG_MODULE_TYPE.ARKANALYZER, 'HapFlow');

function irRecoveryEnabled(): boolean {
    return process.env.ARKPRISM_DISABLE_IR_RECOVERY !== '1';
}

/*
this program is roughly an implementation of the paper: Practical Extensions to the IFDS Algorithm.
compare to the original ifds paper : Precise Interprocedural Dataflow Analysis via Graph ReaCGbility,
it have several improvments:
1. construct supergraph on demand(implement in this program);
2. use endSummary and incoming tables to speed up the program(implement in this program)
*/


export abstract class DataflowSolver<D extends object> {

    protected problem: DataflowProblem<D>;
    protected workList: AnalysisWorklist<PathEdge<D>>;
    protected pathEdgeSet: Set<PathEdge<D>>;
    protected zeroFact: D;
    protected entryFact: D | undefined;
    protected inComing: Map<PathEdgePoint<D>, Set<PathEdgePoint<D>>>;
    private exactIncoming: WeakMap<PathEdgePoint<D>, Set<PathEdgePoint<D>>>;
    private incomingByNode = new Map<Stmt, Set<PathEdgePoint<D>>>();
    private summariesByNode = new Map<Stmt, Set<PathEdgePoint<D>>>();
    private pathsByEnd = new Map<Stmt, Set<PathEdge<D>>>();
    private summaryKeys = new Set<string>();
    private pointerCallsites = new WeakMap<ArkMethod, {
        exact: Map<Stmt, Set<ArkMethod>>;
        textual: Map<string, Set<ArkMethod>>;
    }>();
    private receiverAssignments = new WeakMap<ArkMethod, Map<string, ArkAssignStmt[]>>();
    protected endSummary: Map<PathEdgePoint<D>, Set<PathEdgePoint<D>>>;
    protected summaryEdge: Set<PathEdge<D>>;
    protected scene: Scene;
    protected CG!: ClassHierarchyAnalysis | RapidTypeAnalysis;
    protected stmtNexts: Map<Stmt, Set<Stmt>>;
    protected pointerAnalysis: PointerAnalysis | undefined;

    // O(1) edge key set. Object-scoped IDs prevent same-named locals and
    // statements in different methods from being merged.
    private edgeKeys: Set<string> = new Set();
    private objectIds: WeakMap<object, number> = new WeakMap();
    private nextObjectId: number = 1;

    // Budget limits for IFDS analysis
    protected maxEdges: number = 1000000;
    protected maxWorkList: number = 500000;
    protected maxMillis: number = 300000;  // 5 minutes
    private startTime: number = 0;
    protected edgesProcessed: number = 0;
    protected budgetExceeded: boolean = false;
    protected malformedCfgEdges: number = 0;

    constructor(problem: DataflowProblem<D>, scene: Scene, pta?: PointerAnalysis, entryFact?: D) {
        this.problem = problem;
        this.scene = scene;
        this.pointerAnalysis = pta;
        this.entryFact = entryFact;
        this.zeroFact = problem.createZeroValue();
        this.workList = new AnalysisWorklist<PathEdge<D>>();
        this.pathEdgeSet = new Set<PathEdge<D>>();
        this.inComing = new Map<PathEdgePoint<D>, Set<PathEdgePoint<D>>>();
        this.exactIncoming = new WeakMap<PathEdgePoint<D>, Set<PathEdgePoint<D>>>();
        this.endSummary = new Map<PathEdgePoint<D>, Set<PathEdgePoint<D>>>();
        this.summaryEdge = new Set<PathEdge<D>>();
        this.stmtNexts = new Map();
    }

    /**
     * Set budget limits for this solver instance.
     */
    public setBudgetOptions(options: {
        maxEdges?: number;
        maxWorkList?: number;
        maxMillis?: number;
    }): void {
        if (options.maxEdges !== undefined) this.maxEdges = options.maxEdges;
        if (options.maxWorkList !== undefined) this.maxWorkList = options.maxWorkList;
        if (options.maxMillis !== undefined) this.maxMillis = options.maxMillis;
    }

    /**
     * Get current solver stats.
     */
    public getStats(): {
        budgetExceeded: boolean;
        edgesProcessed: number;
        malformedCfgEdges: number;
    } {
        return {
            budgetExceeded: this.budgetExceeded,
            edgesProcessed: this.edgesProcessed,
            malformedCfgEdges: this.malformedCfgEdges
        };
    }

    public solve() {
        this.startTime = Date.now();
        this.edgesProcessed = 0;
        this.budgetExceeded = false;
        this.malformedCfgEdges = 0;
        this.edgeKeys.clear();
        this.objectIds = new WeakMap();
        this.nextObjectId = 1;
        this.exactIncoming = new WeakMap();
        this.pointerCallsites = new WeakMap();
        this.receiverAssignments = new WeakMap();
        this.init();
        this.doSolve();
        if (this.budgetExceeded) {
            console.log(`[HAPFLOW] IFDS ended early. Edges processed: ${this.edgesProcessed}, Path edges: ${this.pathEdgeSet.size}`);
        }
    }


    public getZeroFact(): D {
        return this.zeroFact;
    }

    protected getChildren(stmt: Stmt): Stmt[] {
        return Array.from(this.stmtNexts.get(stmt) || []);
    }

    protected init() {
        let edgePoint: PathEdgePoint<D> = new PathEdgePoint<D>(this.problem.getEntryPoint(), this.entryFact ?? this.zeroFact);
        let edge: PathEdge<D> = new PathEdge<D>(edgePoint, edgePoint);
        this.workList.push(edge);
        this.pathEdgeSet.add(edge);
        this.indexPathEdge(edge);
        this.edgeKeys.add(this.edgeKey(edge));

        // Resolve calls on demand, as in HapFlow's reference solver. Building a
        // separate graph here loses edges from the synthetic DummyMain.
        let callGraph = new CallGraph(this.scene);
        this.CG = new ClassHierarchyAnalysis(this.scene, callGraph);

        this.buildStmtMapInClass();
        this.setCfg4AllStmt();
        return;
    }

    protected buildStmtMapInClass() {
        // Don't modify scene.getMethods() - create a new array instead
        const methods = [...this.scene.getMethods(), this.problem.getEntryMethod()];
        for (const method of methods) {
            const cfg = method.getCfg();
            const blocks: BasicBlock[] = [];
            if (cfg) {
                blocks.push(...cfg.getBlocks());
            }
            for (const block of blocks) {
                this.buildStmtMapInBlock(block);
            }
        }
    }

    protected addStmtNext4ExceptionalSuccessorBlocks(
        block: BasicBlock,
        stmt: Stmt,
        set: Set<Stmt>,
        includeSuccessorRegions: boolean = false
    ) {
        const protectedBlocks = includeSuccessorRegions
            ? [block, ...block.getSuccessors().filter(
                (successor): successor is BasicBlock => successor !== undefined && successor !== null
            )]
            : [block];
        for (const protectedBlock of protectedBlocks) {
            for (const successor of protectedBlock.getExceptionalSuccessorBlocks() || []) {
                if (!successor) {
                    this.malformedCfgEdges++;
                    continue;
                }
                const firstStmt = successor.getStmts()[0];
                if (firstStmt) {
                    set.add(firstStmt);
                } else {
                    this.malformedCfgEdges++;
                }
            }
        }
        this.stmtNexts.set(stmt, set);
    }

    protected buildStmtMapInBlock(block: BasicBlock): void {
        const stmts = block.getStmts();
        for (let stmtIndex = 0; stmtIndex < stmts.length; stmtIndex++) {
            const stmt = stmts[stmtIndex];
            if (stmt instanceof ArkThrowStmt) {
                const set: Set<Stmt> = new Set();
                this.addStmtNext4ExceptionalSuccessorBlocks(block, stmt, set);
            }
            else if (stmtIndex !== stmts.length - 1) {
                const set = new Set([stmts[stmtIndex + 1]]);
                if (this.statementMayTransferToExceptionHandler(stmt)) {
                    // ArkAnalyzer can attach a try-region handler to the next
                    // block rather than the block containing the throwing
                    // expression. Inspect one CFG step without inventing an
                    // unrelated catch target.
                    this.addStmtNext4ExceptionalSuccessorBlocks(block, stmt, set, irRecoveryEnabled());
                } else {
                    this.stmtNexts.set(stmt, set);
                }
            } else {
                const set: Set<Stmt> = new Set();
                for (const successor of block.getSuccessors()) {
                    if (!successor) {
                        this.malformedCfgEdges++;
                        continue;
                    }
                    const firstStmt = successor.getStmts()[0];
                    if (firstStmt) {
                        set.add(firstStmt);
                    } else {
                        this.malformedCfgEdges++;
                    }
                }
                this.addStmtNext4ExceptionalSuccessorBlocks(block, stmt, set);
            }
        }
    }

    private statementMayTransferToExceptionHandler(stmt: Stmt): boolean {
        return stmt.getUses().some(value =>
            value instanceof ArkArrayRef ||
            value.getUses().some(nested => nested instanceof ArkArrayRef)
        );
    }

    protected setCfg4AllStmt() {
        for (const cls of this.scene.getClasses()) {
            for (const mtd of cls.getMethods(true)) {
                addCfg2Stmt(mtd);
            }
        }
    }

    protected shouldIncludeSdkCallback(stmt: Stmt, callback: ArkMethod): boolean { return true; }

    protected getCallees(invokeStmt: ArkInvokeStmt): Set<ArkMethod> {
        let callees: Set<ArkMethod> = new Set();
        const invokeExpr = invokeStmt.getInvokeExpr();

        if (irRecoveryEnabled()
            && invokeExpr instanceof ArkStaticInvokeExpr
            && invokeExpr.getMethodSignature().getMethodSubSignature().getMethodName() === 'super') {
            const callerClass = invokeStmt.getCfg()?.getDeclaringMethod().getDeclaringArkClass();
            const superClass = callerClass?.getSuperClass();
            for (const method of superClass?.getMethods(true) || []) {
                if (method.getName() === 'constructor'
                    && method.getParameters().length === invokeExpr.getArgs().length
                    && method.getCfg()) {
                    callees.add(method);
                }
            }
        } else if (invokeExpr instanceof ArkPtrInvokeExpr) {
            const ptrLocal = invokeExpr.getFuncPtrLocal();
            let functionType = ptrLocal.getType();
            if (functionType instanceof AliasType && (functionType as AliasType).getOriginalType() instanceof FunctionType) {
                functionType = (functionType as AliasType).getOriginalType();
            } else if (!(functionType instanceof FunctionType)) {
                return callees;
            }
            const method = this.scene.getMethod((functionType as FunctionType).getMethodSignature());
            if (method && method.getCfg()) {
                callees = new Set([method!]);
                callees = this.getActualCalleesFromParams(invokeStmt, callees);
            } else if (this.pointerAnalysis) {
                const possibleRelatedNodes = getPossibleRelatedNodes(ptrLocal, this.pointerAnalysis);
                possibleRelatedNodes.forEach(value => {
                    if (value instanceof Local && value.getType() instanceof FunctionType) {
                        const methodSignature = (value.getType() as FunctionType).getMethodSignature();
                        const method = this.scene.getMethod(methodSignature);
                        if (method && method.getCfg()) {
                            callees.add(method);
                        }
                    }
                })
            }
        } else {
            const invokeMethodFileSignature = invokeExpr.getMethodSignature().getDeclaringClassSignature().getDeclaringFileSignature();

            const paramFuncs = getRecallMethodInParam(invokeStmt);

            if (this.scene.getFile(invokeMethodFileSignature) && !this.scene.hasSdkFile(invokeMethodFileSignature)) {
                callees = this.getAllCalleeMethodsFromCG(invokeStmt, paramFuncs);
            } else {
                // For SDK calls, include any found paramFuncs or callbacks
                if (paramFuncs.length > 0) {
                    for (const pf of paramFuncs) {
                        if (this.shouldIncludeSdkCallback(invokeStmt, pf)) callees.add(pf);
                    }
                }
            }
        }
        this.addInstanceInitializerCallees(invokeStmt, callees);
        if (process.env.ARKPRISM_DEBUG_IFDS === '1') {
            const resolved = [...callees].map(method => method.getSignature().toString()).join(', ');
            console.log(`[HAPFLOW][CALL] ${invokeStmt.toString()} -> ${resolved || '<unresolved>'}`);
        }
        return callees;
    }

    private addInstanceInitializerCallees(callNode: ArkInvokeStmt, callees: Set<ArkMethod>): void {
        if (!irRecoveryEnabled()) return;
        const invokeExpr = callNode.getInvokeExpr();
        if (!(invokeExpr instanceof ArkInstanceInvokeExpr)
            || invokeExpr.getMethodSignature().getMethodSubSignature().getMethodName() !== 'constructor') {
            return;
        }

        // Field and object-literal initializers execute as part of construction.
        // Some ArkAnalyzer IR versions materialize %instInit but omit its invoke.
        for (const constructor of [...callees]) {
            const initializer = constructor.getDeclaringArkClass().getInstanceInitMethod();
            if (initializer?.getCfg()) {
                callees.add(initializer);
            }
        }
    }

    protected getAllCalleeMethodsFromCG(callNode: ArkInvokeStmt, paramFuncs: ArkMethod[]): Set<ArkMethod> {
        const pointerResolved = this.getPointerResolvedCallees(callNode, paramFuncs);
        if (pointerResolved.size > 0) {
            const refined = this.refineByReceiverDefinitions(callNode, pointerResolved);
            return this.getActualCalleesFromParams(callNode, refined);
        }

        const callerMethod = callNode.getCfg()?.getDeclaringMethod();
        const callerNode = callerMethod
            ? this.CG.getCallGraph().getCallGraphNodeByMethod(callerMethod.getSignature())
            : this.CG.getCallGraph().getCallGraphNodeByMethod(this.problem.getEntryMethod().getSignature());
        const callSites = this.CG.resolveCall(callerNode.getID(), callNode);
        let methods: Set<ArkMethod> = new Set();
        for (const callSite of callSites) {
            const method = this.scene.getMethod(this.CG.getCallGraph().getMethodByFuncID(callSite.calleeFuncID)!);
            if (method && !paramFuncs.includes(method)) {
                methods.add(method);
            }
        }

        methods = this.refineByReceiverDefinitions(callNode, methods);
        methods = this.getActualCalleesFromParams(callNode, methods);
        return methods;
    }

    private getPointerResolvedCallees(callNode: ArkInvokeStmt, paramFuncs: ArkMethod[]): Set<ArkMethod> {
        const methods = new Set<ArkMethod>();
        if (!this.pointerAnalysis) return methods;

        const callerMethod = callNode.getCfg()?.getDeclaringMethod();
        if (!callerMethod) return methods;

        let index = this.pointerCallsites.get(callerMethod);
        if (!index) {
            index = { exact: new Map(), textual: new Map() };
            const callGraph = this.pointerAnalysis.getCallGraph();
            const callerNode = callGraph.getCallGraphNodeByMethod(callerMethod.getSignature());
            const callerSignature = callerMethod.getSignature().toString();
            for (const edge of callerNode.getOutgoingEdges()) {
                const signature = callGraph.getMethodByFuncID(edge.getDstNode().getID());
                const method = signature ? this.scene.getMethod(signature) : null;
                if (!method?.getCfg()) continue;
                // PTA is complete before solving. Index its immutable callsites once per caller.
                const indirectCalls = (edge as unknown as { indirectCalls?: Set<Stmt> }).indirectCalls;
                for (const stmt of indirectCalls || []) {
                    let exact = index.exact.get(stmt);
                    if (!exact) index.exact.set(stmt, exact = new Set());
                    exact.add(method);
                    if (stmt.getCfg()?.getDeclaringMethod().getSignature().toString() !== callerSignature) continue;
                    const text = stmt.toString();
                    let textual = index.textual.get(text);
                    if (!textual) index.textual.set(text, textual = new Set());
                    textual.add(method);
                }
            }
            this.pointerCallsites.set(callerMethod, index);
        }
        for (const method of [...(index.exact.get(callNode) || []), ...(index.textual.get(callNode.toString()) || [])]) {
            if (!paramFuncs.includes(method)) methods.add(method);
        }
        return methods;
    }

    private refineByReceiverDefinitions(callNode: ArkInvokeStmt, methods: Set<ArkMethod>): Set<ArkMethod> {
        if (process.env.ARKPRISM_DISABLE_RECEIVER_REFINEMENT === '1') return methods;
        const invokeExpr = callNode.getInvokeExpr();
        if (!(invokeExpr instanceof ArkInstanceInvokeExpr)) return methods;

        const caller = callNode.getCfg()?.getDeclaringMethod();
        if (!caller) return methods;

        const classNames = this.collectReceiverClassNames(invokeExpr.getBase(), caller, 0, new Set());
        if (classNames.size === 0) return methods;

        const refined = new Set([...methods].filter(method =>
            classNames.has(method.getDeclaringArkClass().getName())
        ));
        return refined.size > 0 ? refined : methods;
    }

    private collectReceiverClassNames(
        value: Local,
        method: ArkMethod,
        depth: number,
        visited: Set<string>
    ): Set<string> {
        const names = new Set<string>();
        if (depth > 3) return names;

        const visitKey = `${method.getSignature().toString()}|${value.getName()}`;
        if (visited.has(visitKey)) return names;
        visited.add(visitKey);

        let assignments = this.receiverAssignments.get(method);
        if (!assignments) {
            assignments = new Map();
            for (const stmt of method.getCfg()?.getStmts() || []) {
                if (!(stmt instanceof ArkAssignStmt)) continue;
                const left = stmt.getLeftOp();
                if (!(left instanceof Local)) continue;
                const name = left.getName();
                let definitions = assignments.get(name);
                if (!definitions) assignments.set(name, definitions = []);
                definitions.push(stmt);
            }
            this.receiverAssignments.set(method, assignments);
        }
        for (const stmt of assignments.get(value.getName()) || []) {
            if (!ValueEqual(stmt.getLeftOp(), value)) continue;
            const rightOp = stmt.getRightOp();
            if (rightOp instanceof ArkNewExpr) {
                const type = rightOp.getType();
                if (type instanceof ClassType) {
                    names.add(type.getClassSignature().getClassName());
                }
                continue;
            }

            if (rightOp instanceof AbstractInvokeExpr) {
                const callee = this.scene.getMethod(rightOp.getMethodSignature());
                if (!callee?.getCfg()) continue;
                for (const returnStmt of callee.getCfg()!.getStmts()) {
                    if (!(returnStmt instanceof ArkReturnStmt)) continue;
                    const returned = returnStmt.getOp();
                    if (returned instanceof Local) {
                        for (const name of this.collectReceiverClassNames(returned, callee, depth + 1, visited)) {
                            names.add(name);
                        }
                    }
                }
                continue;
            }

            if (rightOp instanceof Local) {
                for (const name of this.collectReceiverClassNames(rightOp, method, depth + 1, visited)) {
                    names.add(name);
                }
            }
        }
        return names;
    }

    protected getActualCalleesFromParams(callNode: ArkInvokeStmt, methods: Set<ArkMethod>): Set<ArkMethod> {

        const actualCalledArgIndex: Set<number> = new Set();
        for (const method of methods) {
            const calleeCallsites: Set<any> = new Set();
            method.getCfg()?.getStmts().forEach((stmt: Stmt) => {
                if (stmt.containsInvokeExpr()) {
                    let cs = this.CG.getCallGraph().getCallSiteByStmt(stmt);
                    if (cs) {
                        calleeCallsites.add(cs);
                    }
                }
            });

            for (const callsite of calleeCallsites) {
                const invokeExpr = callsite.callStmt.getInvokeExpr();
                if (invokeExpr instanceof ArkPtrInvokeExpr && invokeExpr.getFuncPtrLocal() instanceof Local) {
                    const declaringStmt = (invokeExpr.getFuncPtrLocal() as Local).getDeclaringStmt();
                    if (declaringStmt instanceof ArkAssignStmt && declaringStmt.getRightOp() instanceof ArkParameterRef) {
                        actualCalledArgIndex.add((declaringStmt.getRightOp() as ArkParameterRef).getIndex());
                    }
                }
            }
        }
        for (const index of actualCalledArgIndex) {
            if (index >= callNode.getInvokeExpr().getArgs().length) break;
            const actuallCallee = this.scene.getMethod((callNode.getInvokeExpr().getArg(index).getType() as FunctionType).getMethodSignature());
            if (!actuallCallee) break;
            methods.add(actuallCallee)
        }
        return methods;
    }

    protected getReturnSiteOfCall(call: Stmt): Stmt {
        return [...this.stmtNexts.get(call)!][0];
    }

    protected getStartStmt(call: Stmt): Stmt {
        return getThisAssignStmt(call.getCfg().getDeclaringMethod());
    }

    protected pathEdgeSetHasEdge(edge: PathEdge<D>) {
        // O(1) check using edge key set
        const key = this.edgeKey(edge);
        return this.edgeKeys.has(key);
    }

    /**
     * Generate a unique key for an edge for O(1) duplicate detection.
     */
    private objectKey(value: unknown): string {
        if ((typeof value === 'object' && value !== null) || typeof value === 'function') {
            const objectValue = value as object;
            let id = this.objectIds.get(objectValue);
            if (id === undefined) {
                id = this.nextObjectId++;
                this.objectIds.set(objectValue, id);
            }
            return `o${id}`;
        }
        return `${typeof value}:${String(value)}`;
    }

    protected edgeKey(edge: PathEdge<D>): string {
        const startValue = (edge.edgeStart.fact as any)?.getValue?.() ?? edge.edgeStart.fact;
        const endValue = (edge.edgeEnd.fact as any)?.getValue?.() ?? edge.edgeEnd.fact;
        const startSource = (edge.edgeStart.fact as any)?.getSourceIdentityKey?.() ?? 'unseeded';
        const endSource = (edge.edgeEnd.fact as any)?.getSourceIdentityKey?.() ?? 'unseeded';
        const startNode = this.objectKey(edge.edgeStart.node);
        const endNode = this.objectKey(edge.edgeEnd.node);
        const startFact = this.objectKey(startValue);
        const endFact = this.objectKey(endValue);
        return `${startNode}|${startFact}|${startSource}|${endNode}|${endFact}|${endSource}`;
    }

    protected edgePointEqual(left: PathEdgePoint<D>, right: PathEdgePoint<D>): boolean {
        return left.node === right.node && this.problem.factEqual(left.fact, right.fact);
    }

    protected findEquivalentPoint<T>(
        points: Map<PathEdgePoint<D>, T>,
        target: PathEdgePoint<D>
    ): PathEdgePoint<D> | undefined {
        const index = points === this.inComing ? this.incomingByNode
            : points === this.endSummary ? this.summariesByNode : undefined;
        const candidates = index ? index.get(target.node) || [] : points.keys();
        for (const point of candidates) {
            if (this.edgePointEqual(point, target)) {
                return point;
            }
        }
        return undefined;
    }

    protected propagate(edge: PathEdge<D>, deferred = false) {
        // Check budget limits
        if (this.budgetExceeded) return;

        const key = this.edgeKey(edge);
        if (this.edgeKeys.has(key)) {
            return;  // O(1) duplicate check
        }

        // Check budget limits
        this.edgesProcessed++;
        if (this.edgesProcessed > this.maxEdges) {
            console.log('[HAPFLOW] IFDS budget exceeded: max edges reached');
            this.budgetExceeded = true;
            return;
        }

        if (this.workList.length > this.maxWorkList) {
            console.log('[HAPFLOW] IFDS budget exceeded: max worklist reached');
            this.budgetExceeded = true;
            return;
        }

        if (Date.now() - this.startTime > this.maxMillis) {
            console.log('[HAPFLOW] IFDS budget exceeded: max time reached');
            this.budgetExceeded = true;
            return;
        }

        this.edgeKeys.add(key);
        if (deferred) this.workList.defer(edge);
        else this.workList.push(edge);
        this.pathEdgeSet.add(edge);
        this.indexPathEdge(edge);
    }

    private indexPathEdge(edge: PathEdge<D>): void {
        let edges = this.pathsByEnd.get(edge.edgeEnd.node);
        if (!edges) this.pathsByEnd.set(edge.edgeEnd.node, edges = new Set());
        edges.add(edge);
    }

    private indexPoint(index: Map<Stmt, Set<PathEdgePoint<D>>>, point: PathEdgePoint<D>): void {
        let points = index.get(point.node);
        if (!points) index.set(point.node, points = new Set());
        points.add(point);
    }

    private addSummary(edge: PathEdge<D>): boolean {
        const key = `${this.objectKey(edge.edgeStart)}|${this.objectKey(edge.edgeEnd.node)}|${this.objectKey(edge.edgeEnd.fact)}`;
        if (this.summaryKeys.has(key)) return false;
        this.summaryKeys.add(key);
        this.summaryEdge.add(edge);
        return true;
    }

    protected getCallEdgePoints(edge: PathEdge<D>): Set<PathEdgePoint<D>> {
        let startEdgePoint = edge.edgeStart;
        let callEdgePoints = this.exactIncoming.get(startEdgePoint);
        if (!callEdgePoints) {
            const incomingKey = this.findEquivalentPoint(this.inComing, startEdgePoint);
            callEdgePoints = incomingKey ? this.inComing.get(incomingKey) : undefined;
        }
        if (callEdgePoints == undefined) {
            const declaringMethod = startEdgePoint.node.getCfg()?.getDeclaringMethod();
            if (declaringMethod == this.problem.getEntryMethod()) {
                return new Set();
            }
            const methodSignature = declaringMethod?.getSignature?.().toString() || 'unknown';
            const nodeText = startEdgePoint.node?.toString?.() || 'unknown';
            const factText = (startEdgePoint.fact as any)?.getValue?.()?.toString?.() || 'unknown';
            let sameNodeEntries = 0;
            let equivalentFactEntries = 0;
            for (const point of this.inComing.keys()) {
                if (point.node === startEdgePoint.node) sameNodeEntries++;
                if (this.problem.factEqual(point.fact, startEdgePoint.fact)) equivalentFactEntries++;
            }
            throw new Error(
                `incoming invariant violation: method=${methodSignature}, node=${nodeText}, `
                + `fact=${factText}, incomingEntries=${this.inComing.size}, `
                + `sameNodeEntries=${sameNodeEntries}, equivalentFactEntries=${equivalentFactEntries}`
            );
        }
        return callEdgePoints;
    }

    protected recordIncoming(
        startEdgePoint: PathEdgePoint<D>,
        callEdgePoint: PathEdgePoint<D>
    ): void {
        let coming = this.exactIncoming.get(startEdgePoint);
        if (!coming) {
            const incomingKey = this.findEquivalentPoint(this.inComing, startEdgePoint);
            coming = incomingKey ? this.inComing.get(incomingKey) : undefined;
        }

        if (!coming) {
            coming = new Set<PathEdgePoint<D>>();
            this.inComing.set(startEdgePoint, coming);
            this.indexPoint(this.incomingByNode, startEdgePoint);
        }
        coming.add(callEdgePoint);

        // Keep an identity-stable alias for every propagated method-start edge.
        // ArkIR values may be refined after insertion, so semantic fact equality
        // alone is not a stable map key over the complete solver lifetime.
        this.exactIncoming.set(startEdgePoint, coming);
    }

    protected propagateIfExitCalled(callEdgePoint: PathEdgePoint<D>, returnSitePoint: PathEdgePoint<D>): void {
        let startOfCaller: Stmt = this.getStartStmt(callEdgePoint.node);
        for (let pathEdge of this.pathsByEnd.get(callEdgePoint.node) || []) {
            if (pathEdge.edgeStart.node == startOfCaller && this.edgePointEqual(pathEdge.edgeEnd, callEdgePoint)) {
                this.propagate(new PathEdge<D>(pathEdge.edgeStart, returnSitePoint));
            }
        }
    }

    protected processExitNode(edge: PathEdge<D>) {
        let startEdgePoint: PathEdgePoint<D> = edge.edgeStart;
        let exitEdgePoint: PathEdgePoint<D> = edge.edgeEnd;
        const summaryKey = this.findEquivalentPoint(this.endSummary, startEdgePoint);
        const summary = summaryKey ? this.endSummary.get(summaryKey) : undefined;
        if (summary == undefined) {
            this.endSummary.set(startEdgePoint, new Set([exitEdgePoint]));
            this.indexPoint(this.summariesByNode, startEdgePoint);
        } else {
            summary.add(exitEdgePoint);
        }
        const callEdgePoints = this.getCallEdgePoints(edge);
        for (let callEdgePoint of callEdgePoints) {
            let returnSite: Stmt = this.getReturnSiteOfCall(callEdgePoint.node);
            if (!returnSite) continue;
            let returnFlowFunc: FlowFunction<D> = this.problem.getExitToReturnFlowFunction(exitEdgePoint.node, returnSite, callEdgePoint.node);
            for (let fact of returnFlowFunc.getDataFacts(exitEdgePoint.fact)) {
                let returnSitePoint: PathEdgePoint<D> = new PathEdgePoint<D>(returnSite, fact);
                let cacheEdge: PathEdge<D> = new PathEdge<D>(callEdgePoint, returnSitePoint);
                if (this.addSummary(cacheEdge)) {
                    this.propagateIfExitCalled(callEdgePoint, returnSitePoint);
                }
            }
        }
    }

    protected processNormalNode(edge: PathEdge<D>) {
        let start: PathEdgePoint<D> = edge.edgeStart;
        let end: PathEdgePoint<D> = edge.edgeEnd;
        let stmts: Stmt[] = [...this.getChildren(end.node)].reverse();
        for (let stmt of stmts) {
            if (!stmt) continue;
            let flowFunction: FlowFunction<D> = this.problem.getNormalFlowFunction(end.node, stmt);
            let set: Set<D> = flowFunction.getDataFacts(end.fact);
            for (let fact of set) {
                let edgePoint: PathEdgePoint<D> = new PathEdgePoint<D>(stmt, fact);
                const newEdge = new PathEdge<D>(start, edgePoint);
                this.propagate(newEdge, true);
            }
        }
    }

    protected processCallNode(edge: PathEdge<D>) {
        let start: PathEdgePoint<D> = edge.edgeStart;
        let callEdgePoint: PathEdgePoint<D> = edge.edgeEnd;
        const invokeStmt = callEdgePoint.node as ArkInvokeStmt;
        let callees = this.getCallees(invokeStmt);
        let returnSite: Stmt = this.getReturnSiteOfCall(callEdgePoint.node);
        for (let cacheEdge of this.summaryEdge) {
            if (this.edgePointEqual(cacheEdge.edgeStart, edge.edgeEnd) && cacheEdge.edgeEnd.node === returnSite) {
                this.propagate(new PathEdge<D>(start, cacheEdge.edgeEnd));
                return;
            }
        }
        for (let callee of callees) {
            let callFlowFunc: FlowFunction<D> = this.problem.getCallFlowFunction(invokeStmt, callee);
            if (!callee || !callee.getCfg()) {
                logger_hapflow.info('******* undefined cfg  ' + this.scene.getRealProjectDir());
                continue;
            }
            let firstStmt: Stmt = getThisAssignStmt(callee);
            let facts: Set<D> = callFlowFunc.getDataFacts(callEdgePoint.fact);
            for (let fact of facts) {
                this.callNodeFactPropagate(edge, firstStmt, fact);
            }
        }
        if (!returnSite) return;
        let callToReturnflowFunc: FlowFunction<D> = this.problem.getCallToReturnFlowFunction(edge.edgeEnd.node, returnSite);
        let set: Set<D> = callToReturnflowFunc.getDataFacts(callEdgePoint.fact);
        for (let fact of set) {
            this.propagate(new PathEdge<D>(start, new PathEdgePoint<D>(returnSite, fact)));
        }
    }

    protected callNodeFactPropagate(edge: PathEdge<D>, firstStmt: Stmt, fact: D): void {
        let callEdgePoint: PathEdgePoint<D> = edge.edgeEnd;
        let startEdgePoint: PathEdgePoint<D> = new PathEdgePoint(firstStmt, fact);
        this.propagate(new PathEdge<D>(startEdgePoint, startEdgePoint));
        this.recordIncoming(startEdgePoint, callEdgePoint);
        let exitEdgePoints: Set<PathEdgePoint<D>> = new Set();
        const summaryKey = this.findEquivalentPoint(
            this.endSummary,
            new PathEdgePoint<D>(firstStmt, fact)
        );
        if (summaryKey) {
            exitEdgePoints = this.endSummary.get(summaryKey)!;
        }
        let returnSite: Stmt = this.getReturnSiteOfCall(callEdgePoint.node);
        if (!returnSite) return;
        for (let exitEdgePoint of exitEdgePoints) {
            let returnFlowFunc = this.problem.getExitToReturnFlowFunction(exitEdgePoint.node, returnSite, callEdgePoint.node);
            for (let returnFact of returnFlowFunc.getDataFacts(exitEdgePoint.fact)) {
                const returnPoint = new PathEdgePoint<D>(returnSite, returnFact);
                if (this.addSummary(new PathEdge<D>(edge.edgeEnd, returnPoint))) {
                    this.propagateIfExitCalled(callEdgePoint, returnPoint);
                }
            }
        }
    }

    protected doSolve() {
        while (this.workList.length != 0) {
            if (this.budgetExceeded) break;
            if (Date.now() - this.startTime > this.maxMillis) {
                this.budgetExceeded = true;
                console.log('[HAPFLOW] IFDS budget exceeded: max time reached');
                break;
            }
            let pathEdge: PathEdge<D> = this.workList.shift()!;
            let targetStmt: Stmt = pathEdge.edgeEnd.node;
            if (!targetStmt) {
                logger_hapflow.info('******* undefined targetstmt  ' + this.scene.getRealProjectDir())
                continue
            }
            if (this.isCallStatement(targetStmt)) {
                this.processCallNode(pathEdge);
            } else if (this.isExitStatement(targetStmt)) {
                this.processExitNode(pathEdge);
            } else {
                this.processNormalNode(pathEdge);
            }
        }
    }

    protected isCallStatement(stmt: Stmt): boolean {
        for (const expr of stmt.getExprs()) {
            if (expr instanceof ArkPtrInvokeExpr) {
                const ptrType = expr.getFuncPtrLocal().getType();
                if (ptrType instanceof FunctionType) {
                    const file = this.scene.getFile(ptrType.getMethodSignature().getDeclaringClassSignature().getDeclaringFileSignature());
                    if (file && this.scene.getFiles().includes(file)) {
                        return true;
                    }
                }
            }
            if (expr instanceof AbstractInvokeExpr) {
                if (irRecoveryEnabled()
                    && expr instanceof ArkStaticInvokeExpr
                    && expr.getMethodSignature().getMethodSubSignature().getMethodName() === 'super') {
                    return true;
                }
                const file = this.scene.getFile(expr.getMethodSignature().getDeclaringClassSignature().getDeclaringFileSignature());
                if (file && this.scene.getFiles().includes(file)) {
                    return true;
                }
                if ((stmt instanceof ArkInvokeStmt || stmt instanceof ArkAssignStmt) && getRecallMethodInParam(stmt).length > 0) {
                    return true;
                }
            }
        }
        return false;
    }

    protected isExitStatement(stmt: Stmt): boolean {
        return stmt instanceof ArkReturnStmt || stmt instanceof ArkReturnVoidStmt;
    }

    public getPathEdgeSet(): Set<PathEdge<D>> {
        return this.pathEdgeSet;
    }
}
