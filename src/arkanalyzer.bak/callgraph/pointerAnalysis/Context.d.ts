import { FuncID } from '../model/CallGraph';
export type ContextID = number;
export declare const DUMMY_CID = 0;
declare class Context {
    private contextElems;
    static sEmptyCtx: Context;
    constructor(contextElems?: number[]);
    static newEmpty(): Context;
    static new(contextElems: number[]): Context;
    static newKLimitedContext(oldCtx: Context, elem: number, k: number): Context;
    static kLimitedContext(ctx: Context, k: number): Context;
    length(): number;
    get(index: number): number;
    toString(): String;
}
declare class ContextCache {
    private contextList;
    private contextToIDMap;
    constructor();
    getOrNewContextID(context: Context): ContextID;
    updateContext(id: ContextID, newContext: Context, oldContext: Context): boolean;
    getContextID(context: Context): ContextID | undefined;
    getContext(id: number): Context | undefined;
    getContextList(): Context[];
}
export declare class KLimitedContextSensitive {
    k: number;
    ctxCache: ContextCache;
    constructor(k: number);
    emptyContext(): Context;
    getEmptyContextID(): ContextID;
    getContextID(context: Context): ContextID;
    getContextByID(context_id: number): Context | undefined;
    getNewContextID(callerFuncId: FuncID): ContextID;
    getOrNewContext(callerCid: ContextID, calleeFuncId: FuncID, findCalleeAsTop?: boolean): ContextID;
}
export {};
//# sourceMappingURL=Context.d.ts.map