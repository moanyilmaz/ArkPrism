/**
 * Ablation: Lifecycle impact on call chain quality.
 *
 * Compares call chain quality metrics with vs without lifecycle modeling:
 *   - Chain entry type distribution (framework-entry vs local fallback vs unknown)
 *   - Cross-phase chain count (chains spanning lifecycle phases)
 *   - Chain length distribution
 *
 * Uses arkprism components directly (not the CLI entry point).
 */
const { Scene, SceneConfig } = require('../dist/arkanalyzer');
const { getSceneFromJson, readPrivacyApis, readSystemPackages } = require('../dist/utils');
const { analyzeFileForPrivacyApis } = require('../dist/apiDetector');
const { buildCallGraph } = require('../dist/callGraphBuilder');
const { traceCallChains } = require('../dist/callChainTracer');
const { analyzeDataSinks } = require('../dist/dataSinkAnalyzer');
const { LifecycleModeler } = require('../dist/lifecycleModeler');
const fs = require('fs');
const path = require('path');

const DATASET_DIR = 'D:/argus-dataset/all-1015/ARGUS-successful-1015-samples-20260617';
const SDK_PATH = 'E:/OpenHarmony_SDK/20/ets';

const projectDirs = [];
const entries = fs.readdirSync(DATASET_DIR, { withFileTypes: true });
for (const entry of entries) {
    if (entry.isDirectory()) {
        projectDirs.push({ name: entry.name, dir: path.join(DATASET_DIR, entry.name) });
    }
}

// Use the 26 projects from the annotated dataset
const TARGET_PROJECTS = [
    'DrawingBook-master', 'harmony-next-music-sharing', 'harmonyos-games-main',
    'harmonyProject-master', 'legado-Harmony-main', 'Snake_NEXT-main',
    'STUFFS_NEXT-master', 'Wechat_HarmonyOS', 'FilesManger',
    'List', 'MultiShopping', 'SecondLevelLinkage', 'SliderExample',
    'WebCookie', 'Healthy_life', 'LoginDemo', 'TransitionAnimation',
    'Recorder', 'ImageEdit', 'PedometerApp', 'MultiDeviceCommunication',
    'com.example.myapplication2', 'ElectronicAlbum', 'OxHornCampus',
    'WindowManager', 'AnimateRefresh',
];

const filteredDirs = projectDirs.filter(p => TARGET_PROJECTS.includes(p.name));

function countChainMetrics(callChains, lifecycleModel) {
    let frameworkEntry = 0;
    let componentLifecycle = 0;
    let appLifecycle = 0;
    let userInteraction = 0;
    let initialization = 0;
    let unknown = 0;
    let localFallback = 0;
    let crossPhase = 0;
    let totalLength = 0;
    let chainsWithEntry = 0;

    // Build phase map from lifecycle model
    const methodToPhase = new Map();
    if (lifecycleModel) {
        for (const ability of lifecycleModel.abilities) {
            for (const m of ability.methods) {
                methodToPhase.set(m.method.getSignature().toString(), String(m.info.phase));
            }
        }
        for (const component of lifecycleModel.components) {
            for (const m of component.methods) {
                methodToPhase.set(m.method.getSignature().toString(), String(m.info.phase));
            }
        }
    }

    for (const chain of callChains) {
        const entry = chain.entryMethod;
        if (!entry || !entry.type) {
            localFallback++;
            continue;
        }

        const type = entry.type;
        if (type === 'component_lifecycle') { componentLifecycle++; frameworkEntry++; }
        else if (type === 'app_lifecycle') { appLifecycle++; frameworkEntry++; }
        else if (type === 'user_interaction') { userInteraction++; frameworkEntry++; }
        else if (type === 'initialization') { initialization++; }
        else { unknown++; }

        // Chain length
        if (chain.chain && chain.chain.length > 0) {
            totalLength += chain.chain.length;
            chainsWithEntry++;
        }

        // Cross-phase check
        if (chain.chain && chain.chain.length > 1 && lifecycleModel) {
            const phases = new Set();
            for (const step of chain.chain) {
                const sig = step.calleeSig || step.callerSig || '';
                const phase = methodToPhase.get(sig);
                if (phase) phases.add(phase);
            }
            if (phases.size > 1) crossPhase++;
        }
    }

    return {
        total: callChains.length,
        frameworkEntry,
        componentLifecycle,
        appLifecycle,
        userInteraction,
        initialization,
        unknown,
        localFallback,
        crossPhase,
        avgChainLength: chainsWithEntry > 0 ? (totalLength / chainsWithEntry).toFixed(2) : 0,
    };
}

// Run analysis for a single project
function runAnalysis(projectDir, projectName, withLifecycle) {
    // Build scene
    const sceneConfig = new SceneConfig();
    sceneConfig.buildFromProjectDir(projectDir);
    let scene = getSceneFromJson(sceneConfig);
    let allFiles = scene.getFiles();
    if (allFiles.length === 0) {
        // Retry with source file discovery
        const sourceFiles = [];
        function discover(root) {
            for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
                const full = path.join(root, entry.name);
                if (entry.isDirectory()) {
                    if (!['build','cache','node_modules','oh_modules','.preview','.git','hvigor','.hvigor','resources','rawfile','archive_files'].includes(entry.name)) {
                        discover(full);
                    }
                } else if (/\.(ets|ts)$/.test(entry.name)) {
                    sourceFiles.push(full);
                }
            }
        }
        discover(projectDir);
        if (sourceFiles.length > 0) {
            const rc = new SceneConfig();
            rc.buildFromProjectFiles(projectName, projectDir, sourceFiles);
            scene = new Scene();
            scene.buildBasicInfo(rc);
            if (typeof scene.genArkFiles === 'function') scene.genArkFiles();
            scene.inferTypes();
            allFiles = scene.getFiles();
        }
    }

    // Read rules
    const privacyApisPath = path.resolve(__dirname, '..', 'config', 'sensitive_apis.json');
    const systemPackagesPath = path.resolve(__dirname, '..', 'config', 'system_packages14.json');
    const privacyApis = readPrivacyApis(privacyApisPath);
    const systemPackages = Array.from(new Set([
        ...readSystemPackages(systemPackagesPath),
        ...privacyApis.map(pkg => pkg.systemPackage),
    ]));

    // Detect APIs
    let allApiResults = [];
    let filesAnalyzed = 0;
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
    }

    if (allApiResults.length === 0) {
        return { apis: 0, chains: [], lifecycleModel: null };
    }

    // Build call graph with/without lifecycle
    const callGraph = buildCallGraph(scene, { noLifecycle: !withLifecycle });

    // Trace chains
    const chains = traceCallChains(allApiResults, scene, callGraph, projectDir);

    // Analyze sinks
    analyzeDataSinks(allApiResults, chains, scene);

    // Build lifecycle model for cross-phase analysis
    let lifecycleModel = null;
    if (withLifecycle) {
        try {
            const modeler = new LifecycleModeler(scene);
            lifecycleModel = modeler.buildModel();
        } catch (e) { }
    }

    return { apis: allApiResults.length, chains, lifecycleModel };
}

for (const withLifecycle of [false, true]) {
    const label = withLifecycle ? 'WITH lifecycle' : 'WITHOUT lifecycle (flat)';
    console.log(`\n${'='.repeat(60)}`);
    console.log(`Running: ${label}`);
    console.log(`${'='.repeat(60)}`);

    let aggregateMetrics = {
        total: 0, frameworkEntry: 0, componentLifecycle: 0, appLifecycle: 0,
        userInteraction: 0, initialization: 0, unknown: 0, localFallback: 0,
        crossPhase: 0, totalChainLength: 0, chainsWithEntry: 0,
    };
    let totalApis = 0;
    let totalSinks = 0;
    const perProject = [];

    for (let i = 0; i < filteredDirs.length; i++) {
        const project = filteredDirs[i];
        console.log(`[${i + 1}/${filteredDirs.length}] ${project.name}`);

        try {
            const result = runAnalysis(project.dir, project.name, withLifecycle);
            const chains = result.chains || [];

            const metrics = countChainMetrics(chains, result.lifecycleModel);

            // Count sinks
            let sinkCount = 0;
            for (const c of chains) {
                if (c.dataSinks) sinkCount += c.dataSinks.length;
            }

            totalApis += result.apis;
            totalSinks += sinkCount;

            for (const key of Object.keys(aggregateMetrics)) {
                aggregateMetrics[key] += metrics[key] || 0;
            }

            perProject.push({
                name: project.name,
                apis: result.apis,
                ...metrics,
                sinks: sinkCount,
            });

        } catch (e) {
            console.log(`  ERROR: ${e.message?.substring(0, 80)}`);
        }
    }

    console.log(`\n=== Aggregate: ${label} ===`);
    console.log(`APIs detected: ${totalApis}`);
    console.log(`Total chains: ${aggregateMetrics.total}`);
    console.log(`Framework-entry chains: ${aggregateMetrics.frameworkEntry} (${(aggregateMetrics.frameworkEntry / Math.max(aggregateMetrics.total, 1) * 100).toFixed(1)}%)`);
    console.log(`  Component lifecycle: ${aggregateMetrics.componentLifecycle}`);
    console.log(`  App lifecycle: ${aggregateMetrics.appLifecycle}`);
    console.log(`  User interaction: ${aggregateMetrics.userInteraction}`);
    console.log(`Initialization chains: ${aggregateMetrics.initialization}`);
    console.log(`Unknown-entry chains: ${aggregateMetrics.unknown}`);
    console.log(`Local fallback chains: ${aggregateMetrics.localFallback} (${(aggregateMetrics.localFallback / Math.max(aggregateMetrics.total, 1) * 100).toFixed(1)}%)`);
    console.log(`Cross-phase chains: ${aggregateMetrics.crossPhase}`);
    console.log(`Total sinks: ${totalSinks}`);

    // Save
    const outputPath = path.join(__dirname, '..', 'docs', 'comparison_hapflow_vs_arkprism',
        `chain_quality_${withLifecycle ? 'with_lc' : 'no_lc'}.json`);
    fs.writeFileSync(outputPath, JSON.stringify({
        label,
        aggregate: aggregateMetrics,
        totalApis,
        totalSinks,
        perProject,
    }, null, 2));
    console.log(`Saved to: ${outputPath}`);
}
