/**
 * HapFlow vs ArkPrism: 4-mode comparison
 *
 * Mode A: HapFlow-native  (flat DummyMain + no callback + HapFlow source config)
 * Mode B: HapFlow+CB      (flat DummyMain + callback analysis + HapFlow source config)
 * Mode C: ArkPrism-lifecycle (lifecycle DummyMain + no callback + HapFlow source config)
 * Mode D: ArkPrism-full   (lifecycle DummyMain + callback analysis + HapFlow source config)
 *
 * All modes use the SAME source/sink configuration (hapflow_sources.json / hapflow_sinks.json).
 * The difference is in DummyMain structure and callback analysis.
 *
 * This isolates: (1) IFDS-only contribution, (2) callback analysis contribution,
 * (3) lifecycle DummyMain contribution.
 */
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const BASE_DIR = 'D:/argus-dataset/all-1015/ARGUS-successful-1015-samples-20260617';

const SELECTED_PROJECTS = [
    'Snake_NEXT-main',
    'STUFFS_NEXT-master',
    'Wechat_HarmonyOS',
    'legado-Harmony-main',
    'harmony-next-music-sharing',
    'harmonyos4me_ZUtils',
    'CommonAppDevelopment',
    'Camera',
    'Contact',
    'Bluetooth',
];

const RUNNER = path.join(__dirname, 'compare_4modes_single.js');

// Write the single-project runner script
const runnerScript = `
const { Scene, SceneConfig } = require('../dist/arkanalyzer');
const { runHapflowAnalysis } = require('../dist/hapflowRunner');

const projectDir = process.argv[2];
const mode = process.argv[3]; // 'hapflow-native', 'hapflow-cb', 'arkprism-lifecycle', 'arkprism-full'
const sdkPath = process.argv[4];

const sceneConfig = new SceneConfig();
sceneConfig.buildFromProjectDir(projectDir);
const scene = new Scene();
scene.buildSceneFromProjectDir(sceneConfig);

let opts;
switch (mode) {
    case 'hapflow-native':
        opts = { sdkPath, noPta: true, noLifecycle: true, callbackAnalysis: false, ifdsTimeoutMs: 180000 };
        break;
    case 'hapflow-cb':
        opts = { sdkPath, noPta: true, noLifecycle: true, callbackAnalysis: true, ifdsTimeoutMs: 180000 };
        break;
    case 'arkprism-lifecycle':
        opts = { sdkPath, noPta: true, noLifecycle: false, callbackAnalysis: false, ifdsTimeoutMs: 180000 };
        break;
    case 'arkprism-full':
        opts = { sdkPath, noPta: true, noLifecycle: false, callbackAnalysis: true, ifdsTimeoutMs: 180000 };
        break;
}

const taintFlows = runHapflowAnalysis(scene, opts);
console.log(JSON.stringify({ taintFlows: taintFlows.length }));
`;
fs.writeFileSync(RUNNER, runnerScript);

const modes = [
    { key: 'hapflow-native', label: 'HapFlow-native', desc: 'flat DummyMain + no callback' },
    { key: 'hapflow-cb', label: 'HapFlow+CB', desc: 'flat DummyMain + callback' },
    { key: 'arkprism-lifecycle', label: 'ArkPrism-LC', desc: 'lifecycle DummyMain + no callback' },
    { key: 'arkprism-full', label: 'ArkPrism-full', desc: 'lifecycle DummyMain + callback' },
];

const results = [];

for (const proj of SELECTED_PROJECTS) {
    const projectDir = path.join(BASE_DIR, proj);
    if (!fs.existsSync(projectDir)) {
        console.log(`[SKIP] ${proj} - not found`);
        continue;
    }

    const row = { project: proj };

    for (const mode of modes) {
        console.log(`[${proj}] Running ${mode.label}...`);
        try {
            const output = execSync(
                `node "${RUNNER}" "${projectDir}" ${mode.key} "E:/OpenHarmony_SDK/20/ets"`,
                { timeout: 300000, maxBuffer: 10 * 1024 * 1024, stdio: ['pipe', 'pipe', 'pipe'] }
            );
            const stdout = output.toString().trim();
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
                row[mode.key] = parsed.taintFlows;
            } else {
                console.log(`[${proj}] ${mode.label}: no JSON output`);
                row[mode.key] = -1;
            }
        } catch (e) {
            console.log(`[${proj}] ${mode.label} error: ${e.message?.substring(0, 150)}`);
            row[mode.key] = -1;
        }
    }

    results.push(row);
    console.log(`[${proj}] HapFlow-native=${row['hapflow-native']} HapFlow+CB=${row['hapflow-cb']} ArkPrism-LC=${row['arkprism-lifecycle']} ArkPrism-full=${row['arkprism-full']}`);
}

// Print table
console.log(`\n${'='.repeat(100)}`);
console.log('P0-1: HapFlow-native vs ArkPrism-full (4-mode comparison)');
console.log('  All modes use SAME source/sink configuration (hapflow_sources.json)');
console.log(`${'='.repeat(100)}`);
console.log(`${'Project'.padEnd(35)} ${'HapNative'.padStart(10)} ${'Hap+CB'.padStart(10)} ${'Ark-LC'.padStart(10)} ${'Ark-Full'.padStart(10)}`);
console.log('-'.repeat(100));
for (const r of results) {
    console.log(`${r.project.padEnd(35)} ${String(r['hapflow-native'] ?? '?').padStart(10)} ${String(r['hapflow-cb'] ?? '?').padStart(10)} ${String(r['arkprism-lifecycle'] ?? '?').padStart(10)} ${String(r['arkprism-full'] ?? '?').padStart(10)}`);
}

const validResults = results.filter(r => r['hapflow-native'] >= 0 && r['arkprism-full'] >= 0);
const totals = {};
for (const mode of modes) {
    totals[mode.key] = validResults.reduce((s, r) => s + (r[mode.key] || 0), 0);
}
console.log('-'.repeat(100));
console.log(`${'TOTAL'.padEnd(35)} ${String(totals['hapflow-native']).padStart(10)} ${String(totals['hapflow-cb']).padStart(10)} ${String(totals['arkprism-lifecycle']).padStart(10)} ${String(totals['arkprism-full']).padStart(10)}`);

// Key analysis
console.log('\n--- Key Analysis ---');
console.log('IFDS-only (HapFlow-native):', totals['hapflow-native'], 'flows');
console.log('IFDS + callback (HapFlow+CB):', totals['hapflow-cb'], 'flows');
console.log('Lifecycle IFDS only (ArkPrism-LC):', totals['arkprism-lifecycle'], 'flows');
console.log('Lifecycle IFDS + callback (ArkPrism-full):', totals['arkprism-full'], 'flows');
console.log('');
console.log('Callback analysis increment (HapFlow+CB - HapFlow-native):', totals['hapflow-cb'] - totals['hapflow-native']);
console.log('Lifecycle increment (ArkPrism-LC - HapFlow-native):', totals['arkprism-lifecycle'] - totals['hapflow-native']);
console.log('Lifecycle + callback increment (ArkPrism-full - HapFlow-native):', totals['arkprism-full'] - totals['hapflow-native']);

// Save
const outputPath = path.join(__dirname, '..', 'docs', 'comparison_hapflow_vs_arkprism', 'hapflow_4modes_comparison.json');
fs.writeFileSync(outputPath, JSON.stringify({
    timestamp: new Date().toISOString(),
    methodology: 'All modes use HapFlow source/sink config. HapFlow-native: flat DummyMain + no callback. HapFlow+CB: flat DummyMain + callback. ArkPrism-LC: lifecycle DummyMain + no callback. ArkPrism-full: lifecycle DummyMain + callback.',
    results,
    totals
}, null, 2));
console.log(`\nResults saved to: ${outputPath}`);

// Cleanup runner
try { fs.unlinkSync(RUNNER); } catch {}
