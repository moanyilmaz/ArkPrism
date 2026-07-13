/**
 * ArkPrism - Layer 3: Call Graph Construction
 * Builds an RTA/CHA call graph with lifecycle state machine augmentation.
 *
 * Enhanced with LifecycleModeler: replaces simplistic LIFECYCLE_ORDER pairs
 * with a proper 3-layer state machine (Ability → Component → Callback)
 * that captures cross-layer implicit framework calls.
 *
 * Aligned with ArkAnalyzer's actual CallGraph API:
 *   - CallGraph extends BaseExplicitGraph
 *   - Nodes: CallGraphNode with getMethod() -> MethodSignature
 *   - Edges: addDirectOrSpecialCallEdge(caller, callee, stmt)
 *   - Iteration: nodesItor(), getOutgoingEdges()
 */

import { Scene, ArkMethod, CallGraph, COMPONENT_LIFECYCLE_METHOD_NAME, LIFECYCLE_METHOD_NAME } from './arkanalyzer';
import { LifecycleModeler, LifecycleModel } from './lifecycleModeler';

/** Entry method names recognized as roots of analysis.
 * Uses ArkAnalyzer's official lifecycle constants + user interaction callbacks.
 * These serve as a fallback when LifecycleModeler is not used.
 */
export const ENTRY_METHOD_NAMES: string[] = [
    // User interaction triggers (Priority 1)
    "onClick", "onTouch", "onDragStart", "onDragEnter", "onDragMove",
    "onDragLeave", "onDrop", "onDragEnd", "onKeyEvent", "onFocusAxisEvent",
    "onChange", "onSubmit", "onSelect", "onCheckedChange", "onTextSelectionChange",
    "onScrollEdge", "onScrollFrameBegin", "onReachStart", "onReachEnd",
    // Component lifecycle (Priority 2) — from ArkAnalyzer COMPONENT_LIFECYCLE_METHOD_NAME
    ...COMPONENT_LIFECYCLE_METHOD_NAME,
    // UIAbility lifecycle (Priority 3) — from ArkAnalyzer LIFECYCLE_METHOD_NAME
    ...LIFECYCLE_METHOD_NAME,
    // Extension/Service lifecycle
    "onConnect", "onDisconnect", "onRequest",
    // Default init
    "_DEFAULT_ARK_METHOD", "constructor"
];

/**
 * Get the priority level of a method name as an entry point.
 * Lower number = higher priority.
 */
export function getEntryPriority(methodName: string): number {
    const userInteraction = [
        "onClick", "onTouch", "onDragStart", "onDragEnter", "onDragMove",
        "onDragLeave", "onDrop", "onDragEnd", "onKeyEvent", "onFocusAxisEvent",
        "onChange", "onSubmit", "onSelect", "onCheckedChange"
    ];
    // Use official ArkAnalyzer constants
    const componentLifecycle: string[] = COMPONENT_LIFECYCLE_METHOD_NAME as unknown as string[];
    const appLifecycle: string[] = LIFECYCLE_METHOD_NAME as unknown as string[];

    if (userInteraction.includes(methodName)) return 1;
    if (componentLifecycle.includes(methodName)) return 2;
    if (appLifecycle.includes(methodName)) return 3;
    if (methodName === "constructor" || methodName === "_DEFAULT_ARK_METHOD") return 4;
    return 99;
}

/**
 * Get the entry type label for a method.
 */
export function getEntryType(methodName: string): "user_interaction" | "component_lifecycle" | "app_lifecycle" | "initialization" | "unknown" {
    let p = getEntryPriority(methodName);
    if (p === 1) return "user_interaction";
    if (p === 2) return "component_lifecycle";
    if (p === 3) return "app_lifecycle";
    if (p === 4) return "initialization";
    return "unknown";
}

/**
 * Build an enhanced call graph for the project using the LifecycleModeler.
 *
 * Strategy:
 *   1. Build lifecycle model (3-layer state machine)
 *   2. Collect entry methods from lifecycle model
 *   3. Try RTA with entry points
 *   4. Fallback to CHA if RTA fails
 *   5. Augment with lifecycle state machine transitions (intra-layer + cross-layer)
 */
export interface BuildCallGraphOptions {
    noLifecycle?: boolean;  // Skip lifecycle state machine augmentation
}

export function buildCallGraph(scene: Scene, opts?: BuildCallGraphOptions): CallGraph {
    console.log("[CALLGRAPH] Building call graph with lifecycle state machine...");

    // Build lifecycle model
    const modeler = new LifecycleModeler(scene);
    const lifecycleModel = opts?.noLifecycle ? undefined : modeler.buildModel();

    // Collect entry method signatures from lifecycle model
    let entryPoints = collectEntryPoints(scene, lifecycleModel);
    console.log(`[CALLGRAPH] Found ${entryPoints.length} entry points (lifecycle-aware).`);

    let callGraph: CallGraph;

    // Strategy: Try RTA first, fallback to CHA
    try {
        console.log("[CALLGRAPH] Attempting RTA call graph construction...");
        callGraph = scene.makeCallGraphRTA(entryPoints);
        console.log(`[CALLGRAPH] RTA call graph built. Nodes: ${callGraph.getNodeNum()}`);
    } catch (e) {
        console.log(`[CALLGRAPH] RTA failed: ${e}. Falling back to CHA...`);
        try {
            callGraph = scene.makeCallGraphCHA(entryPoints);
            console.log(`[CALLGRAPH] CHA call graph built. Nodes: ${callGraph.getNodeNum()}`);
        } catch (e2) {
            throw new Error(`[CALLGRAPH] All call graph strategies failed: ${e2}`);
        }
    }

    // Augment with lifecycle state machine transitions (skip entirely when noLifecycle)
    if (!opts?.noLifecycle) {
        augmentLifecycleEdges(callGraph, scene, lifecycleModel);
    } else {
        console.log('[CALLGRAPH] Lifecycle augmentation skipped (--no-lifecycle).');
    }

    return callGraph;
}

/**
 * Get the LifecycleModeler instance used during call graph construction.
 * Callers can use this to access the lifecycle model for other analyses.
 */
export function buildLifecycleModel(scene: Scene): LifecycleModeler {
    const modeler = new LifecycleModeler(scene);
    modeler.buildModel();
    return modeler;
}

/**
 * Collect entry point method signatures from the scene.
 * Uses the lifecycle model for organized entry point collection.
 */
function collectEntryPoints(scene: Scene, lifecycleModel?: LifecycleModel): any[] {
    let entryPoints: any[] = [];

    if (lifecycleModel) {
        // Use lifecycle model entry methods (ordered: ability → component → callback)
        const lifecycleMethods = [
            ...lifecycleModel.entryMethodsByLayer.ability,
            ...lifecycleModel.entryMethodsByLayer.component,
            ...lifecycleModel.entryMethodsByLayer.callback,
        ];
        for (const method of lifecycleMethods) {
            entryPoints.push(method.getSignature());
        }

        // RTA is top-down: it only discovers methods reachable from entry points.
        // If entry methods only call SDK methods (e.g., onCreate calling geoLocationManager),
        // RTA cannot find other project methods like constructors or instInit.
        // Solution: include ALL project methods as entry points so RTA builds a complete CG.
        // This makes RTA behave more like CHA but preserves RTA's type-based filtering
        // for virtual dispatch resolution.
        const lifecycleSigs = new Set(entryPoints.map(ep => ep.toString()));
        for (const method of scene.getMethods()) {
            const sig = method.getSignature().toString();
            if (!lifecycleSigs.has(sig)) {
                entryPoints.push(method.getSignature());
            }
        }
    } else {
        // Fallback to legacy entry point collection
        for (const method of scene.getMethods()) {
            let methodName = method.getName();
            if (ENTRY_METHOD_NAMES.includes(methodName)) {
                entryPoints.push(method.getSignature());
            }
        }
    }

    return entryPoints;
}

/**
 * Augment the call graph with lifecycle state machine transitions.
 *
 * This replaces the old LIFECYCLE_ORDER simple pairs with the full
 * LifecycleModeler transition graph, including:
 *   - Intra-layer transitions (Ability→Ability, Component→Component)
 *   - Cross-layer transitions (Ability→Component, framework implicit calls)
 */
function augmentLifecycleEdges(cg: CallGraph, scene: Scene, lifecycleModel?: LifecycleModel): void {
    let augmentedCount = 0;
    let crossLayerCount = 0;

    if (lifecycleModel) {
        // Use the lifecycle model's transition graph
        for (const transition of lifecycleModel.transitions) {
            try {
                let fromSig = transition.fromMethod.getSignature();
                let toSig = transition.toMethod.getSignature();
                let fromNode = cg.getCallGraphNodeByMethod(fromSig);
                let toNode = cg.getCallGraphNodeByMethod(toSig);
                if (fromNode && toNode) {
                    let existingEdge = cg.getCallEdgeByPair(fromNode.getID(), toNode.getID());
                    if (!existingEdge) {
                        // Get a representative stmt from the 'from' method
                        let body = transition.fromMethod.getBody();
                        if (body) {
                            let cfg = body.getCfg();
                            let stmts = cfg.getStmts();
                            if (stmts.length > 0) {
                                cg.addDirectOrSpecialCallEdge(fromSig, toSig, stmts[0], true);
                                augmentedCount++;
                                if (transition.crossLayer) {
                                    crossLayerCount++;
                                }
                            }
                        }
                    }
                }
            } catch (_) {
                // Edge addition may fail, skip
            }
        }

        console.log(`[CALLGRAPH] Augmented ${augmentedCount} lifecycle edges (${crossLayerCount} cross-layer) from state machine model.`);
    } else {
        // Fallback: use legacy LIFECYCLE_ORDER pairs
        const LIFECYCLE_ORDER: string[][] = [
            ["onCreate", "onWindowStageCreate"],
            ["onWindowStageCreate", "onForeground"],
            ["onForeground", "onBackground"],
            ["onBackground", "onWindowStageDestroy"],
            ["aboutToAppear", "build"],
            ["build", "onPageShow"],
            ["onPageShow", "onPageHide"],
            ["onPageHide", "aboutToDisappear"]
        ];

        for (const method of scene.getMethods()) {
            let methodName = method.getName();

            for (const [from, to] of LIFECYCLE_ORDER) {
                if (methodName === from) {
                    let targetMethods = method.getDeclaringArkClass().getMethods().filter(m => m.getName() === to);
                    for (let targetMethod of targetMethods) {
                        let fromSig = method.getSignature();
                        let toSig = targetMethod.getSignature();
                        try {
                            let fromNode = cg.getCallGraphNodeByMethod(fromSig);
                            let toNode = cg.getCallGraphNodeByMethod(toSig);
                            if (fromNode && toNode) {
                                let existingEdge = cg.getCallEdgeByPair(fromNode.getID(), toNode.getID());
                                if (!existingEdge) {
                                    let body = method.getBody();
                                    if (body) {
                                        let cfg = body.getCfg();
                                        let stmts = cfg.getStmts();
                                        if (stmts.length > 0) {
                                            cg.addDirectOrSpecialCallEdge(fromSig, toSig, stmts[0], true);
                                            augmentedCount++;
                                        }
                                    }
                                }
                            }
                        } catch (_) {
                            // Edge addition may fail, skip
                        }
                    }
                }
            }
        }

        console.log(`[CALLGRAPH] Augmented ${augmentedCount} lifecycle implicit edges (legacy mode).`);
    }
}
