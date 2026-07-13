/**
 * Run Variant A (pure IFDS) on 66-project dataset with flow details for annotation.
 */
const { Scene, SceneConfig } = require('../dist/arkanalyzer');
const { runHapflowAnalysis } = require('../dist/hapflowRunner');
const fs = require('fs');
const path = require('path');

const DATASET_DIR = 'D:/Projects/Argus-0703/ArkPrism/dataset';
const SDK_PATH = 'E:/OpenHarmony_SDK/20/ets';

const projectDirs = [];
const entries = fs.readdirSync(DATASET_DIR, { withFileTypes: true });
for (const entry of entries) {
    if (entry.isDirectory()) {
        projectDirs.push({ name: entry.name, dir: path.join(DATASET_DIR, entry.name) });
    }
}

console.log(`Running Variant A (pure IFDS) on ${projectDirs.length} projects`);

const results = [];
let totalFlows = 0;

for (let i = 0; i < projectDirs.length; i++) {
    const project = projectDirs[i];
    const startTime = Date.now();
    console.log(`[${i + 1}/${projectDirs.length}] ${project.name}`);

    try {
        const sceneConfig = new SceneConfig();
        sceneConfig.buildFromProjectDir(project.dir);
        const scene = new Scene();
        scene.buildSceneFromProjectDir(sceneConfig);

        const taintFlows = runHapflowAnalysis(scene, {
            sdkPath: SDK_PATH,
            noPta: true,
            noLifecycle: true,
            callbackAnalysis: false,
            ifdsTimeoutMs: 300000,
        });

        const elapsed = Date.now() - startTime;
        totalFlows += taintFlows.length;

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
        results.push({
            name: project.name,
            flows: 0,
            elapsed,
            status: 'ERROR',
            error: e.message?.substring(0, 200),
        });
        console.log(`  ERROR: ${e.message?.substring(0, 100)}`);
    }
}

const outputPath = path.join(__dirname, '..', 'docs', 'comparison_hapflow_vs_arkprism', 'variant_a_flows.json');
fs.writeFileSync(outputPath, JSON.stringify({
    timestamp: new Date().toISOString(),
    config: { noPta: true, noLifecycle: true, callbackAnalysis: false, sdkPath: SDK_PATH },
    summary: { total: projectDirs.length, totalFlows },
    results,
}, null, 2));

console.log(`\nVariant A: ${totalFlows} total flows`);
console.log(`Saved to: ${outputPath}`);
