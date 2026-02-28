import { CallGraph, FuncID, CallSite, DynCallSite } from '../model/CallGraph';
import { Scene } from '../../Scene';
import { Stmt } from '../../core/base/Stmt';
import { ArkThisRef } from '../../core/base/Ref';
import { Value } from '../../core/base/Value';
import { Local } from '../../core/base/Local';
import { NodeID } from '../../core/graph/BaseExplicitGraph';
import { ContextID } from './Context';
import { Pag, FuncPag, PagNode, StorageType, InterFuncPag, PagNodeType } from './Pag';
import { IPtsCollection } from './PtsDS';
export declare class CSFuncID {
    cid: ContextID;
    funcID: FuncID;
    constructor(cid: ContextID, fid: FuncID);
}
export declare class PagBuilder {
    private pag;
    private cg;
    private funcPags;
    private interFuncPags?;
    private handledFunc;
    private ctx;
    private scene;
    private worklist;
    private pagStat;
    private staticField2UniqInstanceMap;
    private instanceField2UniqInstanceMap;
    private cid2ThisRefPtMap;
    private cid2ThisRefMap;
    private cid2ThisLocalMap;
    private sdkMethodReturnValueMap;
    private sdkMethodParamValueMap;
    private fakeSdkMethodParamDeclaringStmt;
    private funcHandledThisRound;
    private updatedNodesThisRound;
    private singletonFuncMap;
    private globalThisValue;
    private globalThisPagNode?;
    private storagePropertyMap;
    private externalScopeVariableMap;
    constructor(p: Pag, cg: CallGraph, s: Scene, kLimit: number);
    private buildFuncPagAndAddToWorklist;
    private addToFuncHandledListThisRound;
    buildForEntries(funcIDs: FuncID[]): void;
    handleReachable(): boolean;
    build(): void;
    buildFuncPag(funcID: FuncID): boolean;
    /**
     * will not create real funcPag, only create param values
     */
    private buildSDKFuncPag;
    buildPagFromFuncPag(funcID: FuncID, cid: ContextID): void;
    addEdgesFromFuncPag(funcPag: FuncPag, cid: ContextID): boolean;
    addCallsEdgesFromFuncPag(funcPag: FuncPag, cid: ContextID): boolean;
    /**
     * process Storage API
     * @returns boolean: check if the cs represent a Storage API, no matter the API will success or fail
     */
    private processStorage;
    private processStorageSetOrCreate;
    private processStorageLink;
    private processStorageProp;
    private processStorageSet;
    private processStorageGet;
    private getPropertyName;
    addDynamicCallSite(funcPag: FuncPag, funcID: FuncID): void;
    addUnknownCallSite(funcPag: FuncPag, funcID: FuncID): void;
    addDynamicCallEdge(cs: DynCallSite | CallSite, baseClassPTNode: NodeID, cid: ContextID): NodeID[];
    private getDynamicCallee;
    addUpdatedNode(nodeID: NodeID, diffPT: IPtsCollection<NodeID>): void;
    getUpdatedNodes(): Map<number, IPtsCollection<number>>;
    resetUpdatedNodes(): void;
    handleUnkownDynamicCall(cs: DynCallSite, cid: ContextID): NodeID[];
    handleUnprocessedCallSites(processedCallSites: Set<DynCallSite>): NodeID[];
    private addThisRefCallEdge;
    addStaticPagCallEdge(cs: CallSite, callerCid: ContextID, calleeCid?: ContextID): NodeID[];
    private addSDKMethodPagCallEdge;
    private addSDKMethodReturnPagEdge;
    private addSDKMethodParamPagEdge;
    private processContainerPagCallEdge;
    getOrNewPagNode(cid: ContextID, v: PagNodeType, s?: Stmt): PagNode;
    /**
     * return ThisRef PAG node according to cid, a cid has a unique ThisRef node
     * @param cid: current contextID
     */
    getOrNewThisRefNode(cid: ContextID, v: ArkThisRef): PagNode;
    getOrNewThisLoalNode(cid: ContextID, v: Local, s?: Stmt): PagNode;
    getOrNewGlobalThisNode(cid: ContextID): PagNode;
    getUniqThisLocalNode(cid: ContextID): NodeID | undefined;
    /**
     * search the storage map to get propertyNode with given storage and propertyFieldName
     * @param storage storage type: AppStorage, LocalStorage etc.
     * @param propertyName string property key
     * @returns propertyNode: PagLocalNode
     */
    getOrNewPropertyNode(storage: StorageType, propertyName: string, stmt: Stmt): PagNode;
    getPropertyNode(storage: StorageType, propertyName: string, stmt: Stmt): PagNode | undefined;
    /**
     * add PagEdge
     * @param edgeKind: edge kind differs from API
     * @param propertyNode: PAG node created by protpertyName
     * @param obj: heapObj stored with Storage API
     */
    addPropertyLinkEdge(propertyNode: PagNode, storageObj: Value, cid: ContextID, stmt: Stmt, edgeKind: number): boolean;
    getRealInstanceRef(v: Value): Value;
    /**
     * check if a method is singleton function
     * rule: static method, assign heap obj to global var or static field, return the receiver
     */
    isSingletonFunction(funcID: FuncID): boolean;
    private isValueConnected;
    private funcPagDfs;
    getGlobalThisValue(): Local;
    private getEdgeKindForAssignStmt;
    /**
     * get storageType enum with method's Declaring ClassName
     *
     * @param storageName ClassName that method belongs to, currently support AppStorage and SubscribedAbstractProperty
     * SubscribedAbstractProperty: in following listing, `link1` is infered as ClassType `SubscribedAbstractProperty`,
     * it needs to get PAG node to check the StorageType
     * let link1: SubscribedAbstractProperty<A> = AppStorage.link('PropA');
     * link1.set(a);
     * @param cs: for search PAG node in SubscribedAbstractProperty
     * @param cid: for search PAG node in SubscribedAbstractProperty
     * @returns StorageType enum
     */
    private getStorageType;
    /**\
     * ArkNewExpr, ArkNewArrayExpr, function ptr, globalThis
     */
    private stmtIsCreateAddressObj;
    private stmtIsCopyKind;
    private stmtIsWriteKind;
    private stmtIsReadKind;
    addToDynamicCallSite(funcPag: FuncPag, cs: DynCallSite): void;
    setPtForNode(node: NodeID, pts: IPtsCollection<NodeID> | undefined): void;
    getRealThisLocal(input: Local, funcId: FuncID): Local;
    doStat(): void;
    printStat(): void;
    getStat(): string;
    getUnhandledFuncs(): FuncID[];
    getHandledFuncs(): FuncID[];
    /**
     * build export edge in internal func pag
     * @param value: Value that need to check if it is from import/export
     * @param originValue: if Value if InstanceFieldRef, the base will be passed to `value` recursively,
     *                      fieldRef will be passed to `originValue`
     */
    private handleValueFromExternalScope;
    private addInterFuncEdge;
    private getSourceValueFromExternalScope;
    private getDefaultMethodSourceValue;
    private getExportSourceValue;
    private addExportVariableMap;
    getExportVariableMap(src: Local): Local[];
    addEdgesFromInterFuncPag(interFuncPag: InterFuncPag, cid: ContextID): boolean;
}
//# sourceMappingURL=PagBuilder.d.ts.map