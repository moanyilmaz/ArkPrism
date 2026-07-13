/**
 * A/B Comparison: Flat (no lifecycle) vs Lifecycle-enhanced
 * Runs each project in an isolated child process to avoid OOM.
 */
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const BASE_DIR = 'D:/argus-dataset/all-1015/ARGUS-successful-1015-samples-20260617';

// Select projects with most taint flows (more meaningful for lifecycle comparison)
const SELECTED_PROJECTS = [
    'Snake_NEXT-main',
    'STUFFS_NEXT-master',
    'Wechat_HarmonyOS',
    'legado-Harmony-main',
    'harmony-next-music-sharing',
    'harmonyos4me_ZUtils',
    'Camera',
    'Contact',
    'Bluetooth',
    'Location',
];

const RUNNER = path.join(__dirname, 'compare_single_project.js');

// Write the single-project runner script
const runnerScript = `
const { Scene, SceneConfig } = require('../dist/arkanalyzer');
const { runHapflowAnalysis } = require('../dist/hapflowRunner');
const { buildCallGraph } = require('../dist/callGraphBuilder');
const { LifecycleModeler } = require('../dist/lifecycleModeler');

const projectDir = process.argv[2];
const mode = process.argv[3]; // 'flat' or 'lifecycle'
const sdkPath = process.argv[4];

const sceneConfig = new SceneConfig();
sceneConfig.buildFromProjectDir(projectDir);
const scene = new Scene();
scene.buildSceneFromProjectDir(sceneConfig);

const noLifecycle = mode === 'flat';

// Collect lifecycle model stats (always build for metrics)
let lifecycleAbilities = 0, lifecycleComponents = 0, lifecycleCallbacks = 0;
let lifecycleTransitions = 0, lifecycleCrossLayer = 0;
try {
    const modeler = new LifecycleModeler(scene);
    const model = modeler.buildModel();
    lifecycleAbilities = model.abilities.length;
    lifecycleComponents = model.components.length;
    lifecycleCallbacks = model.callbacks.length;
    lifecycleTransitions = model.transitions.length;
    lifecycleCrossLayer = model.transitions.filter(t => t.crossLayer).length;
} catch {}

const taintFlows = runHapflowAnalysis(scene, {
    sdkPath,
    noPta: true,
    noLifecycle,
    ifdsTimeoutMs: 120000,
});

let cgNodes = -1, cgEdges = -1;
try {
    const cg = buildCallGraph(scene, { noLifecycle });
    cgNodes = cg.getNodeNum();
} catch {}

const result = {
    taintFlows: taintFlows.length,
    cgNodes,
    lifecycleAbilities,
    lifecycleComponents,
    lifecycleCallbacks,
    lifecycleTransitions,
    lifecycleCrossLayer,
};
console.log(JSON.stringify(result));
`;
fs.writeFileSync(RUNNER, runnerScript);

const results = [];

for (const proj of SELECTED_PROJECTS) {
    const projectDir = path.join(BASE_DIR, proj);
    if (!fs.existsSync(projectDir)) {
        console.log(`[SKIP] ${proj} - not found`);
        continue;
    }

    const row = { project: proj };

    for (const mode of ['flat', 'lifecycle']) {
        const label = mode === 'flat' ? 'Flat' : 'Lifecycle';
        console.log(`[${proj}] Running ${label}...`);
        try {
            const output = execSync(
                `node "${RUNNER}" "${projectDir}" ${mode} "E:/OpenHarmony_SDK/20/ets"`,
                { timeout: 180000, maxBuffer: 10 * 1024 * 1024, stdio: ['pipe', 'pipe', 'pipe'] }
            );
            const stdout = output.toString().trim();
            // Find the last line that is valid JSON
            const lines = stdout.split('\n');
            let jsonLine = '';
            for (let i = lines.length - 1; i >= 0; i--) {
                try {
                    JSON.parse(lines[i]);
                    jsonLine = lines[i];
                    break;
                } catch {}
            }
            if (jsonLine) {
                const parsed = JSON.parse(jsonLine);
                if (mode === 'flat') {
                    row.flatTaintFlows = parsed.taintFlows;
                    row.flatCGNodes = parsed.cgNodes;
                } else {
                    row.lifecycleTaintFlows = parsed.taintFlows;
                    row.lifecycleCGNodes = parsed.cgNodes;
                    // Lifecycle model stats (same for both modes, capture from lifecycle run)
                    row.lifecycleAbilities = parsed.lifecycleAbilities;
                    row.lifecycleComponents = parsed.lifecycleComponents;
                    row.lifecycleCallbacks = parsed.lifecycleCallbacks;
                    row.lifecycleTransitions = parsed.lifecycleTransitions;
                    row.lifecycleCrossLayer = parsed.lifecycleCrossLayer;
                }
            } else {
                console.log(`[${proj}] ${label}: no JSON output found`);
                if (mode === 'flat') { row.flatTaintFlows = -1; row.flatCGNodes = -1; }
                else { row.lifecycleTaintFlows = -1; row.lifecycleCGNodes = -1; }
            }
        } catch (e) {
            console.log(`[${proj}] ${label} error: ${e.message?.substring(0, 100)}`);
            if (mode === 'flat') { row.flatTaintFlows = -1; row.flatCGNodes = -1; }
            else { row.lifecycleTaintFlows = -1; row.lifecycleCGNodes = -1; }
        }
    }

    if (row.flatTaintFlows >= 0 && row.lifecycleTaintFlows >= 0) {
        row.taintDelta = row.lifecycleTaintFlows - row.flatTaintFlows;
    }

    results.push(row);
    console.log(`[${proj}] flat=${row.flatTaintFlows} lifecycle=${row.lifecycleTaintFlows} delta=${row.taintDelta ?? '?'}`);
}

// Print table
console.log(`\n${'='.repeat(80)}`);
console.log('COMPARISON: Flat vs Lifecycle-enhanced');
console.log(`${'='.repeat(80)}`);
console.log(`${'Project'.padEnd(30)} ${'Flat'.padStart(6)} ${'Lifecycle'.padStart(10)} ${'Delta'.padStart(7)} ${'CG_flat'.padStart(8)} ${'CG_lc'.padStart(8)}`);
console.log('-'.repeat(80));
for (const r of results) {
    console.log(`${r.project.padEnd(30)} ${String(r.flatTaintFlows ?? '?').padStart(6)} ${String(r.lifecycleTaintFlows ?? '?').padStart(10)} ${String(r.taintDelta ?? '?').padStart(7)} ${String(r.flatCGNodes ?? '?').padStart(8)} ${String(r.lifecycleCGNodes ?? '?').padStart(8)}`);
}

const validResults = results.filter(r => r.flatTaintFlows >= 0 && r.lifecycleTaintFlows >= 0);
const totalFlat = validResults.reduce((s, r) => s + r.flatTaintFlows, 0);
const totalLifecycle = validResults.reduce((s, r) => s + r.lifecycleTaintFlows, 0);
const projectsImproved = validResults.filter(r => (r.taintDelta ?? 0) > 0).length;
console.log('-'.repeat(80));
console.log(`TOTAL${''.padEnd(25)} ${String(totalFlat).padStart(6)} ${String(totalLifecycle).padStart(10)} ${String(totalLifecycle - totalFlat).padStart(7)}`);
console.log(`Projects with more flows: ${projectsImproved}/${validResults.length}`);

// Save
const outputPath = path.join(__dirname, '..', 'comparison_lifecycle_impact.json');
fs.writeFileSync(outputPath, JSON.stringify({ results, summary: { totalFlat, totalLifecycle, delta: totalLifecycle - totalFlat, projectsImproved, totalProjects: validResults.length } }, null, 2));
console.log(`\nResults saved to: ${outputPath}`);

// Cleanup runner
try { fs.unlinkSync(RUNNER); } catch {}
