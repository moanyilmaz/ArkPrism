'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { resolveAnalysisConfiguration: resolve } = require('../dist/analysisConfiguration');
const { AnalysisTimer } = require('../dist/analysisMetrics');
const { Scene, SceneConfig, CallGraph, ClassHierarchyAnalysis } = require('../dist/arkanalyzer');
const { buildTaintRta } = require('../dist/hapflow/callTargetAnalysis');
const { TaintAnalysisSolver } = require('../dist/hapflow/TaintAnalysisSolver');
const { TaintAnalysisChecker } = require('../dist/hapflow/TaintAnalysis');

assert.deepStrictEqual(resolve({}), { profile: 'precise', taintCallGraph: 'pta' });
assert.strictEqual(resolve({ analysisProfile: 'fast' }).taintCallGraph, 'rta');
assert.strictEqual(resolve({ taintCallGraph: 'rta' }).profile, 'fast');
assert.strictEqual(resolve({ noPta: true }).taintCallGraph, 'cha');
assert.strictEqual(resolve({ noPta: true, taintCallGraph: 'cha' }).taintCallGraph, 'cha');
for (const input of [
  { analysisProfile: '' }, { analysisProfile: 'typo' }, { taintCallGraph: 'anderson' },
  { analysisProfile: 'fast', taintCallGraph: 'pta' }, { noPta: true, taintCallGraph: 'rta' },
  { noPta: true, analysisProfile: 'precise' },
]) assert.throws(() => resolve(input));

const timer = new AnalysisTimer();
assert.strictEqual(timer.measure('example', () => 7), 7);
assert.throws(() => timer.measure('failure', () => { throw new Error('expected'); }), /expected/);
const metrics = timer.snapshot();
assert.ok(metrics.phaseTimingsMs.example >= 0 && metrics.phaseTimingsMs.failure >= 0);
assert.ok(metrics.totalAnalysisMs >= metrics.phaseTimingsMs.example);
assert.ok(metrics.cpuTimeMs.user >= 0 && metrics.processPeakRssBytes > 0);

const root = path.resolve(__dirname, '..');
const fixture = path.join(__dirname, 'fixtures/analysis_modes');
const config = new SceneConfig();
config.buildFromProjectDir(fixture);
const scene = new Scene();
scene.buildBasicInfo(config);
scene.genArkFiles();
scene.inferTypes();
const entry = scene.getMethods().find(m => m.getName() === 'onCreate');
const dispatch = scene.getMethods().find(m => m.getName() === 'dispatch');
const call = dispatch.getCfg().getStmts().find(s => s.getInvokeExpr()?.getMethodSignature().getMethodSubSignature().getMethodName() === 'send');
const rta = buildTaintRta(scene, entry);
const cha = new ClassHierarchyAnalysis(scene, new CallGraph(scene));
function targets(analysis) {
  const graph = analysis.getCallGraph();
  return analysis.resolveCall(graph.getCallGraphNodeByMethod(dispatch.getSignature()).getID(), call)
    .map(site => graph.getArkMethodByFuncID(site.calleeFuncID).getDeclaringArkClass().getName());
}
assert.ok(targets(rta).includes('ActiveChannel'), 'RTA must discover allocations inside reachable factories');
assert.ok(!targets(rta).includes('UnusedChannel'), 'RTA must filter uninstantiated implementations');
assert.ok(targets(cha).includes('UnusedChannel'), 'CHA control must retain the uninstantiated subtype');
const checker = new TaintAnalysisChecker(entry.getCfg().getStmts()[0], entry);
const solver = new TaintAnalysisSolver(checker, scene);
solver.CG = rta;
let resolutions = 0;
const resolveCall = rta.resolveCall.bind(rta);
rta.resolveCall = (...args) => { resolutions++; return resolveCall(...args); };
for (let i = 0; i < 100; i++) {
  const result = [...solver.getAllCalleeMethodsFromCG(call, [])].map(m => m.getDeclaringArkClass().getName());
  assert.deepStrictEqual(result, ['ActiveChannel']);
}
assert.strictEqual(resolutions, 1, 'Fixed-point RTA targets must be reused for repeated facts');

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'arkprism-modes-'));
try {
  for (const args of [['--analysis-profile'], ['--analysis-profile', 'wrong'], ['--taint-call-graph', 'wrong'], ['--analysis-profile', 'fast', '--no-pta']]) {
    const result = spawnSync(process.execPath, ['dist/arkprism.js', ...args], {
      cwd: root, encoding: 'utf8', env: { ...process.env, ARKPRISM_MAX_OLD_SPACE_SIZE_MB: '0' }
    });
    assert.notStrictEqual(result.status, 0);
    assert.match(result.stderr, /Missing value|Invalid analysis profile|Invalid taint call graph|legacy CHA mode/);
    assert.ok(!result.stdout.includes('[SCENE]'), 'Reject invalid modes before building a Scene');
  }
  const reports = [];
  for (const mode of ['pta', 'rta', 'cha']) {
    const output = path.join(temp, mode);
    const result = spawnSync(process.execPath, ['--max-old-space-size=12288', 'dist/arkprism.js', fixture,
      '--taint-call-graph', mode, '--output-dir', output, '--sdkPath', process.env.OPENHARMONY_SDK_PATH],
    { cwd: root, encoding: 'utf8', timeout: 180000, maxBuffer: 8 * 1024 * 1024 });
    assert.strictEqual(result.status, 0, `${mode}: ${result.error || result.stderr}\n${result.stdout}`);
    const report = JSON.parse(fs.readFileSync(path.join(output, 'analysis_modes', 'analysis_modes-arkprism-report.json')));
    reports.push(report);
    assert.strictEqual(report.analysisConfiguration.taintCallGraph, mode);
    assert.strictEqual(report.taintAnalysis.callGraph.algorithm, mode);
    assert.strictEqual(report.taintAnalysis.pointerAnalysis.requested, mode === 'pta');
    assert.strictEqual(report.taintAnalysis.status, 'SUCCESS');
    assert.strictEqual(report.taintAnalysis.ifds.budgetExceeded, false);
    assert.ok(report.performance.phaseTimingsMs.apiDetection >= 0);
    assert.ok(report.taintAnalysis.performance.phaseTimingsMs.ifds >= 0);
    assert.ok(report.taintFlows.some(f => f.sourceKind === 'privacy_data' && f.sinkApi.includes('.info()')),
      `${mode} must retain the source-to-log flow through the factory and virtual call`);
  }
  assert.deepStrictEqual(reports[0].privacyApiUsages, reports[1].privacyApiUsages);
  assert.deepStrictEqual(reports[0].privacyApiUsages, reports[2].privacyApiUsages);
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
console.log('Analysis modes, RTA allocation closure, strict CLI validation, API invariance and IFDS integration verified.');
