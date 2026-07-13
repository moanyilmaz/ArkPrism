import { CallGraph, Method } from '../CallGraph';
import { Scene } from '../../../Scene';
import { ArkMethod } from '../../../core/model/ArkMethod';
export declare class CallGraphBuilder {
    private cg;
    private scene;
    constructor(c: CallGraph, s: Scene);
    buildDirectCallGraphForScene(): void;
    buildDirectCallGraph(methods: ArkMethod[]): void;
    buildClassHierarchyCallGraph(entries: Method[], displayGeneratedMethod?: boolean): void;
    buildRapidTypeCallGraph(entries: Method[], displayGeneratedMethod?: boolean): void;
    private getDCCallee;
    private isConstructor;
    setEntries(): void;
}
//# sourceMappingURL=CallGraphBuilder.d.ts.map