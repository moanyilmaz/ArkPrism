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

import { Scene, DummyMainCreater, PointerAnalysis, PointerAnalysisConfig } from './arkanalyzer';
import { TaintAnalysisChecker } from './hapflow/TaintAnalysis';
import { TaintAnalysisSolver } from './hapflow/TaintAnalysisSolver';
import { TaintFact } from './hapflow/TaintFact';
import { TaintFlowResult, TaintPathStep } from './prototypes';
import * as path from 'path';
import * as fs from 'fs';

export interface HapflowOptions {
    noPta?: boolean;      // Skip pointer analysis (faster but less precise)
    sdkPath?: string;     // OpenHarmony SDK path (required for API signature resolution)
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
    const sdkPath = opts.sdkPath || 'D:/DevEco Studio/sdk/default/openharmony/ets';
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

    // 2. Build DummyMain (virtual entry method collecting all entry points)
    const creater = new DummyMainCreater(scene);
    creater.createDummyMain();
    const entry = creater.getDummyMain();
    console.log('[HAPFLOW] DummyMain created.');

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
    problem.addSourcesFromJson(sourcesPath);
    problem.addSinksFromJson(sinksPath);
    console.log('[HAPFLOW] Loaded ' + problem.getSources().size + ' sources, ' + problem.getSinks().length + ' sinks.');

    if (problem.getSources().size === 0 && problem.getSinks().length === 0) {
        console.log('[HAPFLOW][WARN] No sources or sinks loaded. SDK API signatures could not be resolved.');
        console.log('[HAPFLOW][WARN] Skipping IFDS analysis as it would produce no results.');
        return [];
    }

    // 5. Execute IFDS analysis (batched to reduce memory pressure)
    console.log('[HAPFLOW] Solving IFDS taint problem (batched)...');

    const BATCH_SIZE = 50;  // Process 50 sources at a time
    const allSources = problem.getSources();
    const totalSources = allSources.size;
    const allOutcomes: TaintFact[] = [];

    const sourceArray = Array.from(allSources.entries());

    for (let batchStart = 0; batchStart < totalSources; batchStart += BATCH_SIZE) {
        const batchEnd = Math.min(batchStart + BATCH_SIZE, totalSources);
        console.log(`[HAPFLOW] Processing batch ${Math.floor(batchStart / BATCH_SIZE) + 1}/${Math.ceil(totalSources / BATCH_SIZE)} (sources ${batchStart + 1}-${batchEnd} of ${totalSources})`);

        // Create a fresh problem for this batch
        const batchProblem = new TaintAnalysisChecker(entryStmt, entry, pta);

        // Load all sinks (same for all batches)
        batchProblem.addSinksFromJson(sinksPath);

        // Load only this batch's sources
        const batchSources = new Map(sourceArray.slice(batchStart, batchEnd));
        for (const [sig, source] of batchSources) {
            batchProblem.getSources().set(sig, source);
        }

        // Solve this batch
        try {
            const batchSolver = new TaintAnalysisSolver(batchProblem, scene, pta);
            batchSolver.solve();

            // Collect results
            const batchOutcomes = batchProblem.getOutcome();
            allOutcomes.push(...batchOutcomes);
            console.log(`[HAPFLOW]   Batch found ${batchOutcomes.length} flows`);
        } catch (e: any) {
            console.log(`[HAPFLOW]   Batch failed: ${e.message || e}`);
        }
    }

    console.log(`[HAPFLOW] Total flows found: ${allOutcomes.length}`);

    // 5b. Execute direct callback data flow analysis
    // This catches callback-based SDK calls that IFDS might miss
    console.log('[HAPFLOW] Running direct callback analysis...');
    problem.analyzeCallbackDataFlows();

    // Add callback results to outcomes
    const callbackOutcomes = problem.getOutcome();
    allOutcomes.push(...callbackOutcomes);

    // 6. Convert and return results
    console.log(`[HAPFLOW] Analysis complete. Found ${allOutcomes.length} taint flows.`);

    return convertOutcome(allOutcomes);
}

/**
 * Convert HapFlow TaintFact[] output to ArkPrism TaintFlowResult[] format.
 */
function convertOutcome(facts: TaintFact[]): TaintFlowResult[] {
    return facts.map(fact => {
        const pathStmts = fact.getPath();
        const sourceStmt = pathStmts.length > 0 ? pathStmts[0] : null;
        const sinkStmt = pathStmts.length > 0 ? pathStmts[pathStmts.length - 1] : null;

        return {
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
        };
    });
}
