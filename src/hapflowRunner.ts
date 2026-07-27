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

import { Scene, PointerAnalysis, PointerAnalysisConfig } from './arkanalyzer';
import { TaintAnalysisChecker } from './hapflow/TaintAnalysis';
import { TaintAnalysisSolver } from './hapflow/TaintAnalysisSolver';
import { TaintFact } from './hapflow/TaintFact';
import { TaintAnalysisMetadata, TaintFlowResult } from './prototypes';
import { buildLifecycleDummyMain } from './lifecycleDummyMain';
import { LifecycleModeler } from './lifecycleModeler';
import * as path from 'path';
import * as fs from 'fs';

export interface HapflowOptions {
    noPta?: boolean;      // Skip pointer analysis (faster but less precise)
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

export interface HapflowAnalysisResult {
    flows: TaintFlowResult[];
    metadata: TaintAnalysisMetadata;
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
): HapflowAnalysisResult {
    console.log('[HAPFLOW] Starting IFDS taint analysis...');

    // 1. Load SDK files for source/sink resolution
    const sdkPath = opts.sdkPath || process.env.OPENHARMONY_SDK_PATH || 'E:/OpenHarmony_SDK/20/ets';
    if (!fs.existsSync(sdkPath)) {
        throw new Error(`SDK path does not exist: ${sdkPath}`);
    }

    const existingSdkFiles = scene.getSdkArkFiles().length;
    if (existingSdkFiles === 0) {
        console.log(`[HAPFLOW] Loading SDK files from: ${sdkPath}`);
        const sdkCount = loadSdkIntoScene(scene, sdkPath);
        console.log(`[HAPFLOW] SDK files loaded: ${sdkCount}`);
        if (sdkCount === 0) {
            throw new Error(`No SDK files could be loaded from: ${sdkPath}`);
        }
    } else {
        console.log(`[HAPFLOW] SDK files already loaded: ${existingSdkFiles}`);
    }

    // 2. Build lifecycle-aware DummyMain (virtual entry method with lifecycle state machine)
    const lifecycleModeler = new LifecycleModeler(scene);
    const lifecycleModel = lifecycleModeler.buildModel();
    const { dummyMain: entry, modeler: creater } = buildLifecycleDummyMain(scene, lifecycleModel);
    console.log('[HAPFLOW] Lifecycle-aware DummyMain created.');

    // 3. Optional pointer analysis for alias resolution
    let pta: PointerAnalysis | undefined = undefined;
    let rejectedContainerFieldEdges = 0;
    if (!opts.noPta) {
        try {
            console.log('[HAPFLOW] Running pointer analysis...');
            let ptaConfig = PointerAnalysisConfig.create(2, './out');
            pta = PointerAnalysis.pointerAnalysisForWholeProject(scene, ptaConfig);
            rejectedContainerFieldEdges = pta.getRejectedContainerFieldEdges();
            console.log(`[HAPFLOW] Pointer analysis complete. Rejected invalid container-field edges: ${rejectedContainerFieldEdges}`);
        } catch (e: any) {
            const message = e?.message || String(e);
            throw new Error(`Pointer analysis failed: ${message}`);
        }
    } else {
        console.log('[HAPFLOW] Pointer analysis skipped (--no-pta).');
    }

    // 4. Configure taint analysis problem
    const cfg = entry.getCfg();
    if (!cfg) {
        throw new Error('DummyMain has no CFG; IFDS analysis cannot run');
    }
    const blocks = [...cfg.getBlocks()];
    if (blocks.length === 0) {
        throw new Error('DummyMain CFG has no blocks; IFDS analysis cannot run');
    }
    const stmts = blocks[0].getStmts();
    const paramCount = entry.getParameters().length;
    // Use the first stmt after parameter assignments, or fallback to first stmt
    const entryStmt = paramCount < stmts.length ? stmts[paramCount] : stmts[0];
    if (!entryStmt) {
        throw new Error('DummyMain entry statement could not be determined');
    }
    console.log(`[HAPFLOW] Entry stmt selected (block 0, index ${Math.min(paramCount, stmts.length - 1)}).`);

    const problem = new TaintAnalysisChecker(entryStmt, entry, pta);

    // Load source/sink definitions
    const configDir = path.resolve(__dirname, '..', 'config');
    const sourcesPath = path.join(configDir, 'hapflow_sources.json');
    const lifecycleSourcesPath = path.join(configDir, 'lifecycle_sources.json');
    const sinksPath = path.join(configDir, 'hapflow_sinks.json');

    console.log('[HAPFLOW] Loading source/sink definitions...');
    problem.addSourcesFromJson(sourcesPath, sdkPath);
    problem.addSourcesFromJson(lifecycleSourcesPath, sdkPath);
    problem.addSinksFromJson(sinksPath, sdkPath);
    console.log('[HAPFLOW] Loaded ' + problem.getSources().size + ' sources, ' + problem.getSinks().length + ' sinks.');

    if (problem.getSources().size === 0 && problem.getSinks().length === 0) {
        throw new Error('No IFDS sources or sinks resolved from the configured SDK');
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

    const ifdsOutcomes: TaintFact[] = [];
    const sourceArray = Array.from(allSources.entries());
    let ifdsBudgetExceeded = false;
    let totalIfdsEdges = 0;
    let totalMalformedCfgEdges = 0;
    const ifdsFailures: string[] = [];

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
            const batchSolver = new TaintAnalysisSolver(batchProblem, scene, pta);

            // Set budget options for the solver
            batchSolver.setBudgetOptions({
                maxEdges: opts?.ifdsMaxEdges ?? 10000000,
                maxWorkList: opts?.ifdsMaxWorklist ?? 2000000,
                maxMillis: opts?.ifdsTimeoutMs ?? 900000
            });

            batchSolver.solve();

            // Collect results
            const batchOutcomes = batchProblem.getOutcome();
            ifdsOutcomes.push(...batchOutcomes);

            // Check if budget was exceeded
            const batchStats = batchSolver.getStats();
            if (batchStats?.budgetExceeded) {
                ifdsBudgetExceeded = true;
            }
            totalIfdsEdges += batchStats?.edgesProcessed ?? 0;
            totalMalformedCfgEdges += batchStats?.malformedCfgEdges ?? 0;

            const elapsed = Date.now() - batchStartTime;
            console.log(`[HAPFLOW]   flows=${batchOutcomes.length}, edges=${batchStats?.edgesProcessed ?? 0}, elapsed=${elapsed}ms${batchStats?.budgetExceeded ? ' [BUDGET_EXCEEDED]' : ''}`);
        } catch (e: any) {
            const message = e?.message || String(e);
            ifdsFailures.push(`solver run ${batchIndex}/${totalBatches}: ${message}`);
            console.log(`[HAPFLOW]   Solver run failed: ${message}`);
            if (e?.stack) {
                console.log(e.stack);
            }
        }
    }

    if (ifdsFailures.length > 0) {
        throw new Error(`IFDS analysis failed: ${ifdsFailures.join('; ')}`);
    }

    console.log(`[HAPFLOW] IFDS complete: flows=${ifdsOutcomes.length}, totalEdges=${totalIfdsEdges}${ifdsBudgetExceeded ? ' [PARTIAL]' : ''}`);

    // 5b. Execute direct callback data flow analysis. Enabled by default because
    // ArkTS privacy data often crosses callback and Promise boundaries that IFDS
    // alone may not recover in incomplete sample projects.
    const callbackEnabled = opts?.callbackAnalysis ?? true;
    console.log(`[HAPFLOW] Callback analysis: ${callbackEnabled ? 'ENABLED' : 'DISABLED'}`);

    let callbackOutcomes: TaintFact[] = [];
    if (callbackEnabled) {
        problem.setCallbackBudgetOptions({
            maxMethods: opts?.callbackMaxMethods ?? 100000,
            maxSources: opts?.callbackMaxSources ?? 5000,
            maxStates: opts?.callbackMaxStates ?? 10000,
            maxPathLen: opts?.callbackMaxPathLen ?? 100
        });
        problem.analyzeCallbackDataFlows();
        callbackOutcomes = problem.getOutcome();
    }

    // 6. Convert and deduplicate results across the IFDS and callback engines.
    const finalStatus = ifdsBudgetExceeded ? 'PARTIAL_SUCCESS' : (callbackEnabled ? 'SUCCESS' : 'SUCCESS');
    const converted = [
        ...convertOutcome(ifdsOutcomes, 'ifds'),
        ...convertOutcome(callbackOutcomes, 'async_supplement')
    ];
    const uniqueFlows = deduplicateTaintFlows(converted);
    const duplicateCount = converted.length - uniqueFlows.length;
    if (duplicateCount > 0) {
        console.log(`[HAPFLOW] Removed ${duplicateCount} duplicate flow(s) produced by overlapping engines.`);
    }
    console.log(`[HAPFLOW] Analysis complete. Found ${uniqueFlows.length} unique taint flows. Status: ${finalStatus}`);

    return {
        flows: uniqueFlows,
        metadata: {
            status: finalStatus,
            pointerAnalysis: {
                requested: !opts.noPta,
                status: opts.noPta ? 'SKIPPED' : 'SUCCESS',
                rejectedContainerFieldEdges
            },
            ifds: {
                sources: totalSources,
                sinks: problem.getSinks().length,
                rawFlows: ifdsOutcomes.length,
                edgesProcessed: totalIfdsEdges,
                malformedCfgEdges: totalMalformedCfgEdges,
                budgetExceeded: ifdsBudgetExceeded,
                batching: useBatching,
                batches: totalBatches
            },
            callback: {
                enabled: callbackEnabled,
                rawFlows: callbackOutcomes.length
            },
            flowsBeforeDeduplication: converted.length,
            uniqueFlows: uniqueFlows.length,
            duplicatesRemoved: duplicateCount
        }
    };
}

/**
 * Convert HapFlow TaintFact[] output to ArkPrism TaintFlowResult[] format.
 */
export function convertOutcome(
    facts: TaintFact[],
    provenance: TaintFlowResult["provenance"]
): TaintFlowResult[] {
    const statementFile = (stmt: any): string => {
        const filePath = stmt
            ?.getCfg?.()
            ?.getDeclaringMethod?.()
            ?.getDeclaringArkFile?.()
            ?.getFilePath?.();
        if (typeof filePath === 'string' && filePath.length > 0) return filePath;

        // Synthetic DummyMain statements have no declaring ArkFile. Preserve
        // the invoked application's project-relative file from its signature.
        const invokedFile = stmt
            ?.getInvokeExpr?.()
            ?.getMethodSignature?.()
            ?.getDeclaringClassSignature?.()
            ?.getDeclaringFileSignature?.()
            ?.getFileName?.();
        return typeof invokedFile === 'string'
            && invokedFile.length > 0
            && invokedFile !== '%unk'
            ? invokedFile
            : 'unknown';
    };

    return facts.map(fact => {
        const sourceEvidence = fact.getSourceEvidence();
        if (!sourceEvidence) {
            const pathPreview = fact.getPath()
                .map(stmt => `${stmt.getCfg()?.getDeclaringMethod()?.getName() || 'unknown'}:${stmt.toString()}`)
                .join(' -> ');
            throw new Error(
                `Taint outcome lacks source evidence: provenance=${provenance}, `
                + `value=${fact.getValue()?.toString() || 'unknown'}, path=${pathPreview || '(empty)'}`
            );
        }

        const originalPath = fact.getPath();
        const sourceStmt = sourceEvidence.statement;
        const sourceIndex = originalPath.indexOf(sourceStmt);
        const pathStmts = sourceIndex >= 0
            ? originalPath.slice(sourceIndex)
            : [sourceStmt, ...originalPath];
        const sinkStmt = pathStmts.length > 0 ? pathStmts[pathStmts.length - 1] : null;
        const rule = sourceEvidence.rule;

        return {
            provenance,
            sourceKind: sourceEvidence.sourceKind,
            sourceIdentity: {
                module: rule.module || '',
                namespace: rule.namespace || '',
                className: rule.className || '',
                apiName: rule.apiName || '',
                sourceType: sourceEvidence.sourceType,
                sourceIndex: sourceEvidence.sourceIndex,
                callbackIndex: sourceEvidence.callbackIndex,
                methodSignature: sourceEvidence.methodSignature,
                ruleOrigin: rule.ruleOrigin || ''
            },
            sourceApi: sourceStmt?.toString() || 'unknown',
            sourceFile: statementFile(sourceStmt),
            sourceLine: sourceStmt?.getOriginPositionInfo()?.getLineNo() || 0,
            sinkApi: sinkStmt?.toString() || 'unknown',
            sinkFile: statementFile(sinkStmt),
            sinkLine: sinkStmt?.getOriginPositionInfo()?.getLineNo() || 0,
            taintedValue: fact.getValue()?.toString() || 'unknown',
            path: pathStmts.map(s => ({
                statement: s.toString(),
                file: statementFile(s),
                line: s.getOriginPositionInfo()?.getLineNo() || 0,
                method: s.getCfg()?.getDeclaringMethod()?.getName() || ''
            }))
        };
    });
}

export function deduplicateTaintFlows(flows: TaintFlowResult[]): TaintFlowResult[] {
    const seen = new Map<string, number>();
    const unique: TaintFlowResult[] = [];
    for (const flow of flows) {
        const key = JSON.stringify([
            flow.sourceApi,
            flow.sourceKind,
            flow.sourceIdentity,
            flow.sourceFile,
            flow.sourceLine,
            flow.sinkApi,
            flow.sinkFile,
            flow.sinkLine,
            flow.taintedValue,
            flow.path.map(step => [
                step.statement,
                step.file,
                step.line,
                step.method
            ])
        ]);
        const existingIndex = seen.get(key);
        if (existingIndex !== undefined) {
            const existing = unique[existingIndex];
            const existingProvenance = existing.provenance;
            const nextProvenance = flow.provenance;
            if (existingProvenance !== nextProvenance) {
                existing.provenance = 'both';
            }
            continue;
        }
        seen.set(key, unique.length);
        unique.push(flow);
    }
    return unique;
}
