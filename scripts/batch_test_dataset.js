/**
 * Batch test ArkPrism on the 66-project dataset.
 * Outputs per-project taint flow results for manual annotation.
 *
 * Usage: node scripts/batch_test_dataset.js [--timeout MS] [--no-pta] [--output PATH]
 */
const { Scene, SceneConfig } = require('../dist/arkanalyzer');
const { runHapflowAnalysis } = require('../dist/hapflowRunner');
const fs = require('fs');
const path = require('path');

const DATASET_DIR = 'D:/Projects/Argus-0703/ArkPrism/dataset';
const SDK_PATH = 'E:/OpenHarmony_SDK/20/ets';

// Parse args
const args = process.argv.slice(2);
let timeoutMs = 300000;  // 5 min per project
let noPta = false;
let outputPath = path.join(__dirname, '..', 'docs', 'comparison_hapflow_vs_arkprism', 'dataset_batch_results.json');

for (let i = 0; i < args.length; i++) {
    if (args[i] === '--timeout' && args[i + 1]) { timeoutMs = parseInt(args[i + 1]); i++; }
    if (args[i] === '--no-pta') { noPta = true; }
    if (args[i] === '--output' && args[i + 1]) { outputPath = args[i + 1]; i++; }
}

// Find all project dirs (any subdirectory of dataset/ is a project)
const projectDirs = [];
const entries = fs.readdirSync(DATASET_DIR, { withFileTypes: true });
for (const entry of entries) {
    if (entry.isDirectory()) {
        const projectPath = path.join(DATASET_DIR, entry.name);
        projectDirs.push({ name: entry.name, dir: projectPath });
    }
}

console.log(`Found ${projectDirs.length} project directories`);
console.log(`Timeout: ${timeoutMs}ms, PTA: ${noPta ? 'DISABLED' : 'ENABLED'}`);

const results = [];
let totalFlows = 0;
let errorCount = 0;
let timeoutCount = 0;

for (let i = 0; i < projectDirs.length; i++) {
    const project = projectDirs[i];
    const startTime = Date.now();
    console.log(`\n[${i + 1}/${projectDirs.length}] ${project.name}`);

    try {
        const sceneConfig = new SceneConfig();
        sceneConfig.buildFromProjectDir(project.dir);
        const scene = new Scene();
        scene.buildSceneFromProjectDir(sceneConfig);

        const taintFlows = runHapflowAnalysis(scene, {
            sdkPath: SDK_PATH,
            noPta: noPta,
            noLifecycle: false,
            callbackAnalysis: true,
            ifdsTimeoutMs: timeoutMs,
        });

        const elapsed = Date.now() - startTime;
        totalFlows += taintFlows.length;

        // Group flows by source→sink channel for summary
        const flowSummary = taintFlows.map(f => ({
            sourceApi: f.sourceApi,
            sourceFile: f.sourceFile,
            sourceLine: f.sourceLine,
            sinkApi: f.sinkApi,
            sinkFile: f.sinkFile,
            sinkLine: f.sinkLine,
            taintedValue: f.taintedValue,
            pathLength: f.path?.length || 0,
        }));

        results.push({
            name: project.name,
            flows: taintFlows.length,
            elapsed,
            status: 'SUCCESS',
            flowsDetail: flowSummary,
        });

        console.log(`  flows=${taintFlows.length}, elapsed=${elapsed}ms`);
    } catch (e) {
        const elapsed = Date.now() - startTime;
        const isTimeout = e.message?.includes('timeout') || elapsed >= timeoutMs * 0.95;
        errorCount++;

        results.push({
            name: project.name,
            flows: 0,
            elapsed,
            status: isTimeout ? 'TIMEOUT' : 'ERROR',
            error: e.message?.substring(0, 200),
        });

        console.log(`  ${isTimeout ? 'TIMEOUT' : 'ERROR'}: ${e.message?.substring(0, 100)}`);
    }
}

// Summary
console.log(`\n${'='.repeat(80)}`);
console.log('ArkPrism Batch Test Results (66-project dataset)');
console.log(`${'='.repeat(80)}`);
console.log(`Projects: ${projectDirs.length}`);
console.log(`Total flows: ${totalFlows}`);
console.log(`Success: ${results.filter(r => r.status === 'SUCCESS').length}`);
console.log(`Timeout: ${results.filter(r => r.status === 'TIMEOUT').length}`);
console.log(`Error: ${results.filter(r => r.status === 'ERROR').length}`);

// Distribution
const flowDist = {};
for (const r of results) {
    const bucket = r.flows === 0 ? '0' : r.flows <= 5 ? '1-5' : r.flows <= 20 ? '6-20' : '21+';
    flowDist[bucket] = (flowDist[bucket] || 0) + 1;
}
console.log('Flow distribution:', JSON.stringify(flowDist));

// Top projects by flow count
const topProjects = results.filter(r => r.flows > 0).sort((a, b) => b.flows - a.flows).slice(0, 15);
if (topProjects.length > 0) {
    console.log('\nTop projects by flow count:');
    for (const p of topProjects) {
        console.log(`  ${p.name}: ${p.flows} flows`);
    }
}

// Save
const outputDir = path.dirname(outputPath);
if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
}
fs.writeFileSync(outputPath, JSON.stringify({
    timestamp: new Date().toISOString(),
    config: { timeoutMs, noPta, sdkPath: SDK_PATH },
    summary: {
        total: projectDirs.length,
        totalFlows,
        success: results.filter(r => r.status === 'SUCCESS').length,
        timeout: results.filter(r => r.status === 'TIMEOUT').length,
        error: results.filter(r => r.status === 'ERROR').length,
        flowDist,
    },
    results,
}, null, 2));
console.log(`\nResults saved to: ${outputPath}`);
