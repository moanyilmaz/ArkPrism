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
 *
 * Level 2 CFG structure:
 *   firstBlock [staticInit, classInit, count=0]
 *     → abilityStartupChain [onCreate → onWindowStageCreate → onForeground] (sequential)
 *       → componentStartupChain [aboutToAppear → build] (sequential)
 *         → whileBlock
 *           → if(count==N) { callback/background/destroy } (if-count branches)
 *         → returnBlock
 *
 * The sequential startup chain enables IFDS to propagate taint across
 * lifecycle phases. The if-count branches for callbacks preserve the
 * non-deterministic nature of user interaction handlers.
 */

import {
    Scene, ArkMethod,
    DummyMainCreater,
    BasicBlock, Cfg, ArkBody, ArkFile, ArkClass,
    ArkAssignStmt, ArkInvokeStmt, ArkIfStmt, ArkReturnVoidStmt,
    ArkInstanceInvokeExpr, ArkStaticInvokeExpr, ArkNewExpr, ArkConditionExpr,
    Local, Constant, ClassType, NumberType,
    ValueUtil, RelationalBinaryOperator,
    MethodSignature, ArkSignatureBuilder, FileSignature, ClassSignature,
} from './arkanalyzer';
import {
    LifecycleModel, AbilityPhase, ComponentPhase, LifecycleTransition,
    DiscoveredLifecycleMethod,
} from './lifecycleModeler';

// ============================================================================
// Level 1: Pre-configuration (existing implementation)
// ============================================================================

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
    console.log('[DUMMYMAIN] Building lifecycle-aware DummyMain (Level 1)...');

    // Create the standard DummyMainCreater
    const creater = new DummyMainCreater(scene);

    // Organize entry methods in lifecycle dependency order
    const orderedMethods = organizeEntryMethodsByLifecycle(lifecycleModel);

    // Pre-configure the entry methods
    creater.setEntryMethods(orderedMethods);

    // Build the DummyMain
    creater.createDummyMain();

    const dummyMain = creater.getDummyMain();
    console.log(`[DUMMYMAIN] Created Level 1 DummyMain with ${orderedMethods.length} entry methods.`);
    console.log(`[DUMMYMAIN]   Ability: ${lifecycleModel.entryMethodsByLayer.ability.length}`);
    console.log(`[DUMMYMAIN]   Component: ${lifecycleModel.entryMethodsByLayer.component.length}`);
    console.log(`[DUMMYMAIN]   Callback: ${lifecycleModel.entryMethodsByLayer.callback.length}`);

    return { dummyMain, modeler: creater };
}

/**
 * Organize entry methods in lifecycle dependency order.
 */
function organizeEntryMethodsByLifecycle(model: LifecycleModel): ArkMethod[] {
    const methods: ArkMethod[] = [];

    const abilityStartupOrder = [
        AbilityPhase.CREATING,
        AbilityPhase.WINDOW_CREATED,
    ];
    const abilityForeground = [AbilityPhase.FOREGROUNDED];
    const componentStartupOrder = [
        ComponentPhase.APPEARING,
        ComponentPhase.BUILT,
        ComponentPhase.PAGE_SHOWN,
    ];
    const abilityBackground = [AbilityPhase.BACKGROUNDED];
    const componentBackground = [ComponentPhase.PAGE_HIDDEN];
    const abilityDestroy = [AbilityPhase.DESTROYING];
    const componentDestroy = [ComponentPhase.DISAPPEARING];

    for (const phase of abilityStartupOrder) {
        for (const ability of model.abilities) {
            for (const m of ability.methods) {
                if (String(m.info.phase) === String(phase)) {
                    methods.push(m.method);
                }
            }
        }
    }
    for (const phase of abilityForeground) {
        for (const ability of model.abilities) {
            for (const m of ability.methods) {
                if (String(m.info.phase) === String(phase)) {
                    methods.push(m.method);
                }
            }
        }
    }
    for (const phase of componentStartupOrder) {
        for (const component of model.components) {
            for (const m of component.methods) {
                if (String(m.info.phase) === String(phase)) {
                    methods.push(m.method);
                }
            }
        }
    }
    methods.push(...model.entryMethodsByLayer.callback);
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

// ============================================================================
// Level 2: Lifecycle-structured CFG
// ============================================================================

/**
 * Classification of methods for CFG structure.
 * - STARTUP: Sequential chain (deterministic lifecycle sequence)
 * - NONDETERMINISTIC: If-count branch (callbacks, background, destroy)
 */
type MethodClassification = 'STARTUP' | 'NONDETERMINISTIC';

interface ClassifiedMethod {
    method: ArkMethod;
    classification: MethodClassification;
    /** For startup methods: position in the sequential chain */
    startupOrder: number;
    /** The lifecycle info (if available) */
    lifecycleInfo?: DiscoveredLifecycleMethod;
}

/**
 * Build a lifecycle-structured DummyMain with Level 2 enhancement.
 *
 * Instead of the flat if-count chain, this creates:
 * 1. A sequential startup chain for deterministic lifecycle methods
 * 2. If-count branches for non-deterministic callbacks/background/destroy
 *
 * The sequential chain enables IFDS taint propagation across lifecycle
 * phase boundaries (e.g., Want parameter from onCreate to onWindowStageCreate,
 * component state from aboutToAppear to build).
 */
export function buildLifecycleStructuredDummyMain(
    scene: Scene,
    lifecycleModel: LifecycleModel
): { dummyMain: ArkMethod; stats: Level2Stats } {
    console.log('[DUMMYMAIN] Building lifecycle-structured DummyMain (Level 2)...');

    const stats: Level2Stats = {
        abilityStartupMethods: 0,
        componentStartupMethods: 0,
        nondeterministicMethods: 0,
        totalBlocks: 0,
        crossPhaseEdges: 0,
    };

    // Classify all methods
    const classified = classifyMethods(lifecycleModel);
    stats.abilityStartupMethods = classified.abilityStartup.length;
    stats.componentStartupMethods = classified.componentStartupGroups.reduce(
        (sum, g) => sum + g.methods.length, 0
    );
    stats.nondeterministicMethods = classified.nondeterministic.length;

    // Build the same-instance Local map: same class → same Local
    const classLocalMap = buildClassLocalMap(scene, lifecycleModel, classified);

    // Create the ArkMethod shell
    const { dummyMain, dummyCfg } = createDummyMainShell(scene);

    // ====================================================================
    // Build the CFG structure
    // ====================================================================

    // 1. First block: static init, class init, count assignment
    const firstBlock = new BasicBlock();
    addStaticInits(scene, dummyCfg, firstBlock);
    addClassInits(classLocalMap, firstBlock, scene);

    // count local for if-count branches
    const countLocal = new Local('count', NumberType.getInstance());
    const zero = ValueUtil.getOrCreateNumberConst(0);
    const countAssignStmt = new ArkAssignStmt(countLocal, zero);
    firstBlock.addStmt(countAssignStmt);

    dummyCfg.addBlock(firstBlock);
    const startingStmt = firstBlock.getHead();
    if (startingStmt) {
        dummyCfg.setStartingStmt(startingStmt);
    }

    let currentTail: BasicBlock = firstBlock;

    // 2. Ability startup chain (sequential)
    //    onCreate(want) → onWindowStageCreate(want, abilityStage) → onForeground()
    //    Want parameter is shared across Ability startup methods
    const wantClassType = new ClassType(
        new ClassSignature('Want', new FileSignature(scene.getProjectName(), '@dummyFile'), null)
    );
    const wantLocal = new Local('%wantParam', wantClassType);
    const wantAssignStmt = new ArkAssignStmt(wantLocal, new ArkNewExpr(wantClassType));
    wantLocal.setDeclaringStmt(wantAssignStmt);

    let abilityStartupLocals: Set<Local> = new Set([wantLocal]);

    if (classified.abilityStartup.length > 0) {
        // Add Want creation before ability startup
        currentTail.addStmt(wantAssignStmt);

        for (const entry of classified.abilityStartup) {
            const invokeBlock = new BasicBlock();
            const paramLocals = buildParamLocals(entry.method, abilityStartupLocals, invokeBlock);

            // For Ability startup methods, share the Want parameter
            // onCreate(want) and onWindowStageCreate(want, ...) use the same Want Local
            shareWantParameter(entry.method, paramLocals, wantLocal);

            addMethodInvoke(entry.method, classLocalMap, paramLocals, invokeBlock);
            dummyCfg.addBlock(invokeBlock);

            // Sequential edge: currentTail → invokeBlock
            currentTail.addSuccessorBlock(invokeBlock);
            invokeBlock.addPredecessorBlock(currentTail);
            stats.crossPhaseEdges++;

            currentTail = invokeBlock;
            abilityStartupLocals = new Set([...abilityStartupLocals, ...paramLocals]);
        }
        console.log(`[DUMMYMAIN-L2] Ability startup chain: ${classified.abilityStartup.length} methods`);
    }

    // 3. Cross-layer transition (Ability → Component)
    //    We add a nop statement (ArkAssignStmt count=count) as a transition
    //    marker instead of an empty block. Empty blocks cause IFDS propagation
    //    failures because buildStmtMapInBlock uses successor.getStmts()[0]
    //    which returns undefined for empty blocks.
    if (classified.componentStartupGroups.length > 0 && classified.abilityStartup.length > 0) {
        const transitionBlock = new BasicBlock();
        // Nop statement: count = count (preserves data flow without side effects)
        const nopStmt = new ArkAssignStmt(countLocal, countLocal);
        transitionBlock.addStmt(nopStmt);
        dummyCfg.addBlock(transitionBlock);
        currentTail.addSuccessorBlock(transitionBlock);
        transitionBlock.addPredecessorBlock(currentTail);
        stats.crossPhaseEdges++;
        currentTail = transitionBlock;
        console.log('[DUMMYMAIN-L2] Added cross-layer transition block (Ability → Component)');
    }

    // 4. While block (entry point for all if-count branches)
    //    Both component startup and nondeterministic methods use if-count branches.
    //    Component startup branches have internal sequential sub-chains
    //    (aboutToAppear → build) to enable cross-phase data flow within
    //    the same component.
    const truE = ValueUtil.getBooleanConstant(true);
    const conditionTrue = new ArkConditionExpr(truE, zero, RelationalBinaryOperator.Equality);
    const whileStmt = new ArkIfStmt(conditionTrue);
    const whileBlock = new BasicBlock();
    whileBlock.addStmt(whileStmt);
    dummyCfg.addBlock(whileBlock);
    currentTail.addSuccessorBlock(whileBlock);
    whileBlock.addPredecessorBlock(currentTail);

    // 5. If-count branches for component startup groups
    //    Each group is one component's lifecycle sequence (aboutToAppear → build).
    //    The internal sequential sub-chain enables IFDS to propagate taint
    //    across phases within the same component.
    let count = 0;
    let lastBranchBlocks: BasicBlock[] = [whileBlock];

    if (classified.componentStartupGroups.length > 0) {
        for (const group of classified.componentStartupGroups) {
            count++;
            const condition = new ArkConditionExpr(
                countLocal,
                new Constant(count.toString(), NumberType.getInstance()),
                RelationalBinaryOperator.Equality
            );
            const ifStmt = new ArkIfStmt(condition);
            const ifBlock = new BasicBlock();
            ifBlock.addStmt(ifStmt);
            dummyCfg.addBlock(ifBlock);

            for (const block of lastBranchBlocks) {
                ifBlock.addPredecessorBlock(block);
                block.addSuccessorBlock(ifBlock);
            }

            // Sequential sub-chain within this branch: aboutToAppear → build → ...
            let branchTail: BasicBlock = ifBlock;
            for (const entry of group.methods) {
                const invokeBlock = new BasicBlock();
                const paramLocals = buildParamLocals(entry.method, new Set(), invokeBlock);
                addMethodInvoke(entry.method, classLocalMap, paramLocals, invokeBlock);
                dummyCfg.addBlock(invokeBlock);

                branchTail.addSuccessorBlock(invokeBlock);
                invokeBlock.addPredecessorBlock(branchTail);
                stats.crossPhaseEdges++;

                branchTail = invokeBlock;
            }

            lastBranchBlocks = [ifBlock, branchTail];
        }
        console.log(`[DUMMYMAIN-L2] Component startup: ${classified.componentStartupGroups.length} groups (if-count branches with sequential sub-chains)`);
    }

    // 6. If-count branches for nondeterministic methods (callbacks, background, destroy)
    for (const entry of classified.nondeterministic) {
        count++;
        const condition = new ArkConditionExpr(
            countLocal,
            new Constant(count.toString(), NumberType.getInstance()),
            RelationalBinaryOperator.Equality
        );
        const ifStmt = new ArkIfStmt(condition);
        const ifBlock = new BasicBlock();
        ifBlock.addStmt(ifStmt);
        dummyCfg.addBlock(ifBlock);

        for (const block of lastBranchBlocks) {
            ifBlock.addPredecessorBlock(block);
            block.addSuccessorBlock(ifBlock);
        }

        const invokeBlock = new BasicBlock();
        const paramLocals = buildParamLocals(entry.method, new Set(), invokeBlock);
        addMethodInvoke(entry.method, classLocalMap, paramLocals, invokeBlock);
        dummyCfg.addBlock(invokeBlock);
        ifBlock.addSuccessorBlock(invokeBlock);
        invokeBlock.addPredecessorBlock(ifBlock);

        lastBranchBlocks = [ifBlock, invokeBlock];
    }

    // Connect last branch blocks back to whileBlock (loop)
    for (const block of lastBranchBlocks) {
        block.addSuccessorBlock(whileBlock);
        whileBlock.addPredecessorBlock(block);
    }

    // 7. Return block
    const returnStmt = new ArkReturnVoidStmt();
    const returnBlock = new BasicBlock();
    returnBlock.addStmt(returnStmt);
    dummyCfg.addBlock(returnBlock);
    whileBlock.addSuccessorBlock(returnBlock);
    returnBlock.addPredecessorBlock(whileBlock);

    // ====================================================================
    // Finalize: create body, attach to method, set CFG back-references
    // ====================================================================

    const allLocals = new Set<Local>([
        countLocal,
        wantLocal,
        ...abilityStartupLocals,
        ...classLocalMap.values(),
    ].filter((l): l is Local => l !== null));

    const dummyBody = new ArkBody(allLocals, dummyCfg);
    dummyMain.setBody(dummyBody);

    // Set CFG back-reference on every statement (critical for IFDS)
    for (const block of dummyCfg.getBlocks()) {
        for (const stmt of block.getStmts()) {
            stmt.setCfg(dummyCfg);
        }
    }

    // Register in scene
    scene.addToMethodsMap(dummyMain);

    stats.totalBlocks = [...dummyCfg.getBlocks()].length;

    console.log(`[DUMMYMAIN-L2] Complete: ${stats.totalBlocks} blocks, ${stats.crossPhaseEdges} cross-phase edges`);
    console.log(`[DUMMYMAIN-L2]   Ability startup: ${stats.abilityStartupMethods} methods (sequential)`);
    console.log(`[DUMMYMAIN-L2]   Component startup: ${stats.componentStartupMethods} methods (sequential)`);
    console.log(`[DUMMYMAIN-L2]   Nondeterministic: ${stats.nondeterministicMethods} methods (if-count)`);

    return { dummyMain, stats };
}

/**
 * Statistics for Level 2 DummyMain construction.
 */
export interface Level2Stats {
    abilityStartupMethods: number;
    componentStartupMethods: number;
    nondeterministicMethods: number;
    totalBlocks: number;
    crossPhaseEdges: number;
}

// ============================================================================
// Helper functions
// ============================================================================

interface ClassifiedMethods {
    /** Ability startup methods (onCreate, onWindowStageCreate, onForeground) — sequential chain */
    abilityStartup: Array<{ method: ArkMethod; info?: DiscoveredLifecycleMethod }>;
    /** Component startup groups — each group is one component's sequential sub-chain */
    componentStartupGroups: Array<{
        arkClass: ArkClass;
        methods: Array<{ method: ArkMethod; info?: DiscoveredLifecycleMethod }>;
    }>;
    /** Non-deterministic methods (callbacks, background, destroy) — if-count branches */
    nondeterministic: Array<{ method: ArkMethod; info?: DiscoveredLifecycleMethod }>;
}

/**
 * Classify lifecycle methods into startup (sequential) and non-deterministic (if-count).
 *
 * Startup methods are those that execute in a deterministic order during app startup:
 *   Ability: onCreate → onWindowStageCreate → onForeground
 *   Component: aboutToAppear → build → onPageShow
 *
 * Non-deterministic methods are those that can be triggered at any time:
 *   Callbacks (onClick, onChange, etc.)
 *   Background/destroy (onBackground, onDestroy, aboutToDisappear, etc.)
 */
function classifyMethods(model: LifecycleModel): ClassifiedMethods {
    const result: ClassifiedMethods = {
        abilityStartup: [],
        componentStartupGroups: [],
        nondeterministic: [],
    };

    // Ability startup phases
    const ABILITY_STARTUP_PHASES = new Set<string>([
        String(AbilityPhase.CREATING),       // onCreate
        String(AbilityPhase.WINDOW_CREATED), // onWindowStageCreate
        String(AbilityPhase.FOREGROUNDED),   // onForeground
    ]);

    // Component startup phases
    const COMPONENT_STARTUP_PHASES = new Set<string>([
        String(ComponentPhase.APPEARING),  // aboutToAppear
        String(ComponentPhase.BUILT),      // build
        String(ComponentPhase.PAGE_SHOWN), // onPageShow
    ]);

    // Classify ability methods — group by ability, then sort by phase order
    const abilityPhaseOrder = [
        String(AbilityPhase.CREATING),
        String(AbilityPhase.WINDOW_CREATED),
        String(AbilityPhase.FOREGROUNDED),
    ];
    for (const ability of model.abilities) {
        const startupMethods: Array<{ method: ArkMethod; info?: DiscoveredLifecycleMethod }> = [];
        for (const m of ability.methods) {
            const phaseStr = String(m.info.phase);
            if (ABILITY_STARTUP_PHASES.has(phaseStr)) {
                startupMethods.push({ method: m.method, info: m });
            } else {
                result.nondeterministic.push({ method: m.method, info: m });
            }
        }
        startupMethods.sort((a, b) => {
            const ia = abilityPhaseOrder.indexOf(String(a.info?.info?.phase ?? ''));
            const ib = abilityPhaseOrder.indexOf(String(b.info?.info?.phase ?? ''));
            return ia - ib;
        });
        result.abilityStartup.push(...startupMethods);
    }

    // Classify component methods — group by component (each becomes an if-count branch)
    // Within each group, methods are sorted by phase order (aboutToAppear → build)
    // to enable cross-phase data flow within the same component.
    const componentPhaseOrder = [
        String(ComponentPhase.APPEARING),
        String(ComponentPhase.BUILT),
        String(ComponentPhase.PAGE_SHOWN),
    ];
    for (const component of model.components) {
        const startupMethods: Array<{ method: ArkMethod; info?: DiscoveredLifecycleMethod }> = [];
        for (const m of component.methods) {
            const phaseStr = String(m.info.phase);
            if (COMPONENT_STARTUP_PHASES.has(phaseStr)) {
                startupMethods.push({ method: m.method, info: m });
            } else {
                result.nondeterministic.push({ method: m.method, info: m });
            }
        }
        if (startupMethods.length > 0) {
            startupMethods.sort((a, b) => {
                const ia = componentPhaseOrder.indexOf(String(a.info?.info?.phase ?? ''));
                const ib = componentPhaseOrder.indexOf(String(b.info?.info?.phase ?? ''));
                return ia - ib;
            });
            result.componentStartupGroups.push({
                arkClass: component.arkClass,
                methods: startupMethods,
            });
        }
    }

    // All callbacks are non-deterministic
    for (const cb of model.callbacks) {
        result.nondeterministic.push({ method: cb.method, info: cb });
    }

    return result;
}

/**
 * Build same-instance Local map: all lifecycle methods of the same class
 * share the same this Local. This is critical for IFDS to propagate taint
 * through `this.field` across lifecycle phases.
 *
 * For example, if aboutToAppear sets this.location = geoLocationManager.getCurrentLocation(),
 * and build() reads this.location, the shared this Local ensures IFDS can track
 * the data flow through the field.
 */
function buildClassLocalMap(
    scene: Scene,
    model: LifecycleModel,
    classified: ClassifiedMethods
): Map<ArkMethod, Local | null> {
    const classLocalMap = new Map<ArkMethod, Local | null>();
    const classToLocals = new Map<string, Local>();
    let tempIndex = 0;

    const allMethods = [
        ...classified.abilityStartup,
        ...classified.componentStartupGroups.flatMap(g => g.methods),
        ...classified.nondeterministic,
    ];

    for (const entry of allMethods) {
        const method = entry.method;
        const declaringClass = method.getDeclaringArkClass();

        if (declaringClass.isDefaultArkClass() || method.isStatic()) {
            classLocalMap.set(method, null);
            continue;
        }

        const classSig = declaringClass.getSignature().toString();
        let local = classToLocals.get(classSig);
        if (!local) {
            local = new Local('%' + tempIndex++, new ClassType(declaringClass.getSignature()));
            classToLocals.set(classSig, local);
        }
        classLocalMap.set(method, local);
    }

    return classLocalMap;
}

/**
 * Create the DummyMain ArkMethod shell (file, class, method, signature).
 * This mirrors DummyMainCreater.createDummyMain() setup.
 */
function createDummyMainShell(scene: Scene): { dummyMain: ArkMethod; dummyCfg: Cfg } {
    // Language.UNKNOWN = -1 per ArkFile.d.ts enum definition
    const ArkFileModule = require('./arkanalyzer/core/model/ArkFile');
    const dummyMainFile = new ArkFileModule.ArkFile(ArkFileModule.Language.UNKNOWN);
    dummyMainFile.setScene(scene);
    const dummyMainFileSignature = new FileSignature(scene.getProjectName(), '@dummyFile');
    dummyMainFile.setFileSignature(dummyMainFileSignature);
    scene.setFile(dummyMainFile);

    const dummyMainClass = new ArkClass();
    dummyMainClass.setDeclaringArkFile(dummyMainFile);
    const dummyMainClassSignature = new ClassSignature(
        '@dummyClass',
        dummyMainFile.getFileSignature(),
        null
    );
    dummyMainClass.setSignature(dummyMainClassSignature);
    dummyMainFile.addArkClass(dummyMainClass);

    const dummyMain = new ArkMethod();
    dummyMain.setDeclaringArkClass(dummyMainClass);
    const methodSubSignature = ArkSignatureBuilder.buildMethodSubSignatureFromMethodName('@dummyMain');
    const methodSignature = new MethodSignature(dummyMainClass.getSignature(), methodSubSignature);
    dummyMain.setImplementationSignature(methodSignature);
    dummyMain.setLineCol(0);

    const { checkAndUpdateMethod } = require('./arkanalyzer/core/model/builder/ArkMethodBuilder');
    checkAndUpdateMethod(dummyMain, dummyMainClass);
    dummyMainClass.addMethod(dummyMain);

    const dummyCfg = new Cfg();
    dummyCfg.setDeclaringMethod(dummyMain);

    return { dummyMain, dummyCfg };
}

/**
 * Add static initialization invocations to the first block.
 */
function addStaticInits(scene: Scene, dummyCfg: Cfg, firstBlock: BasicBlock): void {
    let isStartingStmt = true;
    for (const method of scene.getStaticInitMethods()) {
        const staticInvokeExpr = new ArkStaticInvokeExpr(method.getSignature(), []);
        const invokeStmt = new ArkInvokeStmt(staticInvokeExpr);
        if (isStartingStmt) {
            dummyCfg.setStartingStmt(invokeStmt);
            isStartingStmt = false;
        }
        firstBlock.addStmt(invokeStmt);
    }
}

/**
 * Add class instance creation and constructor calls to the first block.
 * Same-instance: same class → same Local (already in classLocalMap).
 */
function addClassInits(
    classLocalMap: Map<ArkMethod, Local | null>,
    firstBlock: BasicBlock,
    scene: Scene
): void {
    const seenLocals = new Set<Local>();
    for (const local of classLocalMap.values()) {
        if (!local || seenLocals.has(local)) continue;
        seenLocals.add(local);

        const clsType = local.getType() as ClassType;
        const cls = scene.getClass(clsType.getClassSignature());
        if (!cls) continue;

        const assStmt = new ArkAssignStmt(local, new ArkNewExpr(clsType));
        firstBlock.addStmt(assStmt);
        local.setDeclaringStmt(assStmt);

        const consMtd = cls.getMethodWithName('constructor');
        if (consMtd) {
            const ivkExpr = new ArkInstanceInvokeExpr(local, consMtd.getSignature(), []);
            const ivkStmt = new ArkInvokeStmt(ivkExpr);
            firstBlock.addStmt(ivkStmt);
        }
    }
}

/**
 * Build parameter locals for a method invocation and add initialization
 * statements to the invoke block.
 *
 * For ClassType parameters, adds ArkNewExpr assignment statements
 * (mirroring DummyMainCreater.addParamInit). For shared parameters
 * (like Want), the shared Local is substituted after this function returns.
 */
function buildParamLocals(
    method: ArkMethod,
    existingLocals: Set<Local>,
    invokeBlock: BasicBlock
): Local[] {
    const paramLocals: Local[] = [];
    let tempIdx = 1000; // Start from high index to avoid collision with classLocals

    for (const param of method.getParameters()) {
        let paramType = param.getType();
        if (!paramType) {
            // Try to get type from super class
            const superCls = method.getDeclaringArkClass().getSuperClass();
            const methodInSuperCls = superCls?.getMethodWithName(method.getName());
            if (methodInSuperCls) {
                const superParams = methodInSuperCls.getParameters();
                const paramIdx = method.getParameters().indexOf(param);
                paramType = superParams[paramIdx]?.getType();
            }
        }
        if (!paramType) {
            paramType = NumberType.getInstance(); // fallback
        }

        const paramLocal = new Local('%p' + tempIdx++, paramType);
        paramLocals.push(paramLocal);

        // Add initialization for ClassType parameters (same as DummyMainCreater.addParamInit)
        if (paramType instanceof ClassType) {
            const assStmt = new ArkAssignStmt(paramLocal, new ArkNewExpr(paramType as ClassType));
            paramLocal.setDeclaringStmt(assStmt);
            invokeBlock.addStmt(assStmt);
        }
    }
    return paramLocals;
}

/**
 * For Ability startup methods, share the Want parameter across methods.
 *
 * In HarmonyOS, onCreate(want) and onWindowStageCreate(want, abilityStage)
 * both receive the same Want object from the framework. By reusing the
 * same Local for the Want parameter, IFDS can track data flow from
 * onCreate's Want to onWindowStageCreate's Want.
 */
function shareWantParameter(
    method: ArkMethod,
    paramLocals: Local[],
    wantLocal: Local
): void {
    const methodName = method.getName();

    // onCreate(want) — first param is Want
    if (methodName === 'onCreate' && paramLocals.length > 0) {
        // Replace the first param local with the shared Want local
        paramLocals[0] = wantLocal;
    }

    // onWindowStageCreate(want, abilityStage) — first param is Want
    if (methodName === 'onWindowStageCreate' && paramLocals.length > 0) {
        paramLocals[0] = wantLocal;
    }

    // onNewWant(want) — first param is Want
    if (methodName === 'onNewWant' && paramLocals.length > 0) {
        paramLocals[0] = wantLocal;
    }
}

/**
 * Add a method invocation statement to a block.
 * Handles both instance and static invocations.
 */
function addMethodInvoke(
    method: ArkMethod,
    classLocalMap: Map<ArkMethod, Local | null>,
    paramLocals: Local[],
    block: BasicBlock
): void {
    const local = classLocalMap.get(method);
    let invokeExpr;
    if (local) {
        invokeExpr = new ArkInstanceInvokeExpr(local, method.getSignature(), paramLocals);
    } else {
        invokeExpr = new ArkStaticInvokeExpr(method.getSignature(), paramLocals);
    }
    const invokeStmt = new ArkInvokeStmt(invokeExpr);
    block.addStmt(invokeStmt);
}

// ============================================================================
// Utility / Reporting
// ============================================================================

/**
 * Get the lifecycle phase label for a method.
 * Used for reporting and debugging.
 */
export function getLifecyclePhaseLabel(method: ArkMethod, model: LifecycleModel): string {
    for (const ability of model.abilities) {
        for (const m of ability.methods) {
            if (m.method === method) {
                return `ability:${String(m.info.phase)}`;
            }
        }
    }
    for (const component of model.components) {
        for (const m of component.methods) {
            if (m.method === method) {
                return `component:${String(m.info.phase)}`;
            }
        }
    }
    for (const cb of model.callbacks) {
        if (cb.method === method) {
            return 'callback';
        }
    }
    return 'unknown';
}

/**
 * Analyze which lifecycle transitions carry taint-relevant data.
 */
export function analyzeTaintRelevantTransitions(
    model: LifecycleModel,
    sourceMethods: Set<string>
): LifecycleTransition[] {
    const relevant: LifecycleTransition[] = [];

    for (const transition of model.transitions) {
        const fromSig = transition.fromMethod.getSignature().toString();
        const toSig = transition.toMethod.getSignature().toString();

        if (sourceMethods.has(fromSig) || sourceMethods.has(toSig) || transition.crossLayer) {
            relevant.push(transition);
        }
    }

    console.log(`[DUMMYMAIN] Taint-relevant transitions: ${relevant.length} / ${model.transitions.length}`);
    return relevant;
}
