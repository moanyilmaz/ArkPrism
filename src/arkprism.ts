/**
 * ArkPrism - Unified CLI Entry Point
 * ArkTS Privacy-sensitive API Recognition and Information-flow Subgraph Mapping
 *
 * Usage:
 *   npx ts-node src/arkprism.ts <project_dir>              # Analyze a single project
 *   npx ts-node src/arkprism.ts --batch <dataset_dir>       # Batch analyze all projects
 *
 * Options:
 *   --output-dir <dir>    Output directory (default: ./out)
 *   --no-dot              Skip DOT file generation
 *   --dot-only            Only generate DOT from existing JSON report
 */

import { Scene, SceneConfig } from './arkanalyzer';
import {
    getSceneFromJson, readPrivacyApis, readSystemPackages,
    writeJsonOutput, getTimestamp
} from './utils';
import { analyzeFileForPrivacyApis } from './apiDetector';
import { buildCallGraph } from './callGraphBuilder';
import { traceCallChains, enrichCallChainsWithSemanticContext } from './callChainTracer';
import { detectMultiSourceCollaborations } from './multiSourceAnalyzer';
import { analyzeDataSinks } from './dataSinkAnalyzer';
import { analyzePermissions } from './permissionAnalyzer';
import { generateDot } from './dotExporter';
import {
    ArkPrismOutput, PrivacyDataApiResult, TaintAnalysisMetadata,
    TaintFlowResult, DataFlowStats, RecursivePatternStats
} from './prototypes';
import { runHapflowAnalysis, HapflowOptions } from './hapflowRunner';
import { linkTaintFlowsToPrivacyUsages } from './evidenceLinker';
import { analyzeViewTrees } from './viewTreeAnalyzer';
import { analyzeDataFlow, getDataFlowStats } from './dataFlowAnalyzer';
import { detectRecursivePatterns, getRecursiveStats } from './recursiveDetector';
import { readFileSync, readdirSync, statSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import * as path from 'path';
import { resolveAnalysisPath, toDisplayPath, toFileSystemPath } from './pathUtils';

const DEFAULT_SDK_PATH = process.env.OPENHARMONY_SDK_PATH || 'E:/OpenHarmony_SDK/20/ets';
const SOURCE_EXTENSIONS = new Set(['.ets', '.ts']);
const SOURCE_SKIP_DIRS = new Set([
    'build',
    'cache',
    'node_modules',
    'oh_modules',
    '.preview',
    '.git',
    'hvigor',
    '.hvigor',
    'resources',
    'rawfile',
    'archive_files',
]);

function discoverSourceFiles(rootDir: string): string[] {
    let files: string[] = [];
    if (!existsSync(rootDir)) return files;

    for (const entry of readdirSync(rootDir, { withFileTypes: true })) {
        let fullPath = path.join(rootDir, entry.name);
        if (entry.isDirectory()) {
            if (!SOURCE_SKIP_DIRS.has(entry.name)) {
                files = files.concat(discoverSourceFiles(fullPath));
            }
        } else if (entry.isFile() && SOURCE_EXTENSIONS.has(path.extname(entry.name))) {
            files.push(fullPath);
        }
    }

    return files;
}

// ---- Core analysis pipeline (shared by single & batch) ----

interface AnalysisOptions {
    outputDir: string;
    noDot: boolean;
    noTaint: boolean;
    noPta: boolean;
    sdkPath: string;
    // IFDS options
    ifdsBatchSize?: number;
    ifdsMaxEdges?: number;
    ifdsMaxWorklist?: number;
    ifdsTimeoutMs?: number;
    // Callback analysis options
    callbackAnalysis?: boolean;
    callbackMaxMethods?: number;
    callbackMaxSources?: number;
    callbackMaxStates?: number;
    callbackMaxPathLen?: number;
}

function analyzeProject(
    projectDir: string,
    projectName: string,
    opts: AnalysisOptions,
    reportProjectDir: string = toDisplayPath(projectDir)
): ArkPrismOutput {
    console.log(`[SCENE] Building ArkAnalyzer Scene for ${projectName}...`);
    let sceneConfig = new SceneConfig();
    sceneConfig.buildFromProjectDir(projectDir);
    let scene = getSceneFromJson(sceneConfig);
    let allFiles = scene.getFiles();
    if (allFiles.length === 0) {
        const sourceFiles = discoverSourceFiles(projectDir);
        if (sourceFiles.length > 0) {
            console.log(`[SCENE] Standard project discovery found 0 files; retrying with ${sourceFiles.length} source files.`);
            sceneConfig = new SceneConfig();
            sceneConfig.buildFromProjectFiles(projectName, projectDir, sourceFiles);
            scene = new Scene();
            scene.buildBasicInfo(sceneConfig);
            (scene as any).genArkFiles();
            scene.inferTypes();
            allFiles = scene.getFiles();
        }
    }
    console.log(`[SCENE] Scene built. Files: ${allFiles.length}`);

    // Analyze ViewTrees for UI callback patterns and state usage
    let viewTreeResult = analyzeViewTrees(scene);
    if (viewTreeResult.componentClasses.length > 0) {
        console.log(`[VIEW-TREE] ${viewTreeResult.componentClasses.length} components, `
            + `${viewTreeResult.callbackBindings.length} callbacks, `
            + `${viewTreeResult.stateToUIFlows.length} state flows.`);
    }

    // Read rules - use sensitive_apis.json for unified privacy API definitions
    let privacyApisPath = path.resolve(__dirname, '..', 'config', 'sensitive_apis.json');
    let systemPackagesPath = path.resolve(__dirname, '..', 'config', 'system_packages14.json');
    let privacyApis = readPrivacyApis(privacyApisPath);
    let systemPackages = Array.from(new Set([
        ...readSystemPackages(systemPackagesPath),
        ...privacyApis.map(pkg => pkg.systemPackage),
    ]));

    // Detect APIs
    let allApiResults: PrivacyDataApiResult[] = [];
    let filesAnalyzed = 0;
    let methodsAnalyzed = 0;

    for (let file of allFiles) {
        let fileName = file.getName();
        if (fileName.includes("build") || fileName.includes("cache") ||
            fileName.includes("node_modules") || fileName.includes("oh_modules") ||
            fileName.includes(".preview")) {
            continue;
        }
        filesAnalyzed++;
        let fileResults = analyzeFileForPrivacyApis(file, systemPackages, privacyApis);
        allApiResults = allApiResults.concat(fileResults);
        for (let cls of file.getClasses()) {
            methodsAnalyzed += cls.getMethods().length;
        }
    }

    console.log(`[API-DETECT] ${filesAnalyzed} files, ${methodsAnalyzed} methods, ${allApiResults.length} APIs found.`);
    if (allApiResults.length > 0) {
        let categoryCounts = new Map<string, number>();
        for (let r of allApiResults) {
            let cat = r.profilingCategory || r.category;
            categoryCounts.set(cat, (categoryCounts.get(cat) || 0) + 1);
        }
        let cats = Array.from(categoryCounts.entries()).map(([k, v]) => `${k}(${v})`).join(', ');
        console.log(`[API-DETECT] Categories: ${cats}`);
    }

    // Call graph + chains + sinks
    let callChainResults: any[] = [];
    let multiSourceResults: any[] = [];
    if (allApiResults.length > 0) {
        try {
            let callGraph = buildCallGraph(scene);
            callChainResults = traceCallChains(allApiResults, scene, callGraph, projectDir);
            analyzeDataSinks(allApiResults, callChainResults, scene);
            enrichCallChainsWithSemanticContext(callChainResults, allApiResults);
            multiSourceResults = detectMultiSourceCollaborations(allApiResults, scene, callGraph, callChainResults);
        } catch (e) {
            console.log(`[WARN] Call graph failed: ${e}`);
        }
    }

    // Data Flow Analysis using built-in Cfg Def-Use chains (always runs)
    let dfStats: DataFlowStats | undefined;
    try {
        dfStats = getDataFlowStats(scene);
        if (dfStats.methodsWithUnreachableBlocks > 0) {
            console.log(`[DATA-FLOW] ${dfStats.methodsWithUnreachableBlocks} methods with unreachable blocks, `
                + `${dfStats.totalUnreachableBlocks} blocks total.`);
        }
    } catch (e) {
        console.log(`[WARN] Data flow analysis failed: ${e}`);
    }

    // Recursive/Loop Pattern Detection
    let recursiveStats: RecursivePatternStats | undefined;
    try {
        recursiveStats = getRecursiveStats(scene);
        if (recursiveStats.methodsWithLoops > 0) {
            let loopTypes = Object.entries(recursiveStats.loopBreakdown)
                .map(([k, v]) => `${k}(${v})`)
                .join(', ');
            console.log(`[RECURSIVE] ${recursiveStats.methodsWithLoops} methods with loops: ${loopTypes}`);
        }
    } catch (e) {
        console.log(`[WARN] Recursive pattern detection failed: ${e}`);
    }

    // HapFlow IFDS Taint Analysis
    let taintFlows: TaintFlowResult[] = [];
    let taintAnalysis: TaintAnalysisMetadata | undefined;
    if (!opts.noTaint) {
        try {
            const taintResult = runHapflowAnalysis(scene, {
                noPta: opts.noPta,
                sdkPath: opts.sdkPath,
                ifdsBatchSize: opts.ifdsBatchSize,
                ifdsMaxEdges: opts.ifdsMaxEdges,
                ifdsMaxWorklist: opts.ifdsMaxWorklist,
                ifdsTimeoutMs: opts.ifdsTimeoutMs,
                callbackAnalysis: opts.callbackAnalysis,
                callbackMaxMethods: opts.callbackMaxMethods,
                callbackMaxSources: opts.callbackMaxSources,
                callbackMaxStates: opts.callbackMaxStates,
                callbackMaxPathLen: opts.callbackMaxPathLen
            });
            taintFlows = taintResult.flows;
            taintAnalysis = taintResult.metadata;
            console.log(`[HAPFLOW] Taint analysis complete: ${taintFlows.length} flows detected.`);
        } catch (e) {
            console.log(`[WARN] HapFlow taint analysis failed: ${e}`);
            if (e instanceof Error && e.stack) {
                console.log(e.stack);
            }
            throw e;
        }
    }

    // Permissions
    let permissionResults = analyzePermissions(projectDir);

    // Build output
    let chainsWithPath = callChainResults.filter((c: any) => c.chain && c.chain.length > 0).length;
    const taintFlowLinks = linkTaintFlowsToPrivacyUsages(allApiResults, taintFlows);
    let output: ArkPrismOutput = {
        projectName,
        projectDirectory: reportProjectDir,
        analysisTimestamp: getTimestamp(),
        privacyApiUsages: allApiResults,
        callChains: callChainResults,
        multiSourceCollaborations: multiSourceResults,
        permissionUsages: permissionResults,
        taintFlows: taintFlows.length > 0 ? taintFlows : undefined,
        taintFlowLinks: taintFlowLinks.length > 0 ? taintFlowLinks : undefined,
        taintAnalysis,
        statistics: {
            totalFilesAnalyzed: filesAnalyzed,
            totalMethodsAnalyzed: methodsAnalyzed,
            totalApisDetected: allApiResults.length,
            totalCallChainsBuilt: chainsWithPath,
            totalCollaborationsDetected: multiSourceResults.length,
            totalTaintFlows: taintFlows.length
        },
        dataFlowStats: dfStats,
        recursivePatternStats: recursiveStats
    };

    // Write JSON report
    let outDir = path.resolve(opts.outputDir, projectName);
    writeJsonOutput(output, outDir, `${projectName}-arkprism-report.json`);

    // Write DOT file
    if (!opts.noDot && allApiResults.length > 0) {
        try {
            let dotContent = generateDot(output);
            if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
            let dotPath = path.join(outDir, `${projectName}-privacy-graph.dot`);
            writeFileSync(dotPath, dotContent, 'utf8');
            console.log(`[DOT] Privacy graph written to: ${toDisplayPath(dotPath)}`);
        } catch (e) {
            console.log(`[WARN] DOT generation failed: ${e}`);
        }
    }

    return output;
}

// ---- CLI parsing ----

function printUsage(): void {
    console.log(`
ArkPrism - ArkTS Privacy-sensitive API Recognition and Information-flow Subgraph Mapping
HarmonyOS Privacy Control Flow Subgraph Extractor

Usage:
  npx ts-node src/arkprism.ts <project_dir>              Analyze a single project
  npx ts-node src/arkprism.ts --batch <dataset_dir>       Batch analyze all projects in directory
  npx ts-node src/arkprism.ts --config <config.json>      Use config file (legacy mode)

Options:
  --output-dir <dir>    Output directory (default: ./out)
  --no-dot              Skip DOT graph generation
  --no-taint            Skip HapFlow taint analysis
  --no-pta              Skip pointer analysis (faster but less precise)
  --sdkPath <dir>       OpenHarmony SDK path (default: OPENHARMONY_SDK_PATH or E:/OpenHarmony_SDK/20/ets)

IFDS Options:
  --ifds-batch-size <n>         Sources per batch (default: all sources in one solver run)
  --ifds-max-edges <n>          Max IFDS edges (default: 10000000)
  --ifds-max-worklist <n>       Max worklist size (default: 2000000)
  --ifds-timeout-ms <n>         Timeout in milliseconds (default: 900000)

Callback Analysis Options:
  --callback-analysis <true|false>   Enable direct callback analysis (default: true)
  --callback-max-methods <n>         Max methods to scan (default: 100000)
  --callback-max-sources <n>         Max sources to analyze (default: 5000)
  --callback-max-states <n>          Max states per source (default: 10000)
  --callback-max-path-len <n>        Max path length (default: 100)

Examples:
  # Basic analysis
  npx ts-node src/arkprism.ts dataset/DrawingBook-master

  # Faster analysis (no pointer analysis)
  npx ts-node src/arkprism.ts dataset/DrawingBook-master --no-pta

  # Skip taint analysis entirely
  npx ts-node src/arkprism.ts dataset/DrawingBook-master --no-taint

  # Enable callback analysis with small budget
  npx ts-node src/arkprism.ts dataset/DrawingBook-master --no-pta --callback-analysis true --callback-max-methods 1000

  --help                Show this help message
`);
}

function parseArgs(): { mode: 'single' | 'batch' | 'config'; target: string; opts: AnalysisOptions } {
    let args = process.argv.slice(2);
    let mode: 'single' | 'batch' | 'config' = 'single';
    let target = '';
    let outputDir = path.resolve(__dirname, '..', 'out');
    let noDot = false;
    let noTaint = false;
    let noPta = false;
    let sdkPath = DEFAULT_SDK_PATH;

    // IFDS options
    let ifdsBatchSize: number | undefined;
    let ifdsMaxEdges: number | undefined;
    let ifdsMaxWorklist: number | undefined;
    let ifdsTimeoutMs: number | undefined;

    // Callback analysis options
    let callbackAnalysis: boolean | undefined;
    let callbackMaxMethods: number | undefined;
    let callbackMaxSources: number | undefined;
    let callbackMaxStates: number | undefined;
    let callbackMaxPathLen: number | undefined;

    for (let i = 0; i < args.length; i++) {
        let arg = args[i];
        if (arg === '--help' || arg === '-h') {
            printUsage();
            process.exit(0);
        } else if (arg === '--batch') {
            mode = 'batch';
            target = args[++i] || '';
        } else if (arg === '--config') {
            mode = 'config';
            target = args[++i] || '';
        } else if (arg === '--output-dir') {
            outputDir = args[++i] || outputDir;
        } else if (arg === '--no-dot') {
            noDot = true;
        } else if (arg === '--no-taint') {
            noTaint = true;
        } else if (arg === '--no-pta') {
            noPta = true;
        } else if (arg === '--sdkPath') {
            sdkPath = args[++i] || sdkPath;
        }
        // IFDS options
        else if (arg === '--ifds-batch-size') {
            ifdsBatchSize = parseInt(args[++i]);
        } else if (arg === '--ifds-max-edges') {
            ifdsMaxEdges = parseInt(args[++i]) || 10000000;
        } else if (arg === '--ifds-max-worklist') {
            ifdsMaxWorklist = parseInt(args[++i]) || 2000000;
        } else if (arg === '--ifds-timeout-ms') {
            ifdsTimeoutMs = parseInt(args[++i]) || 900000;
        }
        // Callback analysis options
        else if (arg === '--callback-analysis') {
            callbackAnalysis = args[++i]?.toLowerCase() === 'true';
        } else if (arg === '--callback-max-methods') {
            callbackMaxMethods = parseInt(args[++i]) || 100000;
        } else if (arg === '--callback-max-sources') {
            callbackMaxSources = parseInt(args[++i]) || 5000;
        } else if (arg === '--callback-max-states') {
            callbackMaxStates = parseInt(args[++i]) || 10000;
        } else if (arg === '--callback-max-path-len') {
            callbackMaxPathLen = parseInt(args[++i]) || 100;
        } else if (!arg.startsWith('-')) {
            target = arg;
        }
    }

    return {
        mode, target,
        opts: {
            outputDir, noDot, noTaint, noPta, sdkPath,
            ifdsBatchSize, ifdsMaxEdges, ifdsMaxWorklist, ifdsTimeoutMs,
            callbackAnalysis, callbackMaxMethods, callbackMaxSources, callbackMaxStates, callbackMaxPathLen
        }
    };
}

// ---- Run modes ----

function runSingle(projectDir: string, opts: AnalysisOptions): void {
    const projectPath = resolveAnalysisPath(projectDir);
    projectDir = projectPath.fileSystemPath;
    let projectName = path.basename(projectPath.displayPath);

    if (!existsSync(projectDir) || !statSync(projectDir).isDirectory()) {
        throw new Error(`[PROJECT_PATH_INVALID] Project directory does not exist: ${projectPath.displayPath}`);
    }

    console.log("=".repeat(70));
    console.log("  ArkPrism - ArkTS Privacy-sensitive API Recognition and Information-flow Subgraph Mapping");
    console.log("=".repeat(70));
    console.log(`[PROJECT] ${projectName}`);
    console.log(`[DIR]     ${projectPath.displayPath}\n`);

    let output = analyzeProject(projectDir, projectName, opts, projectPath.displayPath);

    console.log("\n" + "=".repeat(70));
    console.log("  ArkPrism Analysis Summary");
    console.log("=".repeat(70));
    console.log(`  Files analyzed:            ${output.statistics.totalFilesAnalyzed}`);
    console.log(`  Methods analyzed:          ${output.statistics.totalMethodsAnalyzed}`);
    console.log(`  Privacy APIs detected:     ${output.statistics.totalApisDetected}`);
    console.log(`  Call chains built:         ${output.statistics.totalCallChainsBuilt}`);
    console.log(`  Collab. behaviors found:   ${output.statistics.totalCollaborationsDetected}`);
    console.log(`  Taint flows detected:      ${output.statistics.totalTaintFlows || 0}`);
    console.log("=".repeat(70));
}

interface BatchResult {
    projectName: string;
    files: number;
    methods: number;
    apis: number;
    chainsWithPath: number;
    chainsTotal: number;
    chainRate: string;
    collaborations: number;
    permissions: number;
    dataSinks: number;
    error?: string;
    durationMs: number;
}

function runBatch(datasetDir: string, opts: AnalysisOptions): void {
    const datasetPath = resolveAnalysisPath(datasetDir);
    datasetDir = datasetPath.fileSystemPath;
    if (!existsSync(datasetDir) || !statSync(datasetDir).isDirectory()) {
        throw new Error(`[DATASET_PATH_INVALID] Dataset directory does not exist: ${datasetPath.displayPath}`);
    }
    let projects = readdirSync(datasetDir).filter(d => {
        let fullPath = path.join(datasetDir, d);
        return statSync(fullPath).isDirectory();
    });

    console.log(`\n${"=".repeat(80)}`);
    console.log(`  ArkPrism Batch Analysis - ${projects.length} projects`);
    console.log(`${"=".repeat(80)}\n`);

    let results: BatchResult[] = [];

    for (let i = 0; i < projects.length; i++) {
        let projectName = projects[i];
        let projectDir = path.join(datasetDir, projectName);
        let reportProjectDir = path.join(datasetPath.displayPath, projectName);
        console.log(`\n[${i + 1}/${projects.length}] ${projectName}`);
        console.log(`${"-".repeat(60)}`);

        let startTime = Date.now();
        try {
            let output = analyzeProject(projectDir, projectName, opts, reportProjectDir);
            let s = output.statistics;
            let sinkCount = 0;
            for (let c of output.callChains) {
                if (c.dataSinks) sinkCount += c.dataSinks.length;
            }
            results.push({
                projectName,
                files: s.totalFilesAnalyzed,
                methods: s.totalMethodsAnalyzed,
                apis: s.totalApisDetected,
                chainsWithPath: s.totalCallChainsBuilt,
                chainsTotal: output.callChains.length,
                chainRate: s.totalApisDetected > 0
                    ? (s.totalCallChainsBuilt / s.totalApisDetected * 100).toFixed(1) + '%'
                    : 'N/A',
                collaborations: s.totalCollaborationsDetected,
                permissions: output.permissionUsages.length,
                dataSinks: sinkCount,
                durationMs: Date.now() - startTime
            });
            console.log(`  APIs: ${s.totalApisDetected}, Chains: ${s.totalCallChainsBuilt}/${output.callChains.length}, Sinks: ${sinkCount}, Time: ${((Date.now() - startTime) / 1000).toFixed(1)}s`);
        } catch (e: any) {
            results.push({
                projectName, files: 0, methods: 0, apis: 0,
                chainsWithPath: 0, chainsTotal: 0, chainRate: 'ERR',
                collaborations: 0, permissions: 0, dataSinks: 0,
                error: e.message || String(e),
                durationMs: Date.now() - startTime
            });
            console.log(`  [ERROR] ${e.message || e}`);
        }
    }

    // Print summary table
    console.log(`\n\n${"=".repeat(110)}`);
    console.log("  BATCH SUMMARY");
    console.log(`${"=".repeat(110)}`);
    console.log(`${"Project".padEnd(35)} ${"Files".padStart(6)} ${"Methods".padStart(8)} ${"APIs".padStart(6)} ${"Chains".padStart(12)} ${"Rate".padStart(8)} ${"Sinks".padStart(6)} ${"Collab".padStart(7)} ${"Perms".padStart(6)} ${"Time".padStart(8)}`);
    console.log("-".repeat(110));

    let totalApis = 0, totalChains = 0, totalCollabs = 0, totalPerms = 0, totalSinks = 0;
    for (let r of results) {
        if (r.error) {
            console.log(`${r.projectName.padEnd(35)} ${"ERROR".padStart(6)} ${r.error.substring(0, 70)}`);
        } else {
            console.log(`${r.projectName.padEnd(35)} ${String(r.files).padStart(6)} ${String(r.methods).padStart(8)} ${String(r.apis).padStart(6)} ${(r.chainsWithPath + '/' + r.chainsTotal).padStart(12)} ${r.chainRate.padStart(8)} ${String(r.dataSinks).padStart(6)} ${String(r.collaborations).padStart(7)} ${String(r.permissions).padStart(6)} ${(r.durationMs / 1000).toFixed(1).padStart(7)}s`);
            totalApis += r.apis;
            totalChains += r.chainsWithPath;
            totalCollabs += r.collaborations;
            totalPerms += r.permissions;
            totalSinks += r.dataSinks;
        }
    }
    console.log("-".repeat(110));
    console.log(`${"TOTAL".padEnd(35)} ${"".padStart(6)} ${"".padStart(8)} ${String(totalApis).padStart(6)} ${String(totalChains).padStart(12)} ${"".padStart(8)} ${String(totalSinks).padStart(6)} ${String(totalCollabs).padStart(7)} ${String(totalPerms).padStart(6)}`);
    console.log(`${"=".repeat(110)}`);

    // Write summary JSON
    let summaryPath = path.resolve(opts.outputDir, 'batch_summary.json');
    if (!existsSync(opts.outputDir)) mkdirSync(opts.outputDir, { recursive: true });
    writeFileSync(summaryPath, JSON.stringify(results, null, 2), 'utf8');
    console.log(`\n[OUTPUT] Summary written to: ${toDisplayPath(summaryPath)}`);
}

function runConfig(configPath: string, opts: AnalysisOptions): void {
    configPath = toFileSystemPath(configPath);
    let configContent = readFileSync(configPath, 'utf8');
    let config = JSON.parse(configContent);
    let projectDir = config.targetProjectDirectory;
    let projectName = config.targetProjectName || path.basename(projectDir);
    runSingle(projectDir, opts);
}

// ---- Main ----

let { mode, target, opts } = parseArgs();
opts = {
    ...opts,
    outputDir: toFileSystemPath(opts.outputDir),
    sdkPath: toFileSystemPath(opts.sdkPath),
};

if (!target) {
    printUsage();
    process.exit(1);
} else if (mode === 'batch') {
    runBatch(target, opts);
} else if (mode === 'config') {
    runConfig(target, opts);
} else {
    runSingle(target, opts);
}
