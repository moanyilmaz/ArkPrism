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
    {
        abilityPhase: AbilityPhase.BACKGROUNDED,
        componentPhase: ComponentPhase.PAGE_HIDDEN,
        description: 'onBackground triggers onPageHide for visible components'
    },
    {
        abilityPhase: AbilityPhase.DESTROYING,
        componentPhase: ComponentPhase.DISAPPEARING,
        description: 'onDestroy triggers aboutToDisappear for all components'
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

        // Build transitions
        const transitions = this.buildTransitions(abilities, components);

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
                components.push({ arkClass, methods });
            }
        }

        return components;
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

            // Filter out SDK methods
            const fileName = method.getDeclaringArkFile().getName();
            if (fileName.startsWith('api/')) continue;

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
     * This generates three types of transitions:
     * 1. Intra-layer: Ability→Ability, Component→Component (sequential lifecycle)
     * 2. Cross-layer: Ability→Component (framework implicit calls)
     * 3. Callback attachment: Component→Callback (event registration)
     */
    private buildTransitions(
        abilities: LifecycleModel['abilities'],
        components: LifecycleModel['components']
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

        // 3. Cross-layer transitions (Ability → Component)
        for (const ability of abilities) {
            for (const component of components) {
                this.buildCrossLayerTransitions(ability.methods, component.methods, transitions);
            }
        }

        return transitions;
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
