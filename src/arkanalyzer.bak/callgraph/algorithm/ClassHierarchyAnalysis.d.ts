import { Scene } from '../../Scene';
import { Stmt } from '../../core/base/Stmt';
import { NodeID } from '../../core/graph/BaseExplicitGraph';
import { CallGraph, CallSite } from '../model/CallGraph';
import { AbstractAnalysis } from './AbstractAnalysis';
export declare class ClassHierarchyAnalysis extends AbstractAnalysis {
    constructor(scene: Scene, cg: CallGraph);
    resolveCall(callerMethod: NodeID, invokeStmt: Stmt): CallSite[];
    protected preProcessMethod(): CallSite[];
}
//# sourceMappingURL=ClassHierarchyAnalysis.d.ts.map