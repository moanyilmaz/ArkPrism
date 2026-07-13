/**
 * ArkPrism - Lifecycle State Machine Modeler
 *
 * Models the HarmonyOS application lifecycle as a 3-layer state machine:
 *   Layer 1: UIAbility lifecycle (app-level startup/foreground/background/destroy)
 *   Layer 2: Component lifecycle (page-level appear/build/disappear)
 *   Layer 3: UI Callbacks (user interaction handlers)
 *
 * This replaces the simplistic LIFECYCLE_ORDER edge pairs in callGraphBuilder.ts
 * with a proper state transition model that captures:
 *   - Which lifecycle methods belong to which phase
 *   - Legal transitions between phases (e.g., onCreate→onForeground, but not onCreate→onBackground)
 *   - The hierarchical relationship: Ability contains Components, Components contain Callbacks
 *   - Cross-layer transitions (e.g., onForeground triggers aboutToAppear)
 *
 * Reference: HarmonyOS Application Model Documentation
 * https://developer.huawei.com/consumer/en/doc/harmonyos-guides/application-model-composition
 */

import {
    Scene, ArkMethod, ArkClass,
    getCallbackMethodFromStmt
} from './arkanalyzer';
import * as fs from 'fs';
import * as path from 'path';

// ============================================================================
// Lifecycle State Definitions
// ============================================================================

/**
 * UIAbility lifecycle phases.
 * These represent the high-level states of a HarmonyOS Ability.
 *
 * Transition graph:
 *   NOT_STARTED → CREATING → WINDOW_CREATED → FOREGROUNDED ⇄ BACKGROUNDED → DESTROYING → DESTROYED
 *                                  ↓                              ↓
 *                           (triggers Component              (triggers Component
 *                            aboutToAppear)                   aboutToDisappear)
 */
export enum AbilityPhase {
    NOT_STARTED = 'NOT_STARTED',
    CREATING = 'CREATING',           // onCreate
    WINDOW_CREATED = 'WINDOW_CREATED', // onWindowStageCreate
    FOREGROUNDED = 'FOREGROUNDED',   // onForeground
    BACKGROUNDED = 'BACKGROUNDED',   // onBackground
    DESTROYING = 'DESTROYING',        // onDestroy
    DESTROYED = 'DESTROYED',
}

/**
 * Component lifecycle phases.
 * These represent the states of a CustomComponent within an Ability.
 *
 * Transition graph:
 *   NOT_CREATED → APPEARING → BUILT → PAGE_SHOWN ⇄ PAGE_HIDDEN → DISAPPEARING → DISAPPEARED
 */
export enum ComponentPhase {
    NOT_CREATED = 'NOT_CREATED',
    APPEARING = 'APPEARING',     // aboutToAppear
    BUILT = 'BUILT',             // build
    PAGE_SHOWN = 'PAGE_SHOWN',   // onPageShow
    PAGE_HIDDEN = 'PAGE_HIDDEN', // onPageHide
    DISAPPEARING = 'DISAPPEARING', // aboutToDisappear
    DISAPPEARED = 'DISAPPEARED',
}

/**
 * Lifecycle method classification by layer and phase.
 */
export interface LifecycleMethodInfo {
    methodName: string;
    layer: 'ability' | 'component' | 'callback';
    phase: AbilityPhase | ComponentPhase | 'callback';
    /** Methods that can legally follow this one in the lifecycle */
    nextPhases: (AbilityPhase | ComponentPhase | 'callback')[];
    /** Whether this method can be called multiple times */
    repeatable: boolean;
    /** Human-readable description */
    description: string;
}

/**
 * A discovered lifecycle method instance in the analyzed project.
 */
export interface DiscoveredLifecycleMethod {
    method: ArkMethod;
    info: LifecycleMethodInfo;
    /** The ArkClass that declares this method */
    declaringClass: ArkClass;
    /** The class category (UIAbility subclass, CustomComponent, etc.) */
    classRole: 'ability' | 'component' | 'service' | 'unknown';
}

/**
 * A lifecycle transition edge.
 * Represents that methodA (in phaseA) can transition to methodB (in phaseB).
 */
export interface LifecycleTransition {
    fromMethod: ArkMethod;
    toMethod: ArkMethod;
    fromPhase: AbilityPhase | ComponentPhase;
    toPhase: AbilityPhase | ComponentPhase;
    /** Whether this is a cross-layer transition (e.g., onForeground → aboutToAppear) */
    crossLayer: boolean;
}

/**
 * Complete lifecycle model for a HarmonyOS application.
 */
export interface LifecycleModel {
    /** All discovered ability classes and their lifecycle methods */
    abilities: Array<{
        arkClass: ArkClass;
        role: 'UIAbility' | 'Ability' | 'ExtensionAbility' | 'FormExtensionAbility' | 'BackupExtensionAbility';
        methods: DiscoveredLifecycleMethod[];
    }>;
    /** All discovered component classes and their lifecycle methods */
    components: Array<{
        arkClass: ArkClass;
        methods: DiscoveredLifecycleMethod[];
        /** Parent component (if this is a nested child component) */
        parentComponent: ArkClass | null;
        /** Child components discovered in this component's build() method */
        childComponents: ArkClass[];
    }>;
    /** All discovered callback methods */
    callbacks: DiscoveredLifecycleMethod[];
    /** All legal lifecycle transitions */
    transitions: LifecycleTransition[];
    /** Entry methods organized by layer */
    entryMethodsByLayer: {
        ability: ArkMethod[];
        component: ArkMethod[];
        callback: ArkMethod[];
    };
    /** Ownership map: which components belong to which ability */
    ownership: AbilityComponentOwnership;
}

/**
 * Maps ability classes to the component classes they own.
 * Derived from module.json5 configuration: an Ability's srcEntry
 * determines which page file it loads, and the page file contains
 * the Components that belong to that Ability.
 */
export interface AbilityComponentOwnership {
    /** Map from ArkClass (ability) to ArkClass[] (components owned by it) */
    abilityToComponents: Map<ArkClass, ArkClass[]>;
    /** Map from ArkClass (component) to ArkClass (ability that owns it) */
    componentToAbility: Map<ArkClass, ArkClass>;
    /** Whether ownership was derived from module.json5 (true) or heuristic (false) */
    fromConfig: boolean;
}

/**
 * Parsed module.json5 content for Ability→Component mapping.
 */
interface ModuleConfig {
    abilities: Array<{
        name: string;
        srcEntry: string;
    }>;
    pages: string[];
    extensionAbilities: Array<{
        name: string;
        srcEntry: string;
        srcEntrance?: string;
    }>;
}

// ============================================================================
// Lifecycle Method Registry
// ============================================================================

/**
 * Complete registry of HarmonyOS lifecycle methods with their phase mappings.
 * This is the authoritative source for lifecycle semantics.
 */
const ABILITY_LIFECYCLE_REGISTRY: LifecycleMethodInfo[] = [
    {
        methodName: 'onCreate', layer: 'ability', phase: AbilityPhase.CREATING,
        nextPhases: [AbilityPhase.WINDOW_CREATED, AbilityPhase.DESTROYING],
        repeatable: false,
        description: 'Called when the Ability is being created. First lifecycle callback.'
    },
    {
        methodName: 'onWindowStageCreate', layer: 'ability', phase: AbilityPhase.WINDOW_CREATED,
        nextPhases: [AbilityPhase.FOREGROUNDED, AbilityPhase.DESTROYING],
        repeatable: false,
        description: 'Called when the WindowStage is created. Triggers Component loading.'
    },
    {
        methodName: 'onForeground', layer: 'ability', phase: AbilityPhase.FOREGROUNDED,
        nextPhases: [AbilityPhase.BACKGROUNDED, AbilityPhase.DESTROYING],
        repeatable: true,
        description: 'Called when the Ability transitions to the foreground. Triggers Component aboutToAppear/onPageShow.'
    },
    {
        methodName: 'onBackground', layer: 'ability', phase: AbilityPhase.BACKGROUNDED,
        nextPhases: [AbilityPhase.FOREGROUNDED, AbilityPhase.DESTROYING],
        repeatable: true,
        description: 'Called when the Ability transitions to the background. Triggers Component onPageHide.'
    },
    {
        methodName: 'onWindowStageDestroy', layer: 'ability', phase: AbilityPhase.DESTROYING,
        nextPhases: [AbilityPhase.DESTROYED],
        repeatable: false,
        description: 'Called when the WindowStage is being destroyed.'
    },
    {
        methodName: 'onDestroy', layer: 'ability', phase: AbilityPhase.DESTROYING,
        nextPhases: [AbilityPhase.DESTROYED],
        repeatable: false,
        description: 'Called when the Ability is being destroyed. Last lifecycle callback.'
    },
    // Additional Ability lifecycle methods (less common but valid)
    {
        methodName: 'onNewWant', layer: 'ability', phase: AbilityPhase.FOREGROUNDED,
        nextPhases: [AbilityPhase.BACKGROUNDED, AbilityPhase.DESTROYING],
        repeatable: true,
        description: 'Called when the Ability is launched with a new Want while already running (singleInstance mode).'
    },
    {
        methodName: 'onContinue', layer: 'ability', phase: AbilityPhase.FOREGROUNDED,
        nextPhases: [AbilityPhase.BACKGROUNDED, AbilityPhase.DESTROYING],
        repeatable: true,
        description: 'Called during Ability migration to save/restore state.'
    },
    {
        methodName: 'onConfigurationUpdate', layer: 'ability', phase: AbilityPhase.FOREGROUNDED,
        nextPhases: [AbilityPhase.BACKGROUNDED, AbilityPhase.DESTROYING],
        repeatable: true,
        description: 'Called when the system configuration changes (e.g., language, orientation).'
    },
    {
        methodName: 'onSaveState', layer: 'ability', phase: AbilityPhase.BACKGROUNDED,
        nextPhases: [AbilityPhase.FOREGROUNDED, AbilityPhase.DESTROYING],
        repeatable: true,
        description: 'Called to save Ability state before potential termination.'
    },
    {
        methodName: 'onBackPressed', layer: 'ability', phase: AbilityPhase.FOREGROUNDED,
        nextPhases: [AbilityPhase.BACKGROUNDED, AbilityPhase.DESTROYING],
        repeatable: true,
        description: 'Called when the user presses the back button.'
    },
    {
        methodName: 'onDump', layer: 'ability', phase: AbilityPhase.FOREGROUNDED,
        nextPhases: [AbilityPhase.BACKGROUNDED, AbilityPhase.DESTROYING],
        repeatable: true,
        description: 'Called for diagnostics dump.'
    },
    {
        methodName: 'onBackup', layer: 'ability', phase: AbilityPhase.FOREGROUNDED,
        nextPhases: [AbilityPhase.BACKGROUNDED, AbilityPhase.DESTROYING],
        repeatable: true,
        description: 'Called during backup operation.'
    },
    {
        methodName: 'onRestore', layer: 'ability', phase: AbilityPhase.CREATING,
        nextPhases: [AbilityPhase.WINDOW_CREATED, AbilityPhase.DESTROYING],
        repeatable: false,
        description: 'Called during restore operation.'
    },
];

const COMPONENT_LIFECYCLE_REGISTRY: LifecycleMethodInfo[] = [
    {
        methodName: 'aboutToAppear', layer: 'component', phase: ComponentPhase.APPEARING,
        nextPhases: [ComponentPhase.BUILT],
        repeatable: false,
        description: 'Called before the component is about to appear. Good for data initialization.'
    },
    {
        methodName: 'onWillApplyTheme', layer: 'component', phase: ComponentPhase.APPEARING,
        nextPhases: [ComponentPhase.BUILT],
        repeatable: false,
        description: 'Called before applying the theme to the component.'
    },
    {
        methodName: 'build', layer: 'component', phase: ComponentPhase.BUILT,
        nextPhases: [ComponentPhase.PAGE_SHOWN],
        repeatable: false,
        description: 'Builds the component UI. Called after aboutToAppear.'
    },
    {
        methodName: 'onDidBuild', layer: 'component', phase: ComponentPhase.BUILT,
        nextPhases: [ComponentPhase.PAGE_SHOWN],
        repeatable: false,
        description: 'Called after the component build is complete.'
    },
    {
        methodName: 'onPageShow', layer: 'component', phase: ComponentPhase.PAGE_SHOWN,
        nextPhases: [ComponentPhase.PAGE_HIDDEN, ComponentPhase.DISAPPEARING],
        repeatable: true,
        description: 'Called when the page becomes visible. Triggered by Ability.onForeground.'
    },
    {
        methodName: 'onPageHide', layer: 'component', phase: ComponentPhase.PAGE_HIDDEN,
        nextPhases: [ComponentPhase.PAGE_SHOWN, ComponentPhase.DISAPPEARING],
        repeatable: true,
        description: 'Called when the page becomes hidden. Triggered by Ability.onBackground.'
    },
    {
        methodName: 'onBackPress', layer: 'component', phase: ComponentPhase.PAGE_SHOWN,
        nextPhases: [ComponentPhase.PAGE_HIDDEN, ComponentPhase.DISAPPEARING],
        repeatable: true,
        description: 'Called when the back button is pressed on the page.'
    },
    {
        methodName: 'aboutToDisappear', layer: 'component', phase: ComponentPhase.DISAPPEARING,
        nextPhases: [ComponentPhase.DISAPPEARED],
        repeatable: false,
        description: 'Called before the component is about to disappear. Good for cleanup.'
    },
    {
        methodName: 'aboutToReuse', layer: 'component', phase: ComponentPhase.APPEARING,
        nextPhases: [ComponentPhase.BUILT],
        repeatable: true,
        description: 'Called when a cached component instance is being reused (LazyForEach).'
    },
    {
        methodName: 'aboutToRecycle', layer: 'component', phase: ComponentPhase.DISAPPEARING,
        nextPhases: [ComponentPhase.DISAPPEARED],
        repeatable: true,
        description: 'Called when a component is being recycled into the cache.'
    },
];

const CALLBACK_REGISTRY: LifecycleMethodInfo[] = [
    {
        methodName: 'onClick', layer: 'callback', phase: 'callback',
        nextPhases: ['callback'],
        repeatable: true,
        description: 'Click event handler. Triggered by user tap.'
    },
    {
        methodName: 'onTouch', layer: 'callback', phase: 'callback',
        nextPhases: ['callback'],
        repeatable: true,
        description: 'Touch event handler. Triggered by touch interaction.'
    },
    {
        methodName: 'onAppear', layer: 'callback', phase: 'callback',
        nextPhases: ['callback'],
        repeatable: true,
        description: 'Called when the component appears on screen.'
    },
    {
        methodName: 'onDisAppear', layer: 'callback', phase: 'callback',
        nextPhases: ['callback'],
        repeatable: true,
        description: 'Called when the component disappears from screen.'
    },
    {
        methodName: 'onDragStart', layer: 'callback', phase: 'callback',
        nextPhases: ['callback'],
        repeatable: true,
        description: 'Drag start event handler.'
    },
    {
        methodName: 'onDragEnter', layer: 'callback', phase: 'callback',
        nextPhases: ['callback'],
        repeatable: true,
        description: 'Drag enter event handler.'
    },
    {
        methodName: 'onDragMove', layer: 'callback', phase: 'callback',
        nextPhases: ['callback'],
        repeatable: true,
        description: 'Drag move event handler.'
    },
    {
        methodName: 'onDragLeave', layer: 'callback', phase: 'callback',
        nextPhases: ['callback'],
        repeatable: true,
        description: 'Drag leave event handler.'
    },
    {
        methodName: 'onDrop', layer: 'callback', phase: 'callback',
        nextPhases: ['callback'],
        repeatable: true,
        description: 'Drop event handler.'
    },
    {
        methodName: 'onDragEnd', layer: 'callback', phase: 'callback',
        nextPhases: ['callback'],
        repeatable: true,
        description: 'Drag end event handler.'
    },
    {
        methodName: 'onKeyEvent', layer: 'callback', phase: 'callback',
        nextPhases: ['callback'],
        repeatable: true,
        description: 'Key event handler.'
    },
    {
        methodName: 'onFocus', layer: 'callback', phase: 'callback',
        nextPhases: ['callback'],
        repeatable: true,
        description: 'Focus event handler.'
    },
    {
        methodName: 'onBlur', layer: 'callback', phase: 'callback',
        nextPhases: ['callback'],
        repeatable: true,
        description: 'Blur event handler.'
    },
    {
        methodName: 'onHover', layer: 'callback', phase: 'callback',
        nextPhases: ['callback'],
        repeatable: true,
        description: 'Hover event handler.'
    },
    {
        methodName: 'onMouse', layer: 'callback', phase: 'callback',
        nextPhases: ['callback'],
        repeatable: true,
        description: 'Mouse event handler.'
    },
    {
        methodName: 'onAreaChange', layer: 'callback', phase: 'callback',
        nextPhases: ['callback'],
        repeatable: true,
        description: 'Area change event handler.'
    },
    {
        methodName: 'onVisibleAreaChange', layer: 'callback', phase: 'callback',
        nextPhases: ['callback'],
        repeatable: true,
        description: 'Visible area change event handler.'
    },
    {
        methodName: 'onChange', layer: 'callback', phase: 'callback',
        nextPhases: ['callback'],
        repeatable: true,
        description: 'Change event handler (for input components).'
    },
    {
        methodName: 'onSubmit', layer: 'callback', phase: 'callback',
        nextPhases: ['callback'],
        repeatable: true,
        description: 'Submit event handler.'
    },
    {
        methodName: 'onSelect', layer: 'callback', phase: 'callback',
        nextPhases: ['callback'],
        repeatable: true,
        description: 'Select event handler.'
    },
    {
        methodName: 'onScroll', layer: 'callback', phase: 'callback',
        nextPhases: ['callback'],
        repeatable: true,
        description: 'Scroll event handler.'
    },
    {
        methodName: 'onScrollStop', layer: 'callback', phase: 'callback',
        nextPhases: ['callback'],
        repeatable: true,
        description: 'Scroll stop event handler.'
    },
    {
        methodName: 'onScrollEdge', layer: 'callback', phase: 'callback',
        nextPhases: ['callback'],
        repeatable: true,
        description: 'Scroll edge event handler.'
    },
    {
        methodName: 'onScrollFrameBegin', layer: 'callback', phase: 'callback',
        nextPhases: ['callback'],
        repeatable: true,
        description: 'Scroll frame begin event handler.'
    },
    {
        methodName: 'onReachStart', layer: 'callback', phase: 'callback',
        nextPhases: ['callback'],
        repeatable: true,
        description: 'Reach start event handler (for list components).'
    },
    {
        methodName: 'onReachEnd', layer: 'callback', phase: 'callback',
        nextPhases: ['callback'],
        repeatable: true,
        description: 'Reach end event handler (for list components).'
    },
    {
        methodName: 'onCheckedChange', layer: 'callback', phase: 'callback',
        nextPhases: ['callback'],
        repeatable: true,
        description: 'Checked change event handler.'
    },
    {
        methodName: 'onTextSelectionChange', layer: 'callback', phase: 'callback',
        nextPhases: ['callback'],
        repeatable: true,
        description: 'Text selection change event handler.'
    },
    {
        methodName: 'onFocusAxisEvent', layer: 'callback', phase: 'callback',
        nextPhases: ['callback'],
        repeatable: true,
        description: 'Focus axis event handler (for TV/remote navigation).'
    },
];

// Build lookup maps
const ABILITY_METHOD_MAP = new Map(
    ABILITY_LIFECYCLE_REGISTRY.map(m => [m.methodName, m])
);
const COMPONENT_METHOD_MAP = new Map(
    COMPONENT_LIFECYCLE_REGISTRY.map(m => [m.methodName, m])
);
const CALLBACK_METHOD_MAP = new Map(
    CALLBACK_REGISTRY.map(m => [m.methodName, m])
);

// ============================================================================
// Cross-Layer Transition Rules
// ============================================================================

/**
 * Cross-layer transitions define when an Ability-level lifecycle event
 * triggers Component-level or Callback-level events.
 *
 * These are the implicit edges that the HarmonyOS framework creates but
 * are not visible in the application source code.
 */
const CROSS_LAYER_TRANSITIONS: Array<{
    abilityPhase: AbilityPhase;
    componentPhase: ComponentPhase | null;
    description: string;
}> = [
    // Window creation path: onWindowStageCreate loads the page and triggers
    // component initialization before onForeground fires
    {
        abilityPhase: AbilityPhase.WINDOW_CREATED,
        componentPhase: ComponentPhase.APPEARING,
        description: 'onWindowStageCreate loads page content, triggering aboutToAppear for initial components'
    },
    // Foreground path: components already created become visible
    {
        abilityPhase: AbilityPhase.FOREGROUNDED,
        componentPhase: ComponentPhase.APPEARING,
        description: 'onForeground triggers aboutToAppear for newly visible components'
    },
    {
        abilityPhase: AbilityPhase.FOREGROUNDED,
        componentPhase: ComponentPhase.PAGE_SHOWN,
        description: 'onForeground triggers onPageShow for already visible components'
    },
    // Background path: components become hidden
    {
        abilityPhase: AbilityPhase.BACKGROUNDED,
        componentPhase: ComponentPhase.PAGE_HIDDEN,
        description: 'onBackground triggers onPageHide for visible components'
    },
    // Destroy path: all components are torn down
    {
        abilityPhase: AbilityPhase.DESTROYING,
        componentPhase: ComponentPhase.DISAPPEARING,
        description: 'onDestroy/onWindowStageDestroy triggers aboutToDisappear for all components'
    },
    // Re-foreground path: components re-appear after being hidden
    {
        abilityPhase: AbilityPhase.FOREGROUNDED,
        componentPhase: ComponentPhase.BUILT,
        description: 'onForeground re-triggers build for components being restored from hidden state'
    },
    // Re-foreground after background: page shown again
    {
        abilityPhase: AbilityPhase.FOREGROUNDED,
        componentPhase: null,
        description: 'onForeground may trigger callback re-registration for restored components'
    },
    // Creating → destroy (early exit): if Ability fails during onCreate,
    // any partially initialized components must still be cleaned up
    {
        abilityPhase: AbilityPhase.CREATING,
        componentPhase: ComponentPhase.DISAPPEARING,
        description: 'onCreate failure triggers cleanup of partially initialized components'
    },
];

// ============================================================================
// LifecycleModeler Class
// ============================================================================

/**
 * Base class names that indicate a UIAbility subclass.
 * Order matters: more specific types first.
 */
const ABILITY_BASE_CLASSES = [
    'UIAbility',
    'Ability',
    'UIExtensionAbility',
    'FormExtensionAbility',
    'BackupExtensionAbility',
    'ServiceExtensionAbility',
    'ShareExtensionAbility',
];

/**
 * Base class names / decorators that indicate a CustomComponent.
 */
const COMPONENT_BASE_CLASSES = ['CustomComponent', 'ViewPU'];
const COMPONENT_DECORATORS = ['Component', 'CustomDialog', 'Builder'];

export class LifecycleModeler {
    private scene: Scene;
    private model: LifecycleModel | null = null;

    constructor(scene: Scene) {
        this.scene = scene;
    }

    /**
     * Build the complete lifecycle model for the project.
     */
    buildModel(): LifecycleModel {
        if (this.model) return this.model;

        console.log('[LIFECYCLE] Building lifecycle state machine model...');

        const abilities = this.discoverAbilities();
        const components = this.discoverComponents();
        const callbacks = this.discoverCallbacks();

        console.log(`[LIFECYCLE] Discovered: ${abilities.length} abilities, ${components.length} components, ${callbacks.length} callbacks`);

        // Build ownership map (Ability → Component scoping)
        const ownership = this.buildOwnership(abilities, components);
        console.log(`[LIFECYCLE] Ownership: config-derived=${ownership.fromConfig}, mapped=${ownership.abilityToComponents.size} abilities`);

        // Build transitions (ownership-scoped for cross-layer)
        const transitions = this.buildTransitions(abilities, components, ownership);

        // Organize entry methods by layer
        const entryMethodsByLayer = {
            ability: abilities.flatMap(a => a.methods.map(m => m.method)),
            component: components.flatMap(c => c.methods.map(m => m.method)),
            callback: callbacks.map(c => c.method),
        };

        this.model = {
            abilities,
            components,
            callbacks,
            transitions,
            entryMethodsByLayer,
            ownership,
        };

        console.log(`[LIFECYCLE] Model complete: ${transitions.length} transitions`);
        console.log(`[LIFECYCLE]   Ability methods: ${entryMethodsByLayer.ability.length}`);
        console.log(`[LIFECYCLE]   Component methods: ${entryMethodsByLayer.component.length}`);
        console.log(`[LIFECYCLE]   Callback methods: ${entryMethodsByLayer.callback.length}`);

        return this.model;
    }

    /**
     * Get the built model (must call buildModel() first).
     */
    getModel(): LifecycleModel | null {
        return this.model;
    }

    /**
     * Get all entry methods for call graph construction.
     * Returns methods in dependency order: ability → component → callback.
     */
    getEntryMethods(): ArkMethod[] {
        if (!this.model) return [];
        return [
            ...this.model.entryMethodsByLayer.ability,
            ...this.model.entryMethodsByLayer.component,
            ...this.model.entryMethodsByLayer.callback,
        ];
    }

    /**
     * Get lifecycle transition edges for call graph augmentation.
     * Each transition represents an implicit framework call that should be
     * added as a call graph edge.
     */
    getLifecycleEdges(): LifecycleTransition[] {
        return this.model?.transitions ?? [];
    }

    /**
     * Get the lifecycle info for a method name, if it's a known lifecycle method.
     */
    getMethodInfo(methodName: string): LifecycleMethodInfo | undefined {
        return ABILITY_METHOD_MAP.get(methodName)
            ?? COMPONENT_METHOD_MAP.get(methodName)
            ?? CALLBACK_METHOD_MAP.get(methodName);
    }

    /**
     * Check if a method name is a known lifecycle method.
     */
    isLifecycleMethod(methodName: string): boolean {
        return ABILITY_METHOD_MAP.has(methodName)
            || COMPONENT_METHOD_MAP.has(methodName)
            || CALLBACK_METHOD_MAP.has(methodName);
    }

    // ---- Discovery Methods ----

    private discoverAbilities(): LifecycleModel['abilities'] {
        const abilities: LifecycleModel['abilities'] = [];

        for (const arkClass of this.scene.getClasses()) {
            const role = this.classifyAbilityClass(arkClass);
            if (!role) continue;

            const methods = this.discoverLifecycleMethods(arkClass, ABILITY_METHOD_MAP, 'ability');

            if (methods.length > 0) {
                abilities.push({ arkClass, role, methods });
            }
        }

        return abilities;
    }

    private discoverComponents(): LifecycleModel['components'] {
        const components: LifecycleModel['components'] = [];

        for (const arkClass of this.scene.getClasses()) {
            if (!this.isComponentClass(arkClass)) continue;

            const methods = this.discoverLifecycleMethods(arkClass, COMPONENT_METHOD_MAP, 'component');

            if (methods.length > 0) {
                components.push({ arkClass, methods, parentComponent: null, childComponents: [] });
            }
        }

        // Discover parent-child nesting via build() method analysis
        this.discoverComponentNesting(components);

        return components;
    }

    /**
     * Discover parent-child nesting between components by analyzing build() methods.
     *
     * In ArkTS, a parent component's build() method creates child components:
     *   build() {
     *     Column() {
     *       MyChildComponent({ ... })  // This creates a child component
     *     }
     *   }
     *
     * The IR represents child component creation as an invoke expression where
     * the callee is the child component's constructor or _DEFAULT_ARK_METHOD.
     */
    private discoverComponentNesting(components: LifecycleModel['components']): void {
        // Build a lookup: class name → component entry
        const classToComponent = new Map<string, LifecycleModel['components'][number]>();
        for (const comp of components) {
            classToComponent.set(comp.arkClass.getName(), comp);
        }

        let nestingFound = 0;

        for (const comp of components) {
            // Find the build() method
            const buildMethod = comp.arkClass.getMethods().find(m => m.getName() === 'build');
            if (!buildMethod) continue;

            const body = buildMethod.getBody();
            if (!body) continue;

            const cfg = body.getCfg();
            if (!cfg) continue;

            for (const stmt of cfg.getStmts()) {
                if (!stmt.containsInvokeExpr()) continue;

                try {
                    const invokeExpr = stmt.getInvokeExpr();
                    if (!invokeExpr) continue;

                    // Get the method being called
                    const methodSig = invokeExpr.getMethodSignature?.();
                    if (!methodSig) continue;

                    // Check if the callee is a component's constructor or _DEFAULT_ARK_METHOD
                    const calleeMethodName = methodSig.getMethodSubSignature?.()?.getMethodName?.()
                        ?? methodSig.toString().split('.').pop()?.split('(')[0];

                    if (!calleeMethodName) continue;

                    // Look up the declaring class of the callee
                    const calleeMethod = this.scene.getMethod(methodSig);
                    if (!calleeMethod) continue;

                    const calleeClass = calleeMethod.getDeclaringArkClass();
                    const calleeClassName = calleeClass.getName();

                    // Check if the callee class is a known component
                    const childComp = classToComponent.get(calleeClassName);
                    if (childComp && childComp.arkClass !== comp.arkClass) {
                        // Found a parent-child relationship
                        if (!comp.childComponents.includes(childComp.arkClass)) {
                            comp.childComponents.push(childComp.arkClass);
                        }
                        childComp.parentComponent = comp.arkClass;
                        nestingFound++;
                    }
                } catch {
                    // invokeExpr access may fail, skip
                }
            }
        }

        if (nestingFound > 0) {
            console.log(`[LIFECYCLE] Discovered ${nestingFound} parent-child component nesting relationships`);
        }
    }

    private discoverCallbacks(): DiscoveredLifecycleMethod[] {
        const callbacks: DiscoveredLifecycleMethod[] = [];
        const seen = new Set<string>();

        for (const method of this.scene.getMethods()) {
            const methodName = method.getName();
            const info = CALLBACK_METHOD_MAP.get(methodName);
            if (!info) continue;

            // Skip if already seen this exact method
            const sig = method.getSignature().toString();
            if (seen.has(sig)) continue;
            seen.add(sig);

            // Filter out SDK/project-internal methods
            const fileName = method.getDeclaringArkFile().getName();
            if (fileName.startsWith('api/') || fileName.includes('node_modules') ||
                fileName.includes('oh_modules') || fileName.includes('.preview') ||
                fileName.includes('cache')) {
                continue;
            }

            callbacks.push({
                method,
                info,
                declaringClass: method.getDeclaringArkClass(),
                classRole: 'unknown', // Callbacks can be in any class
            });
        }

        // Also discover callbacks via CommonMethod analysis (like HapFlow does)
        this.discoverCommonMethodCallbacks(callbacks, seen);

        return callbacks;
    }

    /**
     * Discover callback methods by scanning for CommonMethod.* invocations
     * in the IR, similar to HapFlow's getCallbackMethods().
     */
    private discoverCommonMethodCallbacks(
        callbacks: DiscoveredLifecycleMethod[],
        seen: Set<string>
    ): void {
        for (const method of this.scene.getMethods()) {
            const fileName = method.getDeclaringArkFile().getName();
            if (fileName.startsWith('api/') || fileName.includes('node_modules') ||
                fileName.includes('oh_modules') || fileName.includes('.preview') ||
                fileName.includes('cache')) {
                continue;
            }

            const cfg = method.getCfg();
            if (!cfg) continue;

            for (const block of cfg.getBlocks()) {
                for (const stmt of block.getStmts()) {
                    if (!stmt.containsInvokeExpr()) continue;

                    try {
                        const callbackMethod = getCallbackMethodFromStmt(stmt, this.scene);
                        if (callbackMethod) {
                            const sig = callbackMethod.getSignature().toString();
                            if (seen.has(sig)) continue;
                            seen.add(sig);

                            // Determine if this is a known callback type
                            const methodName = callbackMethod.getName();
                            const info = CALLBACK_METHOD_MAP.get(methodName) ?? {
                                methodName,
                                layer: 'callback' as const,
                                phase: 'callback' as const,
                                nextPhases: ['callback' as const],
                                repeatable: true,
                                description: `Discovered callback: ${methodName}`,
                            };

                            callbacks.push({
                                method: callbackMethod,
                                info,
                                declaringClass: callbackMethod.getDeclaringArkClass(),
                                classRole: 'unknown',
                            });
                        }
                    } catch {
                        // getCallbackMethodFromStmt may throw for unexpected IR patterns
                    }
                }
            }
        }
    }

    /**
     * Discover lifecycle methods in a class based on a registry.
     */
    private discoverLifecycleMethods(
        arkClass: ArkClass,
        registry: Map<string, LifecycleMethodInfo>,
        layer: 'ability' | 'component'
    ): DiscoveredLifecycleMethod[] {
        const methods: DiscoveredLifecycleMethod[] = [];

        for (const method of arkClass.getMethods()) {
            const methodName = method.getName();
            const info = registry.get(methodName);
            if (!info) continue;

            // Filter out SDK and dependency methods
            const fileName = method.getDeclaringArkFile().getName();
            if (fileName.startsWith('api/') || fileName.includes('node_modules') ||
                fileName.includes('oh_modules') || fileName.includes('.preview') ||
                fileName.includes('cache')) {
                continue;
            }

            const classRole = layer === 'ability'
                ? this.classifyAbilityClass(arkClass) ? 'ability' : 'service'
                : 'component';

            methods.push({
                method,
                info,
                declaringClass: arkClass,
                classRole,
            });
        }

        return methods;
    }

    // ---- Classification Methods ----

    /**
     * Determine if a class is a UIAbility subclass and return its specific role.
     */
    private classifyAbilityClass(arkClass: ArkClass): LifecycleModel['abilities'][number]['role'] | null {
        const superClassName = arkClass.getSuperClassName();

        // Direct inheritance check
        if (ABILITY_BASE_CLASSES.includes(superClassName)) {
            return superClassName as LifecycleModel['abilities'][number]['role'];
        }

        // Transitive inheritance check
        try {
            const allHeritage = arkClass.getAllHeritageClasses();
            for (const heritage of allHeritage) {
                const name = heritage.getName();
                if (ABILITY_BASE_CLASSES.includes(name)) {
                    return name as LifecycleModel['abilities'][number]['role'];
                }
            }
        } catch {
            // getAllHeritageClasses may fail for SDK classes
        }

        return null;
    }

    /**
     * Determine if a class is a CustomComponent.
     */
    private isComponentClass(arkClass: ArkClass): boolean {
        // Check superclass
        const superClassName = arkClass.getSuperClassName();
        if (COMPONENT_BASE_CLASSES.includes(superClassName)) {
            return true;
        }

        // Check decorators
        try {
            const decorators = (arkClass as any).getDecorators?.();
            if (decorators) {
                for (const dec of decorators) {
                    if (COMPONENT_DECORATORS.includes(dec.getName?.() ?? dec.name ?? '')) {
                        return true;
                    }
                }
            }
        } catch {
            // Decorator access may fail
        }

        // Fallback: check if the class has multiple component lifecycle methods
        let componentMethodCount = 0;
        for (const method of arkClass.getMethods()) {
            if (COMPONENT_METHOD_MAP.has(method.getName())) {
                componentMethodCount++;
            }
        }
        // A class with 2+ component lifecycle methods is likely a component
        return componentMethodCount >= 2;
    }

    // ---- Transition Building ----

    /**
     * Build lifecycle transition edges based on the state machine model.
     *
     * This generates four types of transitions:
     * 1. Intra-layer: Ability→Ability, Component→Component (sequential lifecycle)
     * 2. Cross-layer: Ability→Component (framework implicit calls, ownership-scoped)
     * 3. Component nesting: Parent→Child (aboutToAppear ordering, aboutToDisappear reverse)
     * 4. Callback attachment: Component→Callback (event registration)
     */
    private buildTransitions(
        abilities: LifecycleModel['abilities'],
        components: LifecycleModel['components'],
        ownership: AbilityComponentOwnership
    ): LifecycleTransition[] {
        const transitions: LifecycleTransition[] = [];

        // 1. Intra-layer Ability transitions
        for (const ability of abilities) {
            this.buildIntraLayerTransitions(ability.methods, transitions);
        }

        // 2. Intra-layer Component transitions
        for (const component of components) {
            this.buildIntraLayerTransitions(component.methods, transitions);
        }

        // 3. Cross-layer transitions (Ability → Component), ownership-scoped
        for (const ability of abilities) {
            // Get components owned by this ability (or all if ownership unknown)
            const ownedComponents = ownership.abilityToComponents.get(ability.arkClass);
            if (ownedComponents && ownedComponents.length > 0) {
                // Ownership-scoped: only connect components belonging to this ability
                for (const componentArkClass of ownedComponents) {
                    const componentEntry = components.find(c => c.arkClass === componentArkClass);
                    if (componentEntry) {
                        this.buildCrossLayerTransitions(ability.methods, componentEntry.methods, transitions);
                    }
                }
            } else {
                // Fallback: no ownership info for this ability, connect to unowned components
                const unownedComponents = components.filter(c =>
                    !ownership.componentToAbility.has(c.arkClass)
                );
                for (const component of unownedComponents) {
                    this.buildCrossLayerTransitions(ability.methods, component.methods, transitions);
                }
            }
        }

        // 4. Component nesting transitions (parent → child ordering)
        this.buildNestingTransitions(components, transitions);

        return transitions;
    }

    /**
     * Build transitions between parent and child components to model
     * the creation/destruction ordering imposed by the component tree.
     *
     * Rules:
     *   - Parent aboutToAppear → Child aboutToAppear (parent initializes first)
     *   - Parent build → Child build (parent's build creates child)
     *   - Child aboutToDisappear → Parent aboutToDisappear (child cleans up first)
     */
    private buildNestingTransitions(
        components: LifecycleModel['components'],
        transitions: LifecycleTransition[]
    ): void {
        for (const comp of components) {
            if (comp.childComponents.length === 0) continue;

            // Find parent's lifecycle methods
            const parentAppear = comp.methods.find(m => m.info.phase === ComponentPhase.APPEARING);
            const parentBuild = comp.methods.find(m => m.info.phase === ComponentPhase.BUILT);
            const parentDisappear = comp.methods.find(m => m.info.phase === ComponentPhase.DISAPPEARING);

            for (const childArkClass of comp.childComponents) {
                const childComp = components.find(c => c.arkClass === childArkClass);
                if (!childComp) continue;

                const childAppear = childComp.methods.find(m => m.info.phase === ComponentPhase.APPEARING);
                const childBuild = childComp.methods.find(m => m.info.phase === ComponentPhase.BUILT);
                const childDisappear = childComp.methods.find(m => m.info.phase === ComponentPhase.DISAPPEARING);

                // Parent aboutToAppear → Child aboutToAppear
                if (parentAppear && childAppear) {
                    transitions.push({
                        fromMethod: parentAppear.method,
                        toMethod: childAppear.method,
                        fromPhase: ComponentPhase.APPEARING,
                        toPhase: ComponentPhase.APPEARING,
                        crossLayer: false,
                    });
                }

                // Parent build → Child build
                if (parentBuild && childBuild) {
                    transitions.push({
                        fromMethod: parentBuild.method,
                        toMethod: childBuild.method,
                        fromPhase: ComponentPhase.BUILT,
                        toPhase: ComponentPhase.BUILT,
                        crossLayer: false,
                    });
                }

                // Child aboutToDisappear → Parent aboutToDisappear
                if (childDisappear && parentDisappear) {
                    transitions.push({
                        fromMethod: childDisappear.method,
                        toMethod: parentDisappear.method,
                        fromPhase: ComponentPhase.DISAPPEARING,
                        toPhase: ComponentPhase.DISAPPEARING,
                        crossLayer: false,
                    });
                }
            }
        }
    }

    /**
     * Build transitions between lifecycle methods within the same layer.
     * Follows the state machine: each method's nextPhases determine valid successors.
     */
    private buildIntraLayerTransitions(
        methods: DiscoveredLifecycleMethod[],
        transitions: LifecycleTransition[]
    ): void {
        // Group methods by phase for quick lookup
        const methodsByPhase = new Map<string, DiscoveredLifecycleMethod[]>();
        for (const m of methods) {
            const phaseKey = String(m.info.phase);
            if (!methodsByPhase.has(phaseKey)) {
                methodsByPhase.set(phaseKey, []);
            }
            methodsByPhase.get(phaseKey)!.push(m);
        }

        // For each method, find methods in its nextPhases
        for (const fromMethod of methods) {
            for (const nextPhase of fromMethod.info.nextPhases) {
                const nextPhaseKey = String(nextPhase);
                const candidates = methodsByPhase.get(nextPhaseKey) ?? [];
                for (const toMethod of candidates) {
                    // Only add transitions within the same class
                    if (fromMethod.declaringClass === toMethod.declaringClass) {
                        transitions.push({
                            fromMethod: fromMethod.method,
                            toMethod: toMethod.method,
                            fromPhase: fromMethod.info.phase as AbilityPhase | ComponentPhase,
                            toPhase: toMethod.info.phase as AbilityPhase | ComponentPhase,
                            crossLayer: false,
                        });
                    }
                }
            }
        }
    }

    /**
     * Build cross-layer transitions from Ability methods to Component methods.
     * These represent the implicit framework calls that the HarmonyOS runtime makes.
     */
    private buildCrossLayerTransitions(
        abilityMethods: DiscoveredLifecycleMethod[],
        componentMethods: DiscoveredLifecycleMethod[],
        transitions: LifecycleTransition[]
    ): void {
        for (const rule of CROSS_LAYER_TRANSITIONS) {
            // Find ability methods in the triggering phase
            const triggerMethods = abilityMethods.filter(
                m => String(m.info.phase) === String(rule.abilityPhase)
            );

            // Find component methods in the target phase
            const targetMethods = componentMethods.filter(
                m => rule.componentPhase !== null && String(m.info.phase) === String(rule.componentPhase)
            );

            // Add cross-layer edges
            for (const trigger of triggerMethods) {
                for (const target of targetMethods) {
                    transitions.push({
                        fromMethod: trigger.method,
                        toMethod: target.method,
                        fromPhase: rule.abilityPhase,
                        toPhase: rule.componentPhase!,
                        crossLayer: true,
                    });
                }
            }
        }
    }

    // ---- Ownership Building (module.json5 + heuristic) ----

    /**
     * Build the Ability→Component ownership map.
     *
     * Strategy:
     *   1. Parse module.json5 to find Ability srcEntry paths and pages
     *   2. Match Ability srcEntry to ArkClass (by file path)
     *   3. Match page files to Component ArkClasses (by file path)
     *   4. Fallback heuristic: single Ability owns all Components;
     *      multiple Abilities → assign Components by file proximity
     */
    private buildOwnership(
        abilities: LifecycleModel['abilities'],
        components: LifecycleModel['components']
    ): AbilityComponentOwnership {
        const abilityToComponents = new Map<ArkClass, ArkClass[]>();
        const componentToAbility = new Map<ArkClass, ArkClass>();

        // Initialize empty arrays for all abilities
        for (const ability of abilities) {
            abilityToComponents.set(ability.arkClass, []);
        }

        // Try config-based ownership first
        const moduleConfigs = this.parseModuleConfigs();
        if (moduleConfigs.length > 0) {
            const configDerived = this.deriveOwnershipFromConfig(abilities, components, moduleConfigs);
            if (configDerived) {
                return configDerived;
            }
        }

        // Fallback: heuristic ownership
        this.deriveOwnershipHeuristic(abilities, components, abilityToComponents, componentToAbility);

        return { abilityToComponents, componentToAbility, fromConfig: false };
    }

    /**
     * Parse all module.json5 files in the project.
     * Returns parsed configs for each module found.
     */
    private parseModuleConfigs(): ModuleConfig[] {
        const configs: ModuleConfig[] = [];
        let projectDir: string;

        try {
            projectDir = this.scene.getRealProjectDir();
        } catch {
            return configs;
        }

        if (!projectDir || !fs.existsSync(projectDir)) {
            return configs;
        }

        // Search for module.json5 files (typically at entry/src/main/module.json5)
        this.findModuleJson5Files(projectDir, configs, 5 /* max depth: entry/src/main/module.json5 = 4 levels */);

        return configs;
    }

    /**
     * Recursively find and parse module.json5 files.
     */
    private findModuleJson5Files(dir: string, configs: ModuleConfig[], maxDepth: number): void {
        if (maxDepth <= 0) return;

        let entries: string[];
        try {
            entries = fs.readdirSync(dir);
        } catch {
            return;
        }

        for (const entry of entries) {
            const fullPath = path.join(dir, entry);

            if (entry === 'module.json5') {
                try {
                    const content = fs.readFileSync(fullPath, 'utf-8');
                    // Strip JSON5 comments (single-line // and multi-line /* */)
                    // and trailing commas before } or ] (JSON5 allows them, JSON.parse does not)
                    const stripped = content
                        .replace(/\/\/.*$/gm, '')
                        .replace(/\/\*[\s\S]*?\*\//g, '')
                        .replace(/,\s*([}\]])/g, '$1');
                    const parsed = JSON.parse(stripped);
                    const mod = parsed.module;
                    if (mod) {
                        configs.push({
                            abilities: (mod.abilities || []).map((a: any) => ({
                                name: a.name || '',
                                srcEntry: a.srcEntry || a.srcEntrance || '',
                            })),
                            pages: mod.pages ? (Array.isArray(mod.pages) ? mod.pages : [mod.pages]) : [],
                            extensionAbilities: (mod.extensionAbilities || []).map((a: any) => ({
                                name: a.name || '',
                                srcEntry: a.srcEntry || a.srcEntrance || '',
                            })),
                        });
                    }
                } catch (e) {
                    // module.json5 parse failure, skip
                }
            } else if (fs.existsSync(fullPath) && fs.statSync(fullPath).isDirectory()) {
                // Skip common non-source directories
                if (entry === 'node_modules' || entry === 'oh_modules' || entry === '.preview' ||
                    entry === 'cache' || entry === 'build' || entry === '.cxx') {
                    continue;
                }
                this.findModuleJson5Files(fullPath, configs, maxDepth - 1);
            }
        }
    }

    /**
     * Derive ownership from module.json5 configuration.
     * Maps Ability srcEntry → ArkClass, and page files → Component ArkClasses.
     */
    private deriveOwnershipFromConfig(
        abilities: LifecycleModel['abilities'],
        components: LifecycleModel['components'],
        moduleConfigs: ModuleConfig[]
    ): AbilityComponentOwnership | null {
        const abilityToComponents = new Map<ArkClass, ArkClass[]>();
        const componentToAbility = new Map<ArkClass, ArkClass>();

        // Initialize empty arrays for all abilities
        for (const ability of abilities) {
            abilityToComponents.set(ability.arkClass, []);
        }

        let projectDir: string;
        try {
            projectDir = this.scene.getRealProjectDir();
        } catch {
            return null;
        }

        // Build a map from relative file path → ArkClass for all classes
        // Use a multi-map approach: store ALL classes for each path, then pick
        // the best one (Ability class for ability paths, Component class for page paths)
        const filePathToArkClasses = new Map<string, ArkClass[]>();
        for (const arkClass of this.scene.getClasses()) {
            try {
                const arkFile = arkClass.getDeclaringArkFile();
                const filePath = arkFile.getName();
                const paths = [filePath, filePath.replace(/^\.\//, '')];
                const etsMatch = filePath.match(/(ets[/\\].+\.(ets|ts))$/);
                if (etsMatch) paths.push(etsMatch[1]);
                for (const p of paths) {
                    if (!filePathToArkClasses.has(p)) filePathToArkClasses.set(p, []);
                    filePathToArkClasses.get(p)!.push(arkClass);
                }
            } catch {
                // skip
            }
        }

        // Helper: find the best matching ArkClass for a given path
        // For ability paths: prefer classes that are Ability subclasses
        // For page paths: prefer classes that are Component subclasses
        const findBestClass = (p: string, type: 'ability' | 'component'): ArkClass | null => {
            const candidates = filePathToArkClasses.get(p);
            if (!candidates) return null;
            if (type === 'ability') {
                const ability = candidates.find(c => this.classifyAbilityClass(c) !== null);
                if (ability) return ability;
            } else {
                const component = candidates.find(c => this.isComponentClass(c));
                if (component) return component;
            }
            return candidates[0] || null;
        };

        // Build a map from Ability name → ArkClass
        const abilityNameToArkClass = new Map<string, ArkClass>();
        for (const ability of abilities) {
            abilityNameToArkClass.set(ability.arkClass.getName(), ability.arkClass);
        }

        let anyMappingFound = false;

        for (const config of moduleConfigs) {
            // For each ability in the config, find its ArkClass via srcEntry
            for (const abilityConfig of config.abilities) {
                const abilityArkClass = this.findArkClassBySrcEntry(
                    abilityConfig.srcEntry, abilityConfig.name,
                    filePathToArkClasses, abilityNameToArkClass
                );

                if (!abilityArkClass) continue;

                // Find pages associated with this module
                const pageFiles = this.resolvePagePaths(config.pages, projectDir);

                // Find component classes declared in those page files
                for (const pageFile of pageFiles) {
                    const pageArkClass = findBestClass(pageFile, 'component');
                    if (pageArkClass) {
                        const list = abilityToComponents.get(abilityArkClass) || [];
                        if (!list.includes(pageArkClass)) {
                            list.push(pageArkClass);
                            abilityToComponents.set(abilityArkClass, list);
                            componentToAbility.set(pageArkClass, abilityArkClass);
                            anyMappingFound = true;
                        }
                    }
                }

                // Also find component classes in the same directory as the ability srcEntry
                // (common pattern: EntryAbility.ets and Index.ets are in different dirs,
                // but components in ets/pages/ belong to the ability)
                for (const [filePath, arkClasses] of filePathToArkClasses) {
                    const compClass = arkClasses.find(c => this.isComponentClass(c) && !componentToAbility.has(c));
                    if (compClass) {
                        // Check if this component's file is under the same module
                        const fileDir = path.dirname(filePath);
                        if (fileDir.startsWith('ets/') || fileDir.startsWith('ets\\')) {
                            const abilityList = abilityToComponents.get(abilityArkClass) || [];
                            if (!abilityList.includes(compClass)) {
                                abilityList.push(compClass);
                                abilityToComponents.set(abilityArkClass, abilityList);
                                componentToAbility.set(compClass, abilityArkClass);
                                anyMappingFound = true;
                            }
                        }
                    }
                }
            }
        }

        if (!anyMappingFound) {
            return null;
        }

        return { abilityToComponents, componentToAbility, fromConfig: true };
    }

    /**
     * Find an ArkClass matching a srcEntry path from module.json5.
     */
    private findArkClassBySrcEntry(
        srcEntry: string,
        abilityName: string,
        filePathToArkClasses: Map<string, ArkClass[]>,
        abilityNameToArkClass: Map<string, ArkClass>
    ): ArkClass | null {
        // Try by ability name first (most reliable — matches the declared class name)
        const byName = abilityNameToArkClass.get(abilityName);
        if (byName) return byName;

        // Try exact srcEntry match, pick the one that's an Ability subclass
        const cleanSrcEntry = srcEntry.replace(/^\.\//, '');
        const candidates = filePathToArkClasses.get(cleanSrcEntry);
        if (candidates) {
            const ability = candidates.find(c => this.classifyAbilityClass(c) !== null);
            if (ability) return ability;
        }

        // Try .ets → .ts variant
        if (cleanSrcEntry.endsWith('.ets')) {
            const tsVariant = cleanSrcEntry.replace(/\.ets$/, '.ts');
            const tsCandidates = filePathToArkClasses.get(tsVariant);
            if (tsCandidates) {
                const ability = tsCandidates.find(c => this.classifyAbilityClass(c) !== null);
                if (ability) return ability;
            }
        }

        // Try fuzzy: srcEntry filename matches a path suffix
        const srcFileName = path.basename(cleanSrcEntry, path.extname(cleanSrcEntry));
        for (const [filePath, arkClasses] of filePathToArkClasses) {
            if (filePath.endsWith(srcFileName + '.ts') || filePath.endsWith(srcFileName + '.ets')) {
                const ability = arkClasses.find(c => this.classifyAbilityClass(c) !== null);
                if (ability) return ability;
            }
        }

        return null;
    }

    /**
     * Resolve page file paths from the pages configuration.
     * pages can be "$profile:main_pages" (reference) or a direct array of paths.
     * Returns all path variants for flexible matching.
     */
    private resolvePagePaths(pages: string[], projectDir: string): string[] {
        const resolvedPaths: string[] = [];

        for (const page of pages) {
            if (page.startsWith('$profile:')) {
                // Reference to a profile file, try to read it
                const profileName = page.substring('$profile:'.length);
                // Search multiple possible locations for the profile
                const profileSearchPaths = [
                    path.join(projectDir, 'entry', 'src', 'main', 'resources', 'base', 'profile'),
                    path.join(projectDir, 'src', 'main', 'resources', 'base', 'profile'),
                ];
                for (const profileDir of profileSearchPaths) {
                    const profilePath = path.join(profileDir, profileName + '.json');
                    try {
                        if (fs.existsSync(profilePath)) {
                            const content = fs.readFileSync(profilePath, 'utf-8');
                            const parsed = JSON.parse(content);
                            if (parsed.src && Array.isArray(parsed.src)) {
                                for (const src of parsed.src) {
                                    resolvedPaths.push(...this.normalizePagePath(src));
                                }
                            }
                            break; // found, stop searching
                        }
                    } catch {
                        // Profile read failed, try next location
                    }
                }
            } else {
                resolvedPaths.push(...this.normalizePagePath(page));
            }
        }

        return resolvedPaths;
    }

    /**
     * Normalize a page path to match ArkFile naming convention.
     * "pages/Index" → "ets/pages/Index.ets"
     *
     * Returns multiple variants for flexible matching since ArkFile paths
     * may use .ts instead of .ets, and may contain .preview/cache prefixes.
     */
    private normalizePagePath(page: string): string[] {
        const base = page.replace(/^\.\//, '');
        const variants: string[] = [];

        // With ets/ prefix and .ets extension
        const etsPath = 'ets/' + base + '.ets';
        const etsPathTs = 'ets/' + base + '.ts';
        variants.push(etsPath, etsPathTs);

        // Without ets/ prefix
        variants.push(base + '.ets', base + '.ts');

        return variants;
    }

    /**
     * Heuristic ownership: assign components to abilities when config parsing fails.
     *
     * Rules:
     *   - Single Ability: owns all components (most common case)
     *   - Multiple Abilities: assign each component to the ability whose srcEntry
     *     directory is closest to the component's file directory
     *   - Unowned components: assigned to the first (main) ability
     */
    private deriveOwnershipHeuristic(
        abilities: LifecycleModel['abilities'],
        components: LifecycleModel['components'],
        abilityToComponents: Map<ArkClass, ArkClass[]>,
        componentToAbility: Map<ArkClass, ArkClass>
    ): void {
        if (abilities.length === 0 || components.length === 0) return;

        if (abilities.length === 1) {
            // Single ability owns all components
            const allComponentClasses = components.map(c => c.arkClass);
            abilityToComponents.set(abilities[0].arkClass, allComponentClasses);
            for (const comp of components) {
                componentToAbility.set(comp.arkClass, abilities[0].arkClass);
            }
            return;
        }

        // Multiple abilities: try to match by file path proximity
        const abilityDirs = abilities.map(a => {
            try {
                return path.dirname(a.arkClass.getDeclaringArkFile().getName());
            } catch {
                return '';
            }
        });

        for (const component of components) {
            let compDir = '';
            try {
                compDir = path.dirname(component.arkClass.getDeclaringArkFile().getName());
            } catch {
                // skip
            }

            // Find the ability with the most similar directory path
            let bestAbility = abilities[0];
            let bestScore = -1;

            for (let i = 0; i < abilities.length; i++) {
                const abilityDir = abilityDirs[i];
                if (!abilityDir || !compDir) continue;

                // Score: count common path segments
                const abilityParts = abilityDir.split(/[/\\]/);
                const compParts = compDir.split(/[/\\]/);
                let score = 0;
                for (const part of abilityParts) {
                    if (compParts.includes(part)) score++;
                }

                if (score > bestScore) {
                    bestScore = score;
                    bestAbility = abilities[i];
                }
            }

            const list = abilityToComponents.get(bestAbility.arkClass) || [];
            list.push(component.arkClass);
            abilityToComponents.set(bestAbility.arkClass, list);
            componentToAbility.set(component.arkClass, bestAbility.arkClass);
        }
    }

    // ---- Utility Methods ----

    /**
     * Get all method names in the lifecycle registry.
     */
    static getAllLifecycleMethodNames(): string[] {
        return [
            ...ABILITY_LIFECYCLE_REGISTRY.map(m => m.methodName),
            ...COMPONENT_LIFECYCLE_REGISTRY.map(m => m.methodName),
            ...CALLBACK_REGISTRY.map(m => m.methodName),
        ];
    }

    /**
     * Get the ability lifecycle registry.
     */
    static getAbilityRegistry(): LifecycleMethodInfo[] {
        return ABILITY_LIFECYCLE_REGISTRY;
    }

    /**
     * Get the component lifecycle registry.
     */
    static getComponentRegistry(): LifecycleMethodInfo[] {
        return COMPONENT_LIFECYCLE_REGISTRY;
    }

    /**
     * Get the callback registry.
     */
    static getCallbackRegistry(): LifecycleMethodInfo[] {
        return CALLBACK_REGISTRY;
    }

    /**
     * Get cross-layer transition rules.
     */
    static getCrossLayerRules(): typeof CROSS_LAYER_TRANSITIONS {
        return CROSS_LAYER_TRANSITIONS;
    }

    /**
     * Generate a DOT graph of the lifecycle state machine.
     * Useful for visualization and debugging.
     */
    toDotGraph(): string {
        const lines: string[] = [
            'digraph LifecycleStateMachine {',
            '  rankdir=TB;',
            '  node [shape=box, style=filled];',
            '',
        ];

        // Ability states
        lines.push('  subgraph cluster_ability {');
        lines.push('    label="UIAbility Lifecycle";');
        lines.push('    style=dashed;');
        for (const phase of Object.values(AbilityPhase)) {
            const methods = ABILITY_LIFECYCLE_REGISTRY.filter(m => String(m.phase) === phase);
            const label = methods.length > 0
                ? `${phase}\\n${methods.map(m => m.methodName).join(', ')}`
                : phase;
            lines.push(`    ${phase} [label="${label}", fillcolor="#E8F5E9"];`);
        }
        // Ability transitions
        for (const method of ABILITY_LIFECYCLE_REGISTRY) {
            for (const next of method.nextPhases) {
                if (Object.values(AbilityPhase).includes(next as AbilityPhase)) {
                    lines.push(`    ${method.phase} -> ${next} [label="${method.methodName}"];`);
                }
            }
        }
        lines.push('  }');
        lines.push('');

        // Component states
        lines.push('  subgraph cluster_component {');
        lines.push('    label="Component Lifecycle";');
        lines.push('    style=dashed;');
        for (const phase of Object.values(ComponentPhase)) {
            const methods = COMPONENT_LIFECYCLE_REGISTRY.filter(m => String(m.phase) === phase);
            const label = methods.length > 0
                ? `${phase}\\n${methods.map(m => m.methodName).join(', ')}`
                : phase;
            lines.push(`    ${phase} [label="${label}", fillcolor="#E3F2FD"];`);
        }
        for (const method of COMPONENT_LIFECYCLE_REGISTRY) {
            for (const next of method.nextPhases) {
                if (Object.values(ComponentPhase).includes(next as ComponentPhase)) {
                    lines.push(`    ${method.phase} -> ${next} [label="${method.methodName}"];`);
                }
            }
        }
        lines.push('  }');
        lines.push('');

        // Cross-layer transitions
        lines.push('  // Cross-layer transitions (implicit framework calls)');
        for (const rule of CROSS_LAYER_TRANSITIONS) {
            if (rule.componentPhase) {
                lines.push(`  ${rule.abilityPhase} -> ${rule.componentPhase} [style=dashed, color=red, label="${rule.description}"];`);
            }
        }
        lines.push('');

        // Callbacks
        lines.push('  subgraph cluster_callbacks {');
        lines.push('    label="UI Callbacks";');
        lines.push('    style=dashed;');
        const callbackNames = CALLBACK_REGISTRY.map(m => m.methodName);
        lines.push(`    callbacks [label="Callbacks\\n${callbackNames.join(', ')}", fillcolor="#FFF3E0"];`);
        lines.push(`    ${ComponentPhase.BUILT} -> callbacks [style=dotted, label="event registration"];`);
        lines.push('  }');

        lines.push('}');
        return lines.join('\n');
    }
}
