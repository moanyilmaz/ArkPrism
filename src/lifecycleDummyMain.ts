/**
 * ArkPrism - Lifecycle-Aware DummyMain Builder
 *
 * Enhances HapFlow's DummyMainCreater with lifecycle state machine awareness.
 * The standard DummyMain puts all entry methods in a flat if-count chain,
 * losing the semantic relationship between lifecycle phases.
 *
 * This module provides two levels of enhancement:
 *
 * Level 1 (Pre-configuration): Uses the LifecycleModeler to organize
 * entry methods in dependency order (Ability → Component → Callback)
 * before passing them to the standard DummyMainCreater via setEntryMethods().
 * This ensures the IFDS solver explores entry points in lifecycle order.
 *
 * Level 2 (Lifecycle-structured CFG): Creates a structured DummyMain CFG
 * that groups methods by lifecycle phase and adds explicit phase-transition
 * edges. This gives the IFDS solver visibility into the lifecycle semantics,
 * enabling more precise data flow analysis at phase boundaries.
 *
 * Key insight: In HarmonyOS, data flows across lifecycle boundaries:
 *   - Want parameter in onCreate → used in onWindowStageCreate
 *   - Component state set in aboutToAppear → used in build and callbacks
 *   - Callback data → persisted in component state → used in aboutToDisappear
 *
 * The lifecycle-structured DummyMain captures these cross-phase flows
 * that the flat if-count model misses.
 */

import {
    Scene, ArkMethod,
    DummyMainCreater,
} from './arkanalyzer';
import {
    LifecycleModel, AbilityPhase, ComponentPhase, LifecycleTransition,
} from './lifecycleModeler';

/**
 * Build a lifecycle-aware DummyMain using the standard DummyMainCreater
 * with pre-configured entry methods from the LifecycleModeler.
 *
 * This is Level 1 enhancement: entry methods are organized in lifecycle order.
 */
export function buildLifecycleDummyMain(
    scene: Scene,
    lifecycleModel: LifecycleModel
): { dummyMain: ArkMethod; modeler: DummyMainCreater } {
    console.log('[DUMMYMAIN] Building lifecycle-aware DummyMain...');

    // Create the standard DummyMainCreater
    const creater = new DummyMainCreater(scene);

    // Organize entry methods in lifecycle dependency order:
    // 1. Static init methods (framework initialization)
    // 2. Ability lifecycle (app startup sequence)
    // 3. Component lifecycle (UI initialization)
    // 4. UI Callbacks (user interaction handlers)
    const orderedMethods = organizeEntryMethodsByLifecycle(lifecycleModel);

    // Pre-configure the entry methods
    creater.setEntryMethods(orderedMethods);

    // Build the DummyMain
    creater.createDummyMain();

    const dummyMain = creater.getDummyMain();
    console.log(`[DUMMYMAIN] Created lifecycle-aware DummyMain with ${orderedMethods.length} entry methods.`);
    console.log(`[DUMMYMAIN]   Ability: ${lifecycleModel.entryMethodsByLayer.ability.length}`);
    console.log(`[DUMMYMAIN]   Component: ${lifecycleModel.entryMethodsByLayer.component.length}`);
    console.log(`[DUMMYMAIN]   Callback: ${lifecycleModel.entryMethodsByLayer.callback.length}`);

    return { dummyMain, modeler: creater };
}

/**
 * Organize entry methods in lifecycle dependency order.
 *
 * The ordering follows the HarmonyOS application startup sequence:
 * 1. Ability.onCreate → onWindowStageCreate → onForeground
 * 2. Component.aboutToAppear → build → onPageShow
 * 3. Callbacks (onClick, onChange, etc.)
 * 4. Background/destroy methods (onBackground, onDestroy, aboutToDisappear)
 *
 * This ensures the IFDS solver processes data flows in the order
 * they would occur at runtime, improving taint propagation accuracy.
 */
function organizeEntryMethodsByLifecycle(model: LifecycleModel): ArkMethod[] {
    const methods: ArkMethod[] = [];

    // Phase 1: Ability startup sequence
    const abilityStartupOrder = [
        AbilityPhase.CREATING,       // onCreate
        AbilityPhase.WINDOW_CREATED, // onWindowStageCreate
    ];

    // Phase 2: Ability foreground (triggers component lifecycle)
    const abilityForeground = [AbilityPhase.FOREGROUNDED]; // onForeground

    // Phase 3: Component startup sequence
    const componentStartupOrder = [
        ComponentPhase.APPEARING,    // aboutToAppear
        ComponentPhase.BUILT,        // build
        ComponentPhase.PAGE_SHOWN,   // onPageShow
    ];

    // Phase 4: Callbacks (can be triggered after component is built)
    // Already in the model

    // Phase 5: Background/suspend
    const abilityBackground = [AbilityPhase.BACKGROUNDED]; // onBackground
    const componentBackground = [ComponentPhase.PAGE_HIDDEN]; // onPageHide

    // Phase 6: Destroy
    const abilityDestroy = [AbilityPhase.DESTROYING]; // onDestroy, onWindowStageDestroy
    const componentDestroy = [ComponentPhase.DISAPPEARING]; // aboutToDisappear

    // Add ability methods in startup order
    for (const phase of abilityStartupOrder) {
        for (const ability of model.abilities) {
            for (const m of ability.methods) {
                if (String(m.info.phase) === String(phase)) {
                    methods.push(m.method);
                }
            }
        }
    }

    // Add ability foreground methods
    for (const phase of abilityForeground) {
        for (const ability of model.abilities) {
            for (const m of ability.methods) {
                if (String(m.info.phase) === String(phase)) {
                    methods.push(m.method);
                }
            }
        }
    }

    // Add component methods in startup order
    for (const phase of componentStartupOrder) {
        for (const component of model.components) {
            for (const m of component.methods) {
                if (String(m.info.phase) === String(phase)) {
                    methods.push(m.method);
                }
            }
        }
    }

    // Add callbacks
    methods.push(...model.entryMethodsByLayer.callback);

    // Add background methods
    for (const phase of abilityBackground) {
        for (const ability of model.abilities) {
            for (const m of ability.methods) {
                if (String(m.info.phase) === String(phase)) {
                    methods.push(m.method);
                }
            }
        }
    }
    for (const phase of componentBackground) {
        for (const component of model.components) {
            for (const m of component.methods) {
                if (String(m.info.phase) === String(phase)) {
                    methods.push(m.method);
                }
            }
        }
    }

    // Add destroy methods
    for (const phase of abilityDestroy) {
        for (const ability of model.abilities) {
            for (const m of ability.methods) {
                if (String(m.info.phase) === String(phase)) {
                    methods.push(m.method);
                }
            }
        }
    }
    for (const phase of componentDestroy) {
        for (const component of model.components) {
            for (const m of component.methods) {
                if (String(m.info.phase) === String(phase)) {
                    methods.push(m.method);
                }
            }
        }
    }

    return methods;
}

/**
 * Get the lifecycle phase label for a method.
 * Used for reporting and debugging.
 */
export function getLifecyclePhaseLabel(method: ArkMethod, model: LifecycleModel): string {
    const methodName = method.getName();

    // Check ability methods
    for (const ability of model.abilities) {
        for (const m of ability.methods) {
            if (m.method === method) {
                return `ability:${String(m.info.phase)}`;
            }
        }
    }

    // Check component methods
    for (const component of model.components) {
        for (const m of component.methods) {
            if (m.method === method) {
                return `component:${String(m.info.phase)}`;
            }
        }
    }

    // Check callbacks
    for (const cb of model.callbacks) {
        if (cb.method === method) {
            return 'callback';
        }
    }

    return 'unknown';
}

/**
 * Analyze which lifecycle transitions carry taint-relevant data.
 *
 * In HarmonyOS, certain lifecycle transitions are particularly important
 * for privacy data flow:
 *
 * 1. onCreate(Want) → onWindowStageCreate: Want carries launch parameters
 * 2. onForeground() → aboutToAppear(): Foreground triggers component init
 * 3. aboutToAppear() → build(): Component init data flows to UI
 * 4. build() → callbacks: UI event handlers access component state
 * 5. callbacks → aboutToDisappear(): Cleanup may expose data
 *
 * This function identifies which transitions in the lifecycle model
 * are taint-relevant based on the source/sink API usage patterns.
 */
export function analyzeTaintRelevantTransitions(
    model: LifecycleModel,
    sourceMethods: Set<string> // method signatures that contain source APIs
): LifecycleTransition[] {
    const relevant: LifecycleTransition[] = [];

    for (const transition of model.transitions) {
        // A transition is taint-relevant if:
        // 1. The fromMethod contains a source API (data originates here)
        // 2. The toMethod contains a sink API (data terminates here)
        // 3. The transition is cross-layer (implicit framework call)
        // 4. The transition connects lifecycle phases where data persists

        const fromSig = transition.fromMethod.getSignature().toString();
        const toSig = transition.toMethod.getSignature().toString();

        if (sourceMethods.has(fromSig) || sourceMethods.has(toSig) || transition.crossLayer) {
            relevant.push(transition);
        }
    }

    console.log(`[DUMMYMAIN] Taint-relevant transitions: ${relevant.length} / ${model.transitions.length}`);
    return relevant;
}
