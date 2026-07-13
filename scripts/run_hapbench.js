/**
 * Run HapBench using our ArkPrism HapFlow integration.
 * Compare results against the ground truth from the HapFlow artifact.
 *
 * This validates that our HapFlow integration is correct:
 * - If our results match the original HapFlow results on HapBench,
 *   then the 0-flow result on real projects is a genuine HapFlow limitation,
 *   not an integration error.
 */
const { Scene, SceneConfig } = require('../dist/arkanalyzer');
const { runHapflowAnalysis } = require('../dist/hapflowRunner');
const fs = require('fs');
const path = require('path');

const HAPBENCH_DIR = 'D:/Projects/Argus-0703/hapflow_artifact/HapBench';
const SDK_PATH = 'D:/Projects/Argus-0703/hapflow_artifact/sdk/default/openharmony/ets';

// Parse ground truth
const gtPath = path.join('D:/Projects/Argus-0703/hapflow_artifact/hapflow/out/HapBench.txt');
const gtContent = fs.readFileSync(gtPath, 'utf-8');
const groundTruth = new Map();
for (const line of gtContent.trim().split('\n')) {
    const parts = line.split(' , ');
    if (parts.length === 2) {
        const name = parts[0].replace('..\\HapBench\\', '').replace(/\\/g, '/');
        const expected = parseInt(parts[1].trim());
        groundTruth.set(name, expected);
    }
}

console.log(`Loaded ${groundTruth.size} ground truth entries`);

// Find all HapBench test directories
const testDirs = [];
function findTestDirs(dir, category = '') {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
        if (entry.isDirectory()) {
            const subDir = path.join(dir, entry.name);
            // Check if this directory contains an entryability/EntryAbility.ets
            const entryAbility = path.join(subDir, 'entryability', 'EntryAbility.ets');
            if (fs.existsSync(entryAbility)) {
                testDirs.push({
                    name: category ? `${category}/${entry.name}` : entry.name,
                    dir: subDir,
                });
            } else {
                // It's a category directory
                findTestDirs(subDir, category ? `${category}/${entry.name}` : entry.name);
            }
        }
    }
}
findTestDirs(HAPBENCH_DIR);

console.log(`Found ${testDirs.length} test directories`);

// Run each test
const results = [];
let tp = 0, fp = 0, fn = 0, tn = 0;
let matchCount = 0;
let mismatchCount = 0;

for (const test of testDirs) {
    const expectedFlows = groundTruth.get(test.name) ?? -1;

    try {
        const sceneConfig = new SceneConfig();
        sceneConfig.buildFromProjectDir(test.dir);
        const scene = new Scene();
        scene.buildSceneFromProjectDir(sceneConfig);

        const taintFlows = runHapflowAnalysis(scene, {
            sdkPath: SDK_PATH,
            noPta: false,
            noLifecycle: false,
            callbackAnalysis: true,
            ifdsTimeoutMs: 120000,
        });

        const actualFlows = taintFlows.length;
        const match = actualFlows === expectedFlows;

        if (match) {
            matchCount++;
        } else {
            mismatchCount++;
            console.log(`[MISMATCH] ${test.name}: expected=${expectedFlows}, actual=${actualFlows}`);
        }

        // Compute TP/FP/FN/TN
        if (expectedFlows > 0 && actualFlows > 0) {
            // Both have flows - count as TP if exact match, partial TP otherwise
            const min = Math.min(expectedFlows, actualFlows);
            tp += min;
            fp += Math.max(0, actualFlows - expectedFlows);
            fn += Math.max(0, expectedFlows - actualFlows);
        } else if (expectedFlows > 0 && actualFlows === 0) {
            fn += expectedFlows;
        } else if (expectedFlows === 0 && actualFlows > 0) {
            fp += actualFlows;
        } else {
            tn++;
        }

        results.push({
            name: test.name,
            expected: expectedFlows,
            actual: actualFlows,
            match
        });
    } catch (e) {
        console.log(`[ERROR] ${test.name}: ${e.message?.substring(0, 100)}`);
        results.push({
            name: test.name,
            expected: expectedFlows,
            actual: -1,
            match: false,
            error: e.message?.substring(0, 100)
        });
        if (expectedFlows > 0) fn += expectedFlows;
    }
}

// Print results
console.log(`\n${'='.repeat(80)}`);
console.log('HapBench Validation: Our HapFlow Integration vs Original HapFlow');
console.log(`${'='.repeat(80)}`);
console.log(`Tests: ${results.length}, Matches: ${matchCount}, Mismatches: ${mismatchCount}`);
console.log(`Exact match rate: ${(matchCount / results.length * 100).toFixed(1)}%`);
console.log(`TP=${tp}, FP=${fp}, FN=${fn}, TN=${tn}`);
const precision = tp + fp > 0 ? (tp / (tp + fp) * 100).toFixed(1) : 'N/A';
const recall = tp + fn > 0 ? (tp / (tp + fn) * 100).toFixed(1) : 'N/A';
console.log(`Precision: ${precision}%, Recall: ${recall}%`);

// Print mismatches in detail
if (mismatchCount > 0) {
    console.log('\n--- Mismatches ---');
    for (const r of results.filter(r => !r.match)) {
        console.log(`  ${r.name}: expected=${r.expected}, actual=${r.actual}${r.error ? ' [ERROR: ' + r.error + ']' : ''}`);
    }
}

// Save
const outputPath = path.join(__dirname, '..', 'docs', 'comparison_hapflow_vs_arkprism', 'hapbench_validation.json');
fs.writeFileSync(outputPath, JSON.stringify({
    timestamp: new Date().toISOString(),
    summary: { total: results.length, matches: matchCount, mismatches: mismatchCount, tp, fp, fn, tn, precision, recall },
    results
}, null, 2));
console.log(`\nResults saved to: ${outputPath}`);
