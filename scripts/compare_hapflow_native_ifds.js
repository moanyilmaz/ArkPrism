/**
 * P0-1 End-to-End: HapFlow-native IFDS vs ArkPrism-full IFDS
 *
 * This script runs two IFDS configurations on each project:
 *   Run A (HapFlow-native): flat DummyMain + no callback analysis + HapFlow source config
 *   Run B (ArkPrism-full):  lifecycle DummyMain + callback analysis + HapFlow source config
 *
 * Both runs use the SAME source configuration (hapflow_sources.json).
 * The difference is in DummyMain structure and callback augmentation.
 *
 * Key question: Does lifecycle-structured DummyMain + callback analysis
 * produce more taint flows than flat DummyMain + no callback analysis?
 *
 * Runs each project in an isolated child process to avoid OOM.
 */
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const BASE_DIR = 'D:/argus-dataset/all-1015/ARGUS-successful-1015-samples-20260617';

// Select projects with most taint flows (from Top-120 benchmark)
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

const RUNNER = path.join(__dirname, 'compare_hapflow_native_single.js');

// Write the single-project runner script
const runnerScript = `
const { Scene, SceneConfig } = require('../dist/arkanalyzer');
const { runHapflowAnalysis } = require('../dist/hapflowRunner');

const projectDir = process.argv[2];
const mode = process.argv[3]; // 'hapflow-native' or 'arkprism-full'
const sdkPath = process.argv[4];

const sceneConfig = new SceneConfig();
sceneConfig.buildFromProjectDir(projectDir);
const scene = new Scene();
scene.buildSceneFromProjectDir(sceneConfig);

let taintFlows;
if (mode === 'hapflow-native') {
    // HapFlow-native: flat DummyMain, no callback analysis
    taintFlows = runHapflowAnalysis(scene, {
        sdkPath,
        noPta: true,
        noLifecycle: true,
        callbackAnalysis: false,
        ifdsTimeoutMs: 180000,
    });
} else {
    // ArkPrism-full: lifecycle DummyMain, callback analysis enabled
    taintFlows = runHapflowAnalysis(scene, {
        sdkPath,
        noPta: true,
        noLifecycle: false,
        callbackAnalysis: true,
        ifdsTimeoutMs: 180000,
    });
}

const result = {
    taintFlows: taintFlows.length,
    // Extract source APIs from taint flows
    sourceApis: [...new Set(taintFlows.map(f => f.sourceApi.substring(0, 100)))],
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

    for (const mode of ['hapflow-native', 'arkprism-full']) {
        const label = mode === 'hapflow-native' ? 'HapFlow-native' : 'ArkPrism-full';
        console.log(`[${proj}] Running ${label}...`);
        try {
            const output = execSync(
                `node "${RUNNER}" "${projectDir}" ${mode} "E:/OpenHarmony_SDK/20/ets"`,
                { timeout: 300000, maxBuffer: 10 * 1024 * 1024, stdio: ['pipe', 'pipe', 'pipe'] }
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
                if (mode === 'hapflow-native') {
                    row.hapflowTaintFlows = parsed.taintFlows;
                    row.hapflowSourceApis = parsed.sourceApis;
                } else {
                    row.arkprismTaintFlows = parsed.taintFlows;
                    row.arkprismSourceApis = parsed.sourceApis;
                }
            } else {
                console.log(`[${proj}] ${label}: no JSON output found`);
                if (mode === 'hapflow-native') row.hapflowTaintFlows = -1;
                else row.arkprismTaintFlows = -1;
            }
        } catch (e) {
            console.log(`[${proj}] ${label} error: ${e.message?.substring(0, 150)}`);
            if (mode === 'hapflow-native') row.hapflowTaintFlows = -1;
            else row.arkprismTaintFlows = -1;
        }
    }

    if (row.hapflowTaintFlows >= 0 && row.arkprismTaintFlows >= 0) {
        row.taintDelta = row.arkprismTaintFlows - row.hapflowTaintFlows;
    }

    results.push(row);
    console.log(`[${proj}] HapFlow=${row.hapflowTaintFlows} ArkPrism=${row.arkprismTaintFlows} delta=${row.taintDelta ?? '?'}`);
}

// Print table
console.log(`\n${'='.repeat(90)}`);
console.log('P0-1: HapFlow-native IFDS vs ArkPrism-full IFDS');
console.log('  HapFlow-native: flat DummyMain + no callback analysis + HapFlow source config');
console.log('  ArkPrism-full:  lifecycle DummyMain + callback analysis + HapFlow source config');
console.log('  Both use SAME source configuration (hapflow_sources.json)');
console.log(`${'='.repeat(90)}`);
console.log(`${'Project'.padEnd(35)} ${'HapFlow'.padStart(8)} ${'ArkPrism'.padStart(10)} ${'Delta'.padStart(7)}`);
console.log('-'.repeat(90));
for (const r of results) {
    console.log(`${r.project.padEnd(35)} ${String(r.hapflowTaintFlows ?? '?').padStart(8)} ${String(r.arkprismTaintFlows ?? '?').padStart(10)} ${String(r.taintDelta ?? '?').padStart(7)}`);
}

const validResults = results.filter(r => r.hapflowTaintFlows >= 0 && r.arkprismTaintFlows >= 0);
const totalHapflow = validResults.reduce((s, r) => s + r.hapflowTaintFlows, 0);
const totalArkprism = validResults.reduce((s, r) => s + r.arkprismTaintFlows, 0);
const projectsImproved = validResults.filter(r => (r.taintDelta ?? 0) > 0).length;
console.log('-'.repeat(90));
console.log(`${'TOTAL'.padEnd(35)} ${String(totalHapflow).padStart(8)} ${String(totalArkprism).padStart(10)} ${String(totalArkprism - totalHapflow).padStart(7)}`);
console.log(`Projects with more flows (ArkPrism > HapFlow): ${projectsImproved}/${validResults.length}`);

// Analyze source APIs
console.log('\n--- Source API Analysis ---');
for (const r of validResults) {
    if (r.hapflowSourceApis && r.arkprismSourceApis) {
        const hapflowOnly = r.arkprismSourceApis.filter(a => !r.hapflowSourceApis.includes(a));
        const arkprismOnly = r.hapflowSourceApis.filter(a => !r.arkprismSourceApis.includes(a));
        if (hapflowOnly.length > 0 || arkprismOnly.length > 0) {
            console.log(`${r.project}:`);
            if (arkprismOnly.length > 0) console.log('  HapFlow-only sources: ' + arkprismOnly.slice(0, 5).join('; '));
            if (hapflowOnly.length > 0) console.log('  ArkPrism-only sources: ' + hapflowOnly.slice(0, 5).join('; '));
        }
    }
}

// Save
const outputPath = path.join(__dirname, '..', 'docs', 'comparison_hapflow_vs_arkprism', 'hapflow_native_vs_arkprism_full.json');
fs.writeFileSync(outputPath, JSON.stringify({
    timestamp: new Date().toISOString(),
    methodology: 'Both runs use HapFlow source config (hapflow_sources.json). HapFlow-native: flat DummyMain + no callback. ArkPrism-full: lifecycle DummyMain + callback analysis.',
    results,
    summary: { totalHapflow, totalArkprism, delta: totalArkprism - totalHapflow, projectsImproved, totalProjects: validResults.length }
}, null, 2));
console.log(`\nResults saved to: ${outputPath}`);

// Cleanup runner
try { fs.unlinkSync(RUNNER); } catch {}
