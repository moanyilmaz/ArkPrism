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
import { AbstractInvokeExpr, ArkPtrInvokeExpr } from '../arkanalyzer';
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
import { Local } from '../arkanalyzer';
import { ArkInstanceFieldRef, ArkParameterRef } from '../arkanalyzer';
import { FunctionType } from '../arkanalyzer';
import { PointerAnalysis } from '../arkanalyzer';
import { CallGraphBuilder } from '../arkanalyzer';

// @ts-ignore - addCfg2Stmt may need deep import
import { addCfg2Stmt } from '../arkanalyzer/utils/entryMethodUtils';
// @ts-ignore - AliasType may need deep import
import { AliasType } from '../arkanalyzer/core/base/Type';
// @ts-ignore - CallSite type
import { CallSite } from '../arkanalyzer/callgraph/model/CallGraph';

const logger_hapflow = Logger.getLogger(LOG_MODULE_TYPE.ARKANALYZER, 'HapFlow');

/*
this program is roughly an implementation of the paper: Practical Extensions to the IFDS Algorithm.
compare to the original ifds paper : Precise Interprocedural Dataflow Analysis via Graph ReaCGbility,
it have several improvments:
1. construct supergraph on demand(implement in this program);
2. use endSummary and incoming tables to speed up the program(implement in this program)
*/


export abstract class DataflowSolver<D extends object> {

    protected problem: DataflowProblem<D>;
    protected workList: Array<PathEdge<D>>;
    protected pathEdgeSet: Set<PathEdge<D>>;
    protected zeroFact: D;
    protected entryFact: D | undefined;
    protected inComing: Map<PathEdgePoint<D>, Set<PathEdgePoint<D>>>;
    protected endSummary: Map<PathEdgePoint<D>, Set<PathEdgePoint<D>>>;
    protected summaryEdge: Set<PathEdge<D>>;
    protected scene: Scene;
    protected CG!: ClassHierarchyAnalysis | RapidTypeAnalysis;
    protected stmtNexts: Map<Stmt, Set<Stmt>>;
    protected laterEdges: Set<PathEdge<D>> = new Set();
    protected pointerAnalysis: PointerAnalysis | undefined;
    private externalCG?: ClassHierarchyAnalysis | RapidTypeAnalysis;

    // O(1) edge key set for fast duplicate detection
    private edgeKeys: Set<string> = new Set();

    // Budget limits for IFDS analysis
    protected maxEdges: number = 1000000;
    protected maxWorkList: number = 500000;
    protected maxMillis: number = 300000;  // 5 minutes
    private startTime: number = 0;
    protected edgesProcessed: number = 0;
    protected budgetExceeded: boolean = false;

    constructor(problem: DataflowProblem<D>, scene: Scene, pta?: PointerAnalysis, entryFact?: D, externalCG?: ClassHierarchyAnalysis | RapidTypeAnalysis) {
        this.problem = problem;
        this.scene = scene;
        this.pointerAnalysis = pta;
        this.entryFact = entryFact;
        this.externalCG = externalCG;
        this.zeroFact = problem.createZeroValue();
        this.workList = new Array<PathEdge<D>>();
        this.pathEdgeSet = new Set<PathEdge<D>>();
        this.inComing = new Map<PathEdgePoint<D>, Set<PathEdgePoint<D>>>();
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
    public getStats(): { budgetExceeded: boolean; edgesProcessed: number } {
        return {
            budgetExceeded: this.budgetExceeded,
            edgesProcessed: this.edgesProcessed
        };
    }

    public solve() {
        this.startTime = Date.now();
        this.edgesProcessed = 0;
        this.budgetExceeded = false;
        this.edgeKeys.clear();
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

        // Use externally provided CG (e.g., lifecycle-enhanced CG) if available,
        // otherwise build a fresh CHA CG from scratch.
        if (this.externalCG) {
            this.CG = this.externalCG;
            console.log('[HAPFLOW] Using externally provided CallGraph.');
        } else {
            let callGraph = new CallGraph(this.scene);
            let cgBuilder = new CallGraphBuilder(callGraph, this.scene);
            cgBuilder.buildDirectCallGraphForScene();
            this.CG = new ClassHierarchyAnalysis(this.scene, callGraph, cgBuilder);
            this.CG.start(true);
        }

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

    protected addStmtNext4ExceptionalSuccessorBlocks(block: BasicBlock, stmt: Stmt, set: Set<Stmt>) {
        const exceptionalSuccessorBlocks = block.getExceptionalSuccessorBlocks();
        if (exceptionalSuccessorBlocks && exceptionalSuccessorBlocks.length > 0) {
            for (const successor of exceptionalSuccessorBlocks) {
                const stmts = successor.getStmts();
                if (stmts.length > 0) {
                    set.add(stmts[0]);
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
                this.stmtNexts.set(stmt, new Set([stmts[stmtIndex + 1]]));
            } else {
                const set: Set<Stmt> = new Set();
                for (const successor of block.getSuccessors()) {
                    set.add(successor.getStmts()[0]);
                }
                this.addStmtNext4ExceptionalSuccessorBlocks(block, stmt, set);
            }
        }
    }

    protected setCfg4AllStmt() {
        for (const cls of this.scene.getClasses()) {
            for (const mtd of cls.getMethods(true)) {
                addCfg2Stmt(mtd);
            }
        }
    }

    protected getCallees(invokeStmt: ArkInvokeStmt): Set<ArkMethod> {
        let callees: Set<ArkMethod> = new Set();
        const invokeExpr = invokeStmt.getInvokeExpr();

        if (invokeExpr instanceof ArkPtrInvokeExpr) {
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
                callees = new Set(paramFuncs);
            }
        }
        return callees;
    }

    protected getAllCalleeMethodsFromCG(callNode: ArkInvokeStmt, paramFuncs: ArkMethod[]): Set<ArkMethod> {
        const entryNodeID = this.CG.getCallGraph().getCallGraphNodeByMethod(this.problem.getEntryMethod().getSignature()).getID();
        const callSites = this.CG.resolveCall(entryNodeID, callNode);
        let methods: Set<ArkMethod> = new Set();
        for (const callSite of callSites) {
            const methodSig = this.CG.getCallGraph().getMethodByFuncID(callSite.calleeFuncID);
            if (!methodSig) continue;
            const method = this.scene.getMethod(methodSig);
            if (method && !paramFuncs.includes(method)) {
                methods.add(method);
            }
        }

        methods = this.getActualCalleesFromParams(callNode, methods);
        return methods;
    }

    protected getActualCalleesFromParams(callNode: ArkInvokeStmt, methods: Set<ArkMethod>): Set<ArkMethod> {

        const actualCalledArgIndex: Set<number> = new Set();
        for (const method of methods) {
            const calleeCallsites: Set<any> = new Set();
            method.getCfg()?.getStmts().forEach((stmt: Stmt) => {
                if (stmt.containsInvokeExpr()) {
                    const csResult = this.CG.getCallGraph().getCallSiteByStmt(stmt);
                    if (Array.isArray(csResult)) {
                        for (const cs of csResult) {
                            calleeCallsites.add(cs);
                        }
                    } else if (csResult) {
                        calleeCallsites.add(csResult);
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
        const nexts = this.stmtNexts.get(call);
        if (!nexts || nexts.size === 0) {
            // Fallback: return the call itself if no successor is recorded
            return call;
        }
        return [...nexts][0];
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
    protected edgeKey(edge: PathEdge<D>): string {
        const startMethod = edge.edgeStart.node?.getCfg()?.getDeclaringMethod()?.getSignature()?.toString() || '';
        const endMethod = edge.edgeEnd.node?.getCfg()?.getDeclaringMethod()?.getSignature()?.toString() || '';
        const startNode = edge.edgeStart.node?.toString() || '';
        const endNode = edge.edgeEnd.node?.toString() || '';
        const startFact = edge.edgeStart.fact ? (edge.edgeStart.fact as any).getValue?.()?.toString() || '' : '';
        const endFact = edge.edgeEnd.fact ? (edge.edgeEnd.fact as any).getValue?.()?.toString() || '' : '';
        return `${startMethod}::${startNode}|${startFact}|${endMethod}::${endNode}|${endFact}`;
    }

    protected propagate(edge: PathEdge<D>) {
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
        let index = this.workList.length;
        for (let i = 0; i < this.workList.length; i++) {
            if (this.laterEdges.has(this.workList[i])) {
                index = i;
                break;
            }
        }
        this.workList.splice(index, 0, edge);
        this.pathEdgeSet.add(edge);
    }

    protected getCallEdgePoints(edge: PathEdge<D>): Set<PathEdgePoint<D>> {
        let startEdgePoint = edge.edgeStart;
        let callEdgePoints = this.inComing.get(startEdgePoint);
        if (callEdgePoints == undefined) {
            const cfg = startEdgePoint.node.getCfg();
            if (cfg && cfg.getDeclaringMethod() == this.problem.getEntryMethod()) {
                return new Set();
            }
            throw new Error('incoming does not have ' + startEdgePoint.node.getCfg()?.getDeclaringMethod().toString());
        }
        return callEdgePoints;
    }

    protected propagateIfExitCalled(callEdgePoint: PathEdgePoint<D>, returnSitePoint: PathEdgePoint<D>): void {
        let startOfCaller: Stmt = this.getStartStmt(callEdgePoint.node);
        for (let pathEdge of this.pathEdgeSet) {
            if (pathEdge.edgeStart.node == startOfCaller && pathEdge.edgeEnd == callEdgePoint) {
                this.propagate(new PathEdge<D>(pathEdge.edgeStart, returnSitePoint));
            }
        }
    }

    protected processExitNode(edge: PathEdge<D>) {
        let startEdgePoint: PathEdgePoint<D> = edge.edgeStart;
        let exitEdgePoint: PathEdgePoint<D> = edge.edgeEnd;
        const summary = this.endSummary.get(startEdgePoint);
        if (summary == undefined) {
            this.endSummary.set(startEdgePoint, new Set([exitEdgePoint]));
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
                let summaryEdgeHasCacheEdge = false;
                for (const sEdge of this.summaryEdge) {
                    if (sEdge.edgeStart == callEdgePoint && sEdge.edgeEnd.node == returnSite && sEdge.edgeEnd.fact == fact) {
                        summaryEdgeHasCacheEdge = true;
                        break;
                    }
                }
                if (!summaryEdgeHasCacheEdge) {
                    this.summaryEdge.add(cacheEdge);
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
                if (end.node instanceof ArkThrowStmt) {
                    stmt = [...this.getChildren(stmt)][0];
                }
                let edgePoint: PathEdgePoint<D> = new PathEdgePoint<D>(stmt, fact);
                const newEdge = new PathEdge<D>(start, edgePoint);
                this.propagate(newEdge);
                this.laterEdges.add(newEdge);
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
            if (cacheEdge.edgeStart === edge.edgeEnd && cacheEdge.edgeEnd.node === returnSite) {
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
        let coming: Set<PathEdgePoint<D>> | undefined = undefined;
        for (const incoming of this.inComing.keys()) {
            if (this.problem.factEqual(incoming.fact, startEdgePoint.fact) && incoming.node == startEdgePoint.node) {
                coming = this.inComing.get(incoming);
                break;
            }
        }
        if (coming == undefined) {
            this.inComing.set(startEdgePoint, new Set([callEdgePoint]));
        } else {
            coming.add(callEdgePoint);
        }
        let exitEdgePoints: Set<PathEdgePoint<D>> = new Set();
        for (const end of Array.from(this.endSummary.keys())) {
            if (this.problem.factEqual(end.fact, fact) && end.node == firstStmt) {
                exitEdgePoints = this.endSummary.get(end)!;
            }
        }
        let returnSite: Stmt = this.getReturnSiteOfCall(callEdgePoint.node);
        for (let exitEdgePoint of exitEdgePoints) {
            let returnFlowFunc = this.problem.getExitToReturnFlowFunction(exitEdgePoint.node, returnSite, callEdgePoint.node);
            for (let returnFact of returnFlowFunc.getDataFacts(exitEdgePoint.fact)) {
                this.summaryEdge.add(new PathEdge<D>(edge.edgeEnd, new PathEdgePoint<D>(returnSite, returnFact)));
            }
        }
    }

    protected doSolve() {
        while (this.workList.length != 0) {
            let pathEdge: PathEdge<D> = this.workList.shift()!;
            if (this.laterEdges.has(pathEdge)) {
                this.laterEdges.delete(pathEdge);
            }
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
                const file = this.scene.getFile(expr.getMethodSignature().getDeclaringClassSignature().getDeclaringFileSignature());
                if (file && this.scene.getFiles().includes(file)) {
                    return true;
                }
                if (stmt instanceof ArkInvokeStmt && getRecallMethodInParam(stmt).length > 0) {
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
