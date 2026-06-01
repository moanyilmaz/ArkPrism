/**
 * ViewTree Analyzer for ArkUI Component Tree Analysis
 *
 * Detects:
 * 1. Event handler bindings (onClick, onTouch, etc.)
 * 2. State variable usage in UI components
 * 3. Custom component value transfers
 * 4. Builder patterns
 *
 * This information helps:
 * - Improve entry point detection (UI components as analysis roots)
 * - Track state-to-UI data flow
 * - Identify implicit callback edges missed by static call analysis
 */

import {
    Scene, ArkClass, ArkMethod, ArkField,
    ViewTree, ViewTreeNode
} from './arkanalyzer';

/**
 * Represents a detected UI callback binding
 */
export interface UICallbackBinding {
    /** The view tree node containing the callback */
    nodeName: string;
    /** Callback attribute name (e.g., "onClick") */
    attributeName: string;
    /** The target method that will be called */
    targetMethod: string;
    /** State variables used in this callback */
    stateVariables: string[];
    /** Line number in source */
    line: number;
    /** File containing this binding */
    file: string;
    /** Component class that defines this binding */
    componentClass: string;
}

/**
 * Represents a state-to-UI data flow
 */
export interface StateToUIFlow {
    /** State variable name */
    stateVariable: string;
    /** Components that use this state */
    components: string[];
    /** Whether state change triggers callback */
    triggersCallback: boolean;
}

/**
 * ViewTree Analysis Result
 */
export interface ViewTreeAnalysisResult {
    /** All detected UI callback bindings */
    callbackBindings: UICallbackBinding[];
    /** State variable usage mapping */
    stateToUIFlows: StateToUIFlow[];
    /** Classes with ViewTree (ArkUI components) */
    componentClasses: string[];
    /** Statistics */
    statistics: {
        totalComponents: number;
        componentsWithCallbacks: number;
        totalCallbackBindings: number;
        stateVariablesTracked: number;
    };
}

/**
 * Analyze ViewTree for UI callback patterns and state usage.
 *
 * This provides:
 * 1. Complete list of UI event handlers
 * 2. State variable to component mappings
 * 3. Component hierarchy for analysis entry points
 */
export function analyzeViewTrees(scene: Scene): ViewTreeAnalysisResult {
    const result: ViewTreeAnalysisResult = {
        callbackBindings: [],
        stateToUIFlows: [],
        componentClasses: [],
        statistics: {
            totalComponents: 0,
            componentsWithCallbacks: 0,
            totalCallbackBindings: 0,
            stateVariablesTracked: 0
        }
    };

    const stateToUI = new Map<string, Set<string>>();
    const stateVariables = new Set<string>();

    // Iterate through all classes looking for ViewTree
    for (const arkFile of scene.getFiles()) {
        for (const arkClass of arkFile.getClasses()) {
            if (arkClass.hasViewTree()) {
                const viewTree = arkClass.getViewTree();
                if (!viewTree) continue;

                result.componentClasses.push(arkClass.getName());
                result.statistics.totalComponents++;

                const root = viewTree.getRoot();
                if (!root) continue;

                // Walk the ViewTree and analyze each node
                analyzeViewTreeNode(
                    root,
                    arkClass,
                    arkFile.getName(),
                    result.callbackBindings,
                    stateToUI,
                    stateVariables,
                    0  // Initial depth
                );
            }
        }
    }

    // Build state-to-UI flows
    for (const [stateVar, components] of stateToUI) {
        result.stateToUIFlows.push({
            stateVariable: stateVar,
            components: Array.from(components),
            triggersCallback: false // Will be set true if state appears in callback
        });
    }

    result.statistics.componentsWithCallbacks = new Set(
        result.callbackBindings.map(b => b.componentClass)
    ).size;
    result.statistics.totalCallbackBindings = result.callbackBindings.length;
    result.statistics.stateVariablesTracked = stateVariables.size;

    return result;
}

/**
 * Analyze a single ViewTreeNode and its children
 * Note: depth parameter limits recursion to prevent stack overflow from circular references
 */
const MAX_VIEW_TREE_DEPTH = 100;

function analyzeViewTreeNode(
    node: ViewTreeNode,
    arkClass: ArkClass,
    fileName: string,
    callbackBindings: UICallbackBinding[],
    stateToUI: Map<string, Set<string>>,
    stateVariables: Set<string>,
    depth: number = 0
): void {
    // Limit recursion depth to prevent stack overflow
    if (depth > MAX_VIEW_TREE_DEPTH) {
        return;
    }

    // Track state variable usage
    if (node.stateValues) {
        for (const stateField of node.stateValues) {
            const stateName = stateField.getName();
            stateVariables.add(stateName);

            // Map state to component
            if (!stateToUI.has(stateName)) {
                stateToUI.set(stateName, new Set());
            }
            stateToUI.get(stateName)!.add(node.name);
        }
    }

    // Analyze attributes for callbacks
    if (node.attributes) {
        for (const [attrName, attrValue] of node.attributes) {
            // Check if this is an event handler attribute
            if (isEventHandlerAttribute(attrName)) {
                const callbackInfo = attrValue;
                if (callbackInfo && callbackInfo.length >= 2) {
                    const stmt = callbackInfo[0];
                    const uses = callbackInfo[1];

                    // Extract target method and state variables
                    const targetMethods = extractTargetMethods(uses, arkClass);
                    const usedStates = extractStateVariables(uses, node.stateValues);

                    callbackBindings.push({
                        nodeName: node.name,
                        attributeName: attrName,
                        targetMethod: targetMethods.join(', ') || 'unknown',
                        stateVariables: usedStates,
                        line: stmt?.getOriginPositionInfo()?.getLineNo() || 0,
                        file: fileName,
                        componentClass: arkClass.getName()
                    });

                    // Mark state variables as triggering callbacks
                    for (const state of usedStates) {
                        const flow = stateToUI.get(state);
                        if (flow) {
                            // Already tracked, callback status will be set
                        }
                    }
                }
            }
        }
    }

    // Analyze state value transfers (CustomComponent prop passing)
    if (node.stateValuesTransfer) {
        for (const [childState, parentValue] of node.stateValuesTransfer) {
            const childStateName = childState.getName();
            stateVariables.add(childStateName);

            if (!stateToUI.has(childStateName)) {
                stateToUI.set(childStateName, new Set());
            }
            stateToUI.get(childStateName)!.add(node.name + ' (prop)');
        }
    }

    // Recursively analyze children (pass depth to limit recursion)
    if (node.children) {
        for (const child of node.children) {
            analyzeViewTreeNode(
                child,
                arkClass,
                fileName,
                callbackBindings,
                stateToUI,
                stateVariables,
                depth + 1
            );
        }
    }
}

/**
 * Check if attribute name is an event handler
 */
function isEventHandlerAttribute(attrName: string): boolean {
    const eventPatterns = [
        /^on[A-Z]/,                    // onClick, onTouch, onChange
        /^handle[A-Z]/,                // handleClick, handleChange
        /^after[A-Z]/,                 // afterRender, afterMount
        /^before[A-Z]/,                // beforeRender, beforeMount
        /^did[A-Z]/,                   // didMount, didUpdate
        /^will[A-Z]/,                  // willMount, willUnmount
        /callback$/i,                  // clickCallback, touchCallback
        /_callback$/i,                 // onClick_callback
    ];

    return eventPatterns.some(pattern => pattern.test(attrName));
}

/**
 * Extract target method signatures from attribute value uses
 * Note: wrapped in try-catch to prevent stack overflow from circular references
 */
function extractTargetMethods(
    uses: (any)[],
    arkClass: ArkClass
): string[] {
    const methods: string[] = [];
    const maxMethods = 50; // Prevent memory issues
    const seenSignatures = new Set<string>();

    for (let i = 0; i < uses.length && methods.length < maxMethods; i++) {
        const use = uses[i];
        try {
            // Check if use is a MethodSignature
            if (use && 'getMethodSubSignature' in use && typeof (use as any).getMethodSubSignature === 'function') {
                const sigStr = use.toString();
                if (sigStr && !seenSignatures.has(sigStr)) {
                    seenSignatures.add(sigStr);
                    methods.push(sigStr);
                }
            }
            // Check if use is an ArkMethod
            else if (use && typeof use.getName === 'function') {
                const name = use.getName();
                if (name && !seenSignatures.has(name)) {
                    seenSignatures.add(name);
                    methods.push(name);
                }
            }
        } catch (e) {
            // Skip on toString/getName error (may be due to circular references)
        }
    }

    return methods;
}

/**
 * Extract state variable names from attribute value uses
 */
function extractStateVariables(
    uses: (any)[],
    nodeStateValues: Set<ArkField> | undefined
): string[] {
    const stateNames: string[] = [];
    const stateSet = new Set<string>();

    // Collect names from node state values
    if (nodeStateValues) {
        for (const field of nodeStateValues) {
            stateSet.add(field.getName());
        }
    }

    // Check uses against state values
    for (const use of uses) {
        if (use && typeof use.getName === 'function') {
            const name = use.getName();
            if (stateSet.has(name)) {
                if (!stateNames.includes(name)) {
                    stateNames.push(name);
                }
            }
        }
    }

    return stateNames;
}

/**
 * Get UI callback entry points for call graph analysis.
 *
 * Returns methods that are bound to UI events,
 * which should be treated as analysis entry points.
 */
export function getUICallbackEntryPoints(scene: Scene): ArkMethod[] {
    const entryPoints: ArkMethod[] = [];
    const seenSignatures = new Set<string>();

    for (const arkFile of scene.getFiles()) {
        for (const arkClass of arkFile.getClasses()) {
            if (arkClass.hasViewTree()) {
                const viewTree = arkClass.getViewTree();
                if (!viewTree) continue;

                const root = viewTree.getRoot();
                if (!root) continue;

                collectCallbackMethods(root, entryPoints, seenSignatures);
            }
        }
    }

    return entryPoints;
}

/**
 * Recursively collect methods referenced in callbacks
 */
function collectCallbackMethods(
    node: ViewTreeNode,
    methods: ArkMethod[],
    seenSignatures: Set<string>
): void {
    if (node.attributes) {
        for (const [, attrValue] of node.attributes) {
            if (attrValue && attrValue.length >= 2) {
                const uses = attrValue[1];
                if (Array.isArray(uses)) {
                    for (const use of uses) {
                        if (use && 'getMethodSubSignature' in use && typeof (use as any).getMethodSubSignature === 'function') {
                            const sig = use.toString();
                            if (!seenSignatures.has(sig)) {
                                seenSignatures.add(sig);
                                // Note: Would need Scene to resolve method
                            }
                        }
                    }
                }
            }
        }
    }

    if (node.children) {
        for (const child of node.children) {
            collectCallbackMethods(child, methods, seenSignatures);
        }
    }
}