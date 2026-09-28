import { ArkMethod, CallGraph, RapidTypeAnalysis, Scene } from '../arkanalyzer';

export function buildTaintRta(scene: Scene, entry: ArkMethod): RapidTypeAnalysis {
    const graph = new CallGraph(scene);
    graph.setEntries([graph.getCallGraphNodeByMethod(entry.getSignature()).getID()]);
    const analysis = new RapidTypeAnalysis(scene, graph);
    // RTA's allocation set and deferred virtual calls must reach a fixed point
    // before the IFDS solver queries targets. Keep generated initializers.
    analysis.start(true);
    return analysis;
}
