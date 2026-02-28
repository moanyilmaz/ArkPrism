/**
 * ArkPrism - Layer 3: Call Graph Construction
 * Builds an RTA/CHA call graph with lifecycle edge augmentation.
 *
 * Aligned with ArkAnalyzer's actual CallGraph API:
 *   - CallGraph extends BaseExplicitGraph
 *   - Nodes: CallGraphNode with getMethod() -> MethodSignature
 *   - Edges: addDirectOrSpecialCallEdge(caller, callee, stmt)
 *   - Iteration: nodesItor(), getOutgoingEdges()
 */

import { Scene, ArkMethod, CallGraph, COMPONENT_LIFECYCLE_METHOD_NAME, LIFECYCLE_METHOD_NAME } from './arkanalyzer';

/** Lifecycle method execution order in HarmonyOS */
const LIFECYCLE_ORDER: string[][] = [
    // UIAbility lifecycle
    ["onCreate", "onWindowStageCreate"],
    ["onWindowStageCreate", "onForeground"],
    ["onForeground", "onBackground"],
    ["onBackground", "onWindowStageDestroy"],
    // Page/Component lifecycle
    ["aboutToAppear", "build"],
    ["build", "onPageShow"],
    ["onPageShow", "onPageHide"],
    ["onPageHide", "aboutToDisappear"]
];

/** Entry method names recognized as roots of analysis.
 * Uses ArkAnalyzer's official lifecycle constants + user interaction callbacks.
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
 * Build an enhanced call graph for the project.
 *
 * Strategy:
 *   1. Collect entry methods from scene
 *   2. Try RTA with entry points
 *   3. Fallback to CHA if RTA fails
 *   4. Augment with lifecycle implicit edges
 */
export function buildCallGraph(scene: Scene): CallGraph {
    console.log("[CALLGRAPH] Building call graph...");

    // Collect entry method signatures
    let entryPoints = collectEntryPoints(scene);
    console.log(`[CALLGRAPH] Found ${entryPoints.length} entry points.`);

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

    // Augment with lifecycle implicit edges
    augmentLifecycleEdges(callGraph, scene);

    return callGraph;
}

/**
 * Collect entry point method signatures from the scene.
 */
function collectEntryPoints(scene: Scene): any[] {
    let entryPoints: any[] = [];
    for (const method of scene.getMethods()) {
        let methodName = method.getName();
        if (ENTRY_METHOD_NAMES.includes(methodName)) {
            entryPoints.push(method.getSignature());
        }
    }
    return entryPoints;
}

/**
 * Augment the call graph with lifecycle ordering edges.
 * In HarmonyOS, certain lifecycle methods are called in a fixed order by the framework.
 */
function augmentLifecycleEdges(cg: CallGraph, scene: Scene): void {
    let augmentedCount = 0;

    for (const method of scene.getMethods()) {
        let methodName = method.getName();

        for (const [from, to] of LIFECYCLE_ORDER) {
            if (methodName === from) {
                // Find the 'to' method in the same class
                let targetMethods = method.getDeclaringArkClass().getMethods().filter(m => m.getName() === to);
                for (let targetMethod of targetMethods) {
                    let fromSig = method.getSignature();
                    let toSig = targetMethod.getSignature();
                    try {
                        // Use a dummy stmt for the lifecycle edge
                        // First check if edge already exists
                        let fromNode = cg.getCallGraphNodeByMethod(fromSig);
                        let toNode = cg.getCallGraphNodeByMethod(toSig);
                        if (fromNode && toNode) {
                            let existingEdge = cg.getCallEdgeByPair(fromNode.getID(), toNode.getID());
                            if (!existingEdge) {
                                // Get first stmt from the 'from' method
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

    console.log(`[CALLGRAPH] Augmented ${augmentedCount} lifecycle implicit edges.`);
}
