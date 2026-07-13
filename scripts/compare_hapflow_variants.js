/**
 * Compare HapFlow variants on the 66-project dataset:
 *   - Variant A: Pure HapFlow (IFDS-only, flat DummyMain, basic CG)
 *   - Variant B: HapFlow + Callback Analysis (IFDS + callback, lifecycle CG)
 *
 * This gives us an ablation study: how much does each enhancement contribute?
 *
 * Usage: node scripts/compare_hapflow_variants.js [--timeout MS] [--output PATH]
 */
const { Scene, SceneConfig } = require('../dist/arkanalyzer');
const { runHapflowAnalysis } = require('../dist/hapflowRunner');
const fs = require('fs');
const path = require('path');

const DATASET_DIR = 'D:/Projects/Argus-0703/ArkPrism/dataset';
const SDK_PATH = 'E:/OpenHarmony_SDK/20/ets';

// Parse args
const args = process.argv.slice(2);
let timeoutMs = 300000;
let outputPath = path.join(__dirname, '..', 'docs', 'comparison_hapflow_vs_arkprism', 'variant_comparison.json');

for (let i = 0; i < args.length; i++) {
    if (args[i] === '--timeout' && args[i + 1]) { timeoutMs = parseInt(args[i + 1]); i++; }
    if (args[i] === '--output' && args[i + 1]) { outputPath = args[i + 1]; i++; }
}

// Find all project dirs
const projectDirs = [];
const entries = fs.readdirSync(DATASET_DIR, { withFileTypes: true });
for (const entry of entries) {
    if (entry.isDirectory()) {
        projectDirs.push({ name: entry.name, dir: path.join(DATASET_DIR, entry.name) });
    }
}

console.log(`=== HapFlow Variant Comparison ===`);
console.log(`Projects: ${projectDirs.length}`);
console.log(`Timeout: ${timeoutMs}ms`);

// Variant A: Pure HapFlow (IFDS-only, flat DummyMain, basic CG, no callback)
const variantA_opts = {
    sdkPath: SDK_PATH,
    noPta: true,
    noLifecycle: true,       // flat DummyMain
    callbackAnalysis: false,  // no callback analysis
    ifdsTimeoutMs: timeoutMs,
};

// Variant B: HapFlow + Callback + Lifecycle
const variantB_opts = {
    sdkPath: SDK_PATH,
    noPta: true,
    noLifecycle: false,       // lifecycle-aware DummyMain
    callbackAnalysis: true,   // with callback analysis
    ifdsTimeoutMs: timeoutMs,
};

function runVariant(project, opts, label) {
    const startTime = Date.now();
    try {
        const sceneConfig = new SceneConfig();
        sceneConfig.buildFromProjectDir(project.dir);
        const scene = new Scene();
        scene.buildSceneFromProjectDir(sceneConfig);

        const flows = runHapflowAnalysis(scene, opts);
        const elapsed = Date.now() - startTime;

        return { flows: flows.length, elapsed, status: 'SUCCESS', error: null };
    } catch (e) {
        const elapsed = Date.now() - startTime;
        return { flows: 0, elapsed, status: 'ERROR', error: e.message?.substring(0, 200) };
    }
}

const results = [];
let totalA = 0, totalB = 0;
let bothZero = 0, onlyA = 0, onlyB = 0, bothNonZero = 0;

for (let i = 0; i < projectDirs.length; i++) {
    const project = projectDirs[i];
    console.log(`\n[${i + 1}/${projectDirs.length}] ${project.name}`);

    const resultA = runVariant(project, variantA_opts, 'A-PureIFDS');
    console.log(`  A (pure IFDS): ${resultA.flows} flows, ${resultA.elapsed}ms`);

    const resultB = runVariant(project, variantB_opts, 'B-IFDS+Callback+Lifecycle');
    console.log(`  B (IFDS+CB+LC): ${resultB.flows} flows, ${resultB.elapsed}ms`);

    totalA += resultA.flows;
    totalB += resultB.flows;

    if (resultA.flows === 0 && resultB.flows === 0) bothZero++;
    else if (resultA.flows > 0 && resultB.flows === 0) onlyA++;
    else if (resultA.flows === 0 && resultB.flows > 0) onlyB++;
    else bothNonZero++;

    results.push({
        name: project.name,
        variantA: resultA,
        variantB: resultB,
        deltaFlows: resultB.flows - resultA.flows,
    });
}

// Summary
console.log(`\n${'='.repeat(80)}`);
console.log('HapFlow Variant Comparison');
console.log(`${'='.repeat(80)}`);
console.log(`Projects: ${projectDirs.length}`);
console.log(`Variant A (pure IFDS):     ${totalA} total flows`);
console.log(`Variant B (IFDS+CB+LC):    ${totalB} total flows`);
console.log(`Delta (B - A):             ${totalB - totalA} flows`);
console.log(`Both zero: ${bothZero}, Only A: ${onlyA}, Only B: ${onlyB}, Both non-zero: ${bothNonZero}`);

// Top improvements
const improvements = results.filter(r => r.deltaFlows > 0).sort((a, b) => b.deltaFlows - a.deltaFlows);
if (improvements.length > 0) {
    console.log('\nProjects improved by CB+LC:');
    for (const r of improvements.slice(0, 20)) {
        console.log(`  ${r.name}: ${r.variantA.flows} → ${r.variantB.flows} (+${r.deltaFlows})`);
    }
}

// Projects where A found flows but B didn't (regression)
const regressions = results.filter(r => r.deltaFlows < 0);
if (regressions.length > 0) {
    console.log('\nRegressions (B found fewer flows):');
    for (const r of regressions) {
        console.log(`  ${r.name}: ${r.variantA.flows} → ${r.variantB.flows} (${r.deltaFlows})`);
    }
}

// Save
const outputDir = path.dirname(outputPath);
if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
}
fs.writeFileSync(outputPath, JSON.stringify({
    timestamp: new Date().toISOString(),
    config: { timeoutMs, variantA: variantA_opts, variantB: variantB_opts },
    summary: {
        total: projectDirs.length,
        totalFlowsA: totalA,
        totalFlowsB: totalB,
        delta: totalB - totalA,
        bothZero, onlyA, onlyB, bothNonZero,
    },
    results,
}, null, 2));
console.log(`\nResults saved to: ${outputPath}`);
