/**
 * Run HapBench with HapFlow-native configuration.
 * Mirrors the original HapFlow BenchTest.ts exactly:
 *   - Flat DummyMain (no lifecycle)
 *   - PTA k=1
 *   - HapFlow original sources.json + sinks.json
 *   - scene.inferTypes()
 *   - No callback analysis, no lifecycle
 */
const { execSync } = require('child_process');
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
            const entryAbility = path.join(subDir, 'entryability', 'EntryAbility.ets');
            if (fs.existsSync(entryAbility)) {
                testDirs.push({
                    name: category ? `${category}/${entry.name}` : entry.name,
                    dir: subDir,
                });
            } else {
                findTestDirs(subDir, category ? `${category}/${entry.name}` : entry.name);
            }
        }
    }
}
findTestDirs(HAPBENCH_DIR);
console.log(`Found ${testDirs.length} test directories`);

// Write single-test runner that matches HapFlow original exactly
const RUNNER = path.join(__dirname, 'run_hapbench_native_single.js');
const runnerScript = `
const { Scene, SceneConfig, DummyMainCreater, PointerAnalysis, PointerAnalysisConfig } = require('../dist/arkanalyzer');
const { TaintAnalysisChecker } = require('../dist/hapflow/TaintAnalysis');
const { TaintAnalysisSolver } = require('../dist/hapflow/TaintAnalysisSolver');

const projectDir = process.argv[2];
const sdkPath = process.argv[3];

const sdks = [{ name: "ohosSdk", path: sdkPath, moduleName: "" }];

const config = new SceneConfig();
config.buildConfig(projectDir, projectDir, sdks);
config.buildFromProjectDir(projectDir);
const scene = new Scene();
scene.buildSceneFromProjectDir(config);
scene.inferTypes();

const creater = new DummyMainCreater(scene);
creater.createDummyMain();
const dummyMain = creater.getDummyMain();

const ptaConfig = PointerAnalysisConfig.create(1, "./out");
const pta = PointerAnalysis.pointerAnalysisForWholeProject(scene, ptaConfig);

const problem = new TaintAnalysisChecker(
    [...dummyMain.getCfg().getBlocks()][0].getStmts()[dummyMain.getParameters().length],
    dummyMain,
    pta
);
problem.addSinksFromJson("D:/Projects/Argus-0703/hapflow_artifact/hapflow/tests/resources/sinks.json");
problem.addSourcesFromJson("D:/Projects/Argus-0703/hapflow_artifact/hapflow/tests/resources/sources.json");

const solver = new TaintAnalysisSolver(problem, scene, pta);
solver.solve();

const outcome = problem.getOutcome();
console.log(JSON.stringify({ taintFlows: outcome.length }));
`;
fs.writeFileSync(RUNNER, runnerScript);

// Run each test in a child process
const results = [];
let tp = 0, fp = 0, fn = 0, tn = 0;
let matchCount = 0;
let mismatchCount = 0;

for (const test of testDirs) {
    const expectedFlows = groundTruth.get(test.name) ?? -1;

    try {
        const output = execSync(
            `node "${RUNNER}" "${test.dir}" "${SDK_PATH}"`,
            { timeout: 300000, maxBuffer: 10 * 1024 * 1024, stdio: ['pipe', 'pipe', 'pipe'] }
        );
        const stdout = output.toString().trim();
        const lines = stdout.split('\n');
        let jsonLine = '';
        for (let i = lines.length - 1; i >= 0; i--) {
            try { JSON.parse(lines[i]); jsonLine = lines[i]; break; } catch {}
        }

        const actualFlows = jsonLine ? JSON.parse(jsonLine).taintFlows : -1;
        const match = actualFlows === expectedFlows;

        if (match) {
            matchCount++;
        } else {
            mismatchCount++;
            console.log(`[MISMATCH] ${test.name}: expected=${expectedFlows}, actual=${actualFlows}`);
        }

        if (expectedFlows > 0 && actualFlows > 0) {
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

        results.push({ name: test.name, expected: expectedFlows, actual: actualFlows, match });
    } catch (e) {
        console.log(`[ERROR] ${test.name}: ${e.message?.substring(0, 100)}`);
        if (expectedFlows > 0) fn += expectedFlows;
        results.push({ name: test.name, expected: expectedFlows, actual: -1, match: false, error: e.message?.substring(0, 80) });
    }
}

// Print results
console.log(`\n${'='.repeat(80)}`);
console.log('HapBench: ArkPrism (HapFlow-native config) vs Ground Truth');
console.log('  Config: flat DummyMain, PTA k=1, HapFlow sources+sinks, inferTypes()');
console.log(`${'='.repeat(80)}`);
console.log(`Tests: ${results.length}, Matches: ${matchCount}, Mismatches: ${mismatchCount}`);
console.log(`Exact match rate: ${(matchCount / results.length * 100).toFixed(1)}%`);
console.log(`TP=${tp}, FP=${fp}, FN=${fn}, TN=${tn}`);
const precision = tp + fp > 0 ? (tp / (tp + fp) * 100).toFixed(1) : 'N/A';
const recall = tp + fn > 0 ? (tp / (tp + fn) * 100).toFixed(1) : 'N/A';
console.log(`Precision: ${precision}%, Recall: ${recall}%`);

if (mismatchCount > 0) {
    console.log('\n--- Mismatches ---');
    for (const r of results.filter(r => !r.match)) {
        console.log(`  ${r.name}: expected=${r.expected}, actual=${r.actual}${r.error ? ' [ERROR]' : ''}`);
    }
}

// Save
const outputPath = path.join(__dirname, '..', 'docs', 'comparison_hapflow_vs_arkprism', 'hapbench_native_validation.json');
fs.writeFileSync(outputPath, JSON.stringify({
    timestamp: new Date().toISOString(),
    config: 'HapFlow-native: flat DummyMain, PTA k=1, HapFlow sources+sinks, inferTypes()',
    summary: { total: results.length, matches: matchCount, mismatches: mismatchCount, tp, fp, fn, tn, precision, recall },
    results
}, null, 2));
console.log(`\nResults saved to: ${outputPath}`);

// Cleanup
try { fs.unlinkSync(RUNNER); } catch {}
