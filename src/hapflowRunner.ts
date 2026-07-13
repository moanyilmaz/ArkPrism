/**
 * HapFlow IFDS Taint Analysis Runner
 * Integration bridge between HapFlow framework and ArkPrism pipeline.
 *
 * Responsibilities:
 *   1. Load SDK files for API signature resolution (lazy, on first call)
 *   2. Build DummyMain for analysis entry
 *   3. Optionally run pointer analysis
 *   4. Configure source/sink rules from JSON
 *   5. Execute IFDS taint analysis
 *   6. Convert results to ArkPrism output format
 */

import { Scene, PointerAnalysis, PointerAnalysisConfig, ClassHierarchyAnalysis, CallGraphBuilder, ArkMethod } from './arkanalyzer';
import { TaintAnalysisChecker } from './hapflow/TaintAnalysis';
import { TaintAnalysisSolver } from './hapflow/TaintAnalysisSolver';
import { TaintFact } from './hapflow/TaintFact';
import { TaintFlowResult } from './prototypes';
import { buildLifecycleDummyMain, buildLifecycleStructuredDummyMain } from './lifecycleDummyMain';
import { LifecycleModeler } from './lifecycleModeler';
import { buildCallGraph } from './callGraphBuilder';
import * as path from 'path';
import * as fs from 'fs';

export interface HapflowOptions {
    noPta?: boolean;      // Skip pointer analysis (faster but less precise)
    noLifecycle?: boolean; // Skip lifecycle state machine (use flat DummyMain)
    lifecycleLevel?: 1 | 2; // Lifecycle DummyMain level: 1 = ordered entry, 2 = structured CFG (default: 2)
    sdkPath?: string;     // OpenHarmony SDK path (required for API signature resolution)

    // IFDS budget options
    ifdsBatchSize?: number;      // Default: all sources in one solver run
    ifdsMaxEdges?: number;       // Default: 10000000
    ifdsMaxWorklist?: number;    // Default: 2000000
    ifdsTimeoutMs?: number;      // Default: 900000 (15 minutes)

    // Callback analysis options
    callbackAnalysis?: boolean;  // Default: true
    callbackMaxMethods?: number;    // Default: 100000
    callbackMaxSources?: number;     // Default: 5000
    callbackMaxStates?: number;      // Default: 10000
    callbackMaxPathLen?: number;     // Default: 100
}

/**
 * Load SDK files into the scene's sdkArkFilesMap for API signature resolution.
 * Uses Scene's private buildSdk method via (scene as any) to avoid the
 * TypeInference stack overflow that occurs when SDK is loaded during
 * the normal Scene build pipeline (buildConfig → inferTypes).
 *
 * This approach loads SDK files AFTER inferTypes has already completed
 * for the project files, so SDK files don't trigger recursive type inference.
 */
function loadSdkIntoScene(scene: Scene, sdkPath: string): number {
    const sdkName = '@ohosSdk';
    try {
        // Use the private buildSdk method directly
        (scene as any).buildSdk(sdkName, sdkPath);
        const count = scene.getSdkArkFiles().length;
        return count;
    } catch (e: any) {
        console.log(`[HAPFLOW][WARN] SDK loading failed: ${e.message || e}`);
        return 0;
    }
}

/**
 * Run HapFlow IFDS taint analysis on a pre-built Scene.
 *
 * The Scene is built normally via buildFromProjectDir (without SDK).
 * SDK files are loaded lazily by this runner for API signature resolution.
 */
export function runHapflowAnalysis(
    scene: Scene,
    opts: HapflowOptions = {}
): TaintFlowResult[] {
    console.log('[HAPFLOW] Starting IFDS taint analysis...');

    // 1. Load SDK files for source/sink resolution
    const sdkPath = opts.sdkPath || process.env.OPENHARMONY_SDK_PATH || 'E:/OpenHarmony_SDK/20/ets';
    if (!fs.existsSync(sdkPath)) {
        console.log(`[HAPFLOW][ERROR] SDK path does not exist: ${sdkPath}`);
        console.log('[HAPFLOW][ERROR] Cannot resolve API signatures without SDK. Aborting taint analysis.');
        return [];
    }

    const existingSdkFiles = scene.getSdkArkFiles().length;
    if (existingSdkFiles === 0) {
        console.log(`[HAPFLOW] Loading SDK files from: ${sdkPath}`);
        const sdkCount = loadSdkIntoScene(scene, sdkPath);
        console.log(`[HAPFLOW] SDK files loaded: ${sdkCount}`);
        if (sdkCount === 0) {
            console.log('[HAPFLOW][WARN] No SDK files loaded! Source/sink resolution will fail.');
            return [];
        }
    } else {
        console.log(`[HAPFLOW] SDK files already loaded: ${existingSdkFiles}`);
    }

    // 1b. Infer types — HapFlow original calls scene.inferTypes() before analysis.
    // This is critical for source detection: callSource() uses baseTypeName for fuzzy matching,
    // and without inferTypes(), types remain "unknown" causing source matching to fail.
    try {
        console.log('[HAPFLOW] Running type inference...');
        scene.inferTypes();
        console.log('[HAPFLOW] Type inference complete.');
    } catch (e: any) {
        console.log(`[HAPFLOW][WARN] Type inference failed (stack overflow in UnionType.flatType): ${e.message?.substring(0, 100)}`);
        console.log('[HAPFLOW][WARN] Continuing without type inference — source detection may be less precise.');
    }

    // 2. Build DummyMain (lifecycle-aware or flat)
    let entry: ArkMethod;
    const lifecycleLevel = opts.lifecycleLevel ?? 2; // Default to Level 2 (structured CFG)

    if (opts.noLifecycle) {
        // Flat DummyMain: use standard DummyMainCreater without lifecycle ordering
        console.log('[HAPFLOW] Building flat DummyMain (no lifecycle state machine)...');
        const lifecycleModeler = new LifecycleModeler(scene);
        const lifecycleModel = lifecycleModeler.buildModel();
        const { dummyMain } = buildLifecycleDummyMain(scene, lifecycleModel);
        entry = dummyMain;
        console.log('[HAPFLOW] Flat DummyMain created (Level 1 without ordering).');
    } else if (lifecycleLevel === 2) {
        // Level 2: Lifecycle-structured CFG with sequential startup chain
        console.log('[HAPFLOW] Building lifecycle-structured DummyMain (Level 2)...');
        const lifecycleModeler = new LifecycleModeler(scene);
        const lifecycleModel = lifecycleModeler.buildModel();
        const { dummyMain, stats } = buildLifecycleStructuredDummyMain(scene, lifecycleModel);
        entry = dummyMain;
        console.log(`[HAPFLOW] Level 2 DummyMain created: ${stats.totalBlocks} blocks, ${stats.crossPhaseEdges} cross-phase edges.`);
    } else {
        // Level 1: Pre-ordered entry methods in standard DummyMainCreater
        console.log('[HAPFLOW] Building lifecycle-ordered DummyMain (Level 1)...');
        const lifecycleModeler = new LifecycleModeler(scene);
        const lifecycleModel = lifecycleModeler.buildModel();
        const { dummyMain } = buildLifecycleDummyMain(scene, lifecycleModel);
        entry = dummyMain;
        console.log('[HAPFLOW] Level 1 DummyMain created.');
    }

    // 3. Optional pointer analysis for alias resolution
    let pta: PointerAnalysis | undefined = undefined;
    if (!opts.noPta) {
        try {
            console.log('[HAPFLOW] Running pointer analysis...');
            let ptaConfig = PointerAnalysisConfig.create(2, './out');
            pta = PointerAnalysis.pointerAnalysisForWholeProject(scene, ptaConfig);
            console.log('[HAPFLOW] Pointer analysis complete.');
        } catch (e) {
            console.log(`[HAPFLOW][WARN] Pointer analysis failed, continuing without: ${e}`);
        }
    } else {
        console.log('[HAPFLOW] Pointer analysis skipped (--no-pta).');
    }

    // 3b. Build call graph for IFDS (lifecycle-enhanced or basic)
    let externalCG: ClassHierarchyAnalysis | undefined = undefined;
    try {
        if (opts.noLifecycle) {
            // Basic CG without lifecycle augmentation
            console.log('[HAPFLOW] Building basic call graph (no lifecycle edges)...');
            const callGraph = buildCallGraph(scene, { noLifecycle: true });
            const cgBuilder = new CallGraphBuilder(callGraph, scene);
            externalCG = new ClassHierarchyAnalysis(scene, callGraph, cgBuilder);
            externalCG.start(true);
            console.log('[HAPFLOW] Basic CG ready (nodes=' + callGraph.getNodeNum() + ').');
        } else {
            console.log('[HAPFLOW] Building lifecycle-enhanced call graph...');
            const callGraph = buildCallGraph(scene);
            const cgBuilder = new CallGraphBuilder(callGraph, scene);
            externalCG = new ClassHierarchyAnalysis(scene, callGraph, cgBuilder);
            externalCG.start(true);
            console.log('[HAPFLOW] Lifecycle-enhanced CG ready (nodes=' + callGraph.getNodeNum() + ').');
        }
    } catch (e) {
        console.log(`[HAPFLOW][WARN] CG construction failed, solver will build default CHA CG: ${e}`);
        externalCG = undefined;
    }

    // 4. Configure taint analysis problem
    const cfg = entry.getCfg();
    if (!cfg) {
        console.log('[HAPFLOW][ERROR] DummyMain has no CFG, cannot run taint analysis.');
        return [];
    }
    const blocks = [...cfg.getBlocks()];
    if (blocks.length === 0) {
        console.log('[HAPFLOW][ERROR] DummyMain CFG has no blocks.');
        return [];
    }
    const stmts = blocks[0].getStmts();
    const paramCount = entry.getParameters().length;
    // Use the first stmt after parameter assignments, or fallback to first stmt
    const entryStmt = paramCount < stmts.length ? stmts[paramCount] : stmts[0];
    if (!entryStmt) {
        console.log('[HAPFLOW][ERROR] Could not determine entry statement.');
        return [];
    }
    console.log(`[HAPFLOW] Entry stmt selected (block 0, index ${Math.min(paramCount, stmts.length - 1)}).`);

    const problem = new TaintAnalysisChecker(entryStmt, entry, pta);

    // Load source/sink definitions
    const configDir = path.resolve(__dirname, '..', 'config');
    const sourcesPath = path.join(configDir, 'hapflow_sources.json');
    const sinksPath = path.join(configDir, 'hapflow_sinks.json');

    console.log('[HAPFLOW] Loading source/sink definitions...');
    problem.addSourcesFromJson(sourcesPath, sdkPath);
    problem.addSinksFromJson(sinksPath, sdkPath);
    console.log('[HAPFLOW] Loaded ' + problem.getSources().size + ' sources, ' + problem.getSinks().length + ' sinks.');

    if (problem.getSources().size === 0 && problem.getSinks().length === 0) {
        console.log('[HAPFLOW][WARN] No sources or sinks loaded. SDK API signatures could not be resolved.');
        console.log('[HAPFLOW][WARN] Skipping IFDS analysis as it would produce no results.');
        return [];
    }

    // 5. Execute IFDS analysis. By default all sources are analyzed in one solver
    // run to preserve cross-source/context precision; explicit batching remains
    // available as an OOM fallback.
    const allSources = problem.getSources();
    const totalSources = allSources.size;
    const requestedBatchSize = opts?.ifdsBatchSize;
    const useBatching = requestedBatchSize !== undefined && requestedBatchSize > 0 && requestedBatchSize < totalSources;
    const BATCH_SIZE = useBatching ? requestedBatchSize : totalSources;
    const totalBatches = useBatching ? Math.ceil(totalSources / BATCH_SIZE) : 1;

    console.log(`[HAPFLOW] Solving IFDS taint problem${useBatching ? ' (batched)' : ''}...`);
    console.log(`[HAPFLOW] Input: ${totalSources} sources, ${problem.getSinks().length} sinks`);
    if (useBatching) {
        console.log(`[HAPFLOW] Batch config: size=${BATCH_SIZE}, batches=${totalBatches}`);
    }

    const allOutcomes: TaintFact[] = [];
    const sourceArray = Array.from(allSources.entries());
    let ifdsBudgetExceeded = false;
    let totalIfdsEdges = 0;

    for (let batchStart = 0; batchStart < totalSources; batchStart += BATCH_SIZE) {
        const batchEnd = Math.min(batchStart + BATCH_SIZE, totalSources);
        const batchIndex = Math.floor(batchStart / BATCH_SIZE) + 1;
        const batchStartTime = Date.now();

        if (useBatching) {
            console.log(`[HAPFLOW] Batch ${batchIndex}/${totalBatches} (sources ${batchStart + 1}-${batchEnd})`);
        } else {
            console.log(`[HAPFLOW] Single solver run (sources ${batchStart + 1}-${batchEnd})`);
        }

        // Create a fresh problem for this batch
        const batchProblem = new TaintAnalysisChecker(entryStmt, entry, pta);

        // Load all sinks (same for all batches)
        batchProblem.addSinksFromJson(sinksPath, sdkPath);

        // Load only this batch's sources
        const batchSources = new Map(sourceArray.slice(batchStart, batchEnd));
        for (const [sig, source] of batchSources) {
            batchProblem.getSources().set(sig, source);
        }

        // Solve this batch
        try {
            const batchSolver = new TaintAnalysisSolver(batchProblem, scene, pta, undefined, externalCG);

            // Set budget options for the solver
            batchSolver.setBudgetOptions({
                maxEdges: opts?.ifdsMaxEdges ?? 10000000,
                maxWorkList: opts?.ifdsMaxWorklist ?? 2000000,
                maxMillis: opts?.ifdsTimeoutMs ?? 900000
            });

            batchSolver.solve();

            // Collect results
            const batchOutcomes = batchProblem.getOutcome();
            allOutcomes.push(...batchOutcomes);

            // Check if budget was exceeded
            const batchStats = batchSolver.getStats();
            if (batchStats?.budgetExceeded) {
                ifdsBudgetExceeded = true;
            }
            totalIfdsEdges += batchStats?.edgesProcessed ?? 0;

            const elapsed = Date.now() - batchStartTime;
            console.log(`[HAPFLOW]   flows=${batchOutcomes.length}, edges=${batchStats?.edgesProcessed ?? 0}, elapsed=${elapsed}ms${batchStats?.budgetExceeded ? ' [BUDGET_EXCEEDED]' : ''}`);
        } catch (e: any) {
            console.log(`[HAPFLOW]   Solver run failed: ${e.message || e}`);
        }
    }

    console.log(`[HAPFLOW] IFDS complete: flows=${allOutcomes.length}, totalEdges=${totalIfdsEdges}${ifdsBudgetExceeded ? ' [PARTIAL]' : ''}`);

    // 5b. Execute direct callback data flow analysis. Enabled by default because
    // ArkTS privacy data often crosses callback and Promise boundaries that IFDS
    // alone may not recover in incomplete sample projects.
    const callbackEnabled = opts?.callbackAnalysis ?? true;
    console.log(`[HAPFLOW] Callback analysis: ${callbackEnabled ? 'ENABLED' : 'DISABLED'}`);

    if (callbackEnabled) {
        problem.setCallbackBudgetOptions({
            maxMethods: opts?.callbackMaxMethods ?? 100000,
            maxSources: opts?.callbackMaxSources ?? 5000,
            maxStates: opts?.callbackMaxStates ?? 10000,
            maxPathLen: opts?.callbackMaxPathLen ?? 100
        });
        problem.analyzeCallbackDataFlows();
        const callbackOutcomes = problem.getOutcome();
        allOutcomes.push(...callbackOutcomes);
    }

    // 6. Convert and return results
    const finalStatus = ifdsBudgetExceeded ? 'PARTIAL_SUCCESS' : 'SUCCESS';
    console.log(`[HAPFLOW] Analysis complete. Found ${allOutcomes.length} taint flows. Status: ${finalStatus}`);

    return convertOutcome(allOutcomes);
}

/**
 * Convert HapFlow TaintFact[] output to ArkPrism TaintFlowResult[] format.
 * Deduplicates by (source method, sink method) pair — same as HapBench semantics:
 * one source→sink channel counts as one flow, regardless of how many fields/params propagate.
 */
function convertOutcome(facts: TaintFact[]): TaintFlowResult[] {
    const seen = new Set<string>();
    const results: TaintFlowResult[] = [];

    for (const fact of facts) {
        const pathStmts = fact.getPath();
        const sourceStmt = pathStmts.length > 0 ? pathStmts[0] : null;
        const sinkStmt = pathStmts.length > 0 ? pathStmts[pathStmts.length - 1] : null;

        // Dedup key: source method + sink method (the channel, not individual fields)
        const sourceMethod = sourceStmt?.getCfg()?.getDeclaringMethod()?.getSignature()?.toString() || '';
        const sinkMethod = sinkStmt?.getCfg()?.getDeclaringMethod()?.getSignature()?.toString() || '';
        const sourceApiNorm = normalizeApiName(sourceStmt?.toString() || '');
        const sinkApiNorm = normalizeApiName(sinkStmt?.toString() || '');
        const dedupKey = `${sourceMethod}::${sourceApiNorm}→${sinkMethod}::${sinkApiNorm}`;

        if (seen.has(dedupKey)) continue;
        seen.add(dedupKey);

        results.push({
            sourceApi: sourceStmt?.toString() || 'unknown',
            sourceFile: sourceStmt?.getOriginPositionInfo()?.toString() || 'unknown',
            sourceLine: sourceStmt?.getOriginPositionInfo()?.getLineNo() || 0,
            sinkApi: sinkStmt?.toString() || 'unknown',
            sinkFile: sinkStmt?.getOriginPositionInfo()?.toString() || 'unknown',
            sinkLine: sinkStmt?.getOriginPositionInfo()?.getLineNo() || 0,
            taintedValue: fact.getValue()?.toString() || 'unknown',
            path: pathStmts.map(s => ({
                statement: s.toString(),
                file: s.getOriginPositionInfo()?.toString() || '',
                line: s.getOriginPositionInfo()?.getLineNo() || 0,
                method: s.getCfg()?.getDeclaringMethod()?.getName() || ''
            }))
        });
    }
    return results;
}

/**
 * Normalize API name for dedup: strip %AM* anonymous method refs and %N parameter refs.
 * e.g. "sensor.on(%1, %AM0$sensor, %2)" → "sensor.on"
 *      "console.info(%7)" → "console.info"
 */
function normalizeApiName(apiStr: string): string {
    return apiStr
        .replace(/\(%[^)]*\)/, '')   // strip (...%AM0...%2...) parens
        .replace(/%AM\d+\$\w+/g, '') // strip %AM0$name refs
        .replace(/%\d+/g, '')        // strip %1, %2 etc
        .trim();
}
