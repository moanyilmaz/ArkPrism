import { MethodSignature } from '../../core/model/ArkSignature';
import { Stmt } from '../../core/base/Stmt';
import { Value } from '../../core/base/Value';
import { Scene } from '../../Scene';
import { ArkMethod } from '../../core/model/ArkMethod';
import { BaseEdge, BaseNode, BaseExplicitGraph, NodeID } from '../../core/graph/BaseExplicitGraph';
import { ContextID } from '../pointerAnalysis/Context';
export type Method = MethodSignature;
export type CallSiteID = number;
export type FuncID = number;
export declare enum CallGraphNodeKind {
    real = 0,
    vitual = 1,
    intrinsic = 2,
    constructor = 3
}
export declare class CallSite {
    callStmt: Stmt;
    args: Value[] | undefined;
    calleeFuncID: FuncID;
    callerFuncID: FuncID;
    constructor(s: Stmt, a: Value[] | undefined, ce: FuncID, cr: FuncID);
}
export declare class DynCallSite {
    callerFuncID: FuncID;
    callStmt: Stmt;
    args: Value[] | undefined;
    protentialCalleeFuncID: FuncID | undefined;
    constructor(caller: FuncID, s: Stmt, a: Value[] | undefined, ptcCallee: FuncID | undefined);
}
export declare class CSCallSite extends CallSite {
    cid: ContextID;
    constructor(id: ContextID, cs: CallSite);
}
export declare class CallGraphEdge extends BaseEdge {
    private directCalls;
    private specialCalls;
    private indirectCalls;
    constructor(src: CallGraphNode, dst: CallGraphNode);
    addDirectCallSite(stmt: Stmt): void;
    addSpecialCallSite(stmt: Stmt): void;
    addInDirectCallSite(stmt: Stmt): void;
    getDotAttr(): string;
}
export declare class CallGraphNode extends BaseNode {
    private method;
    private ifSdkMethod;
    private isBlank;
    constructor(id: number, m: Method, k?: CallGraphNodeKind);
    getMethod(): Method;
    setSdkMethod(v: boolean): void;
    isSdkMethod(): boolean;
    get isBlankMethod(): boolean;
    set isBlankMethod(is: boolean);
    getDotAttr(): string;
    getDotLabel(): string;
}
export declare class CallGraph extends BaseExplicitGraph {
    private scene;
    private idToCallSiteMap;
    private callSiteToIdMap;
    private stmtToCallSitemap;
    private stmtToDynCallSitemap;
    private methodToCGNodeMap;
    private callPairToEdgeMap;
    private callSiteNum;
    private entries;
    private cgStat;
    private dummyMainMethodID;
    constructor(s: Scene);
    private getCallPairString;
    getCallEdgeByPair(srcID: NodeID, dstID: NodeID): CallGraphEdge | undefined;
    addCallGraphNode(method: Method, kind?: CallGraphNodeKind): CallGraphNode;
    removeCallGraphNode(nodeID: NodeID): void;
    getCallGraphNodeByMethod(method: Method): CallGraphNode;
    addDirectOrSpecialCallEdge(caller: Method, callee: Method, callStmt: Stmt, isDirectCall?: boolean): void;
    removeCallGraphEdge(nodeID: NodeID): void;
    addDynamicCallInfo(callStmt: Stmt, caller: Method, protentialCallee?: Method): void;
    addDynamicCallEdge(callerID: NodeID, calleeID: NodeID, callStmt: Stmt): void;
    getDynCallsiteByStmt(stmt: Stmt): DynCallSite | undefined;
    addStmtToCallSiteMap(stmt: Stmt, cs: CallSite): boolean;
    getCallSiteByStmt(stmt: Stmt): CallSite | undefined;
    getDynEdges(): Map<Method, Set<Method>>;
    getMethodByFuncID(id: FuncID): Method | null;
    getArkMethodByFuncID(id: FuncID): ArkMethod | null;
    getEntries(): FuncID[];
    setEntries(n: NodeID[]): void;
    dump(name: string, entry?: FuncID): void;
    detectReachable(fromID: FuncID, dstID: FuncID): boolean;
    printStat(): void;
    getStat(): string;
    setDummyMainFuncID(dummyMainMethodID: number): void;
    getDummyMainFuncID(): FuncID | undefined;
    isUnknownMethod(funcID: FuncID): boolean;
    getGraphName(): string;
}
//# sourceMappingURL=CallGraph.d.ts.map