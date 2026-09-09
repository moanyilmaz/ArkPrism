const fs = require('fs');
const path = require('path');
const { spawnSync, execFileSync } = require('child_process');
const { cases, source } = require('../benchmarks/ArkBindingBench/cases');
const { bindingCorrect } = require('./evaluate_binding_bench');
const root = path.resolve(__dirname, '..');

function argument(name, fallback) {
  const index = process.argv.indexOf(name);
  return index < 0 ? fallback : process.argv[index + 1];
}
const split = argument('--split', 'development');
const output = path.resolve(argument('--output', 'experiments/binding_run'));
const sdk = argument('--sdk', process.env.OPENHARMONY_SDK_PATH || 'E:/OpenHarmony_SDK/20/ets');
const only = argument('--case', '');
const buildRoot = path.resolve(argument('--engine-root', root));
const supplementary = argument('--supplementary', 'false');
if (!['true', 'false'].includes(supplementary)) throw new Error('--supplementary must be true or false');
const external = process.env.ARKPRISM_EXTERNAL_BENCHMARK;
const selected = external ? JSON.parse(fs.readFileSync(path.join(external,'oracle.json'),'utf8')).cases.filter(c => !only || c.id === only)
  : cases.filter(c => (split === 'all' || c.split === split) && (!only || c.id === only));
if (!selected.length) throw new Error('No matching cases');
if (fs.existsSync(output)) throw new Error(`Output already exists: ${output}`);
fs.mkdirSync(output, { recursive: true });
const manifest = {
  revision: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  engineRevision: argument('--engine-revision', buildRoot === root
    ? execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim() : null),
  trackedChanges: execFileSync('git', ['diff', '--name-only'], { cwd: root, encoding: 'utf8' }).trim().split(/\r?\n/).filter(Boolean),
  started: new Date().toISOString(), split, sdk, supplementary: supplementary === 'true',
  buildRoot, external,
  featureFlags: {
    disableContinuationFlow: process.env.ARKPRISM_DISABLE_CONTINUATION_FLOW === '1',
    unrestrictedSdkCallbacks: process.env.ARKPRISM_UNRESTRICTED_SDK_CALLBACKS === '1'
  },
  sourceRules: 'config/sensitive_apis.json',
  cases: selected.map(({ body, imports, helpers, ...label }) => label),
  results: []
};
function save() {
  fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify(manifest, null, 2));
}
save();
for (const testCase of selected) {
  const project = external ? path.join(path.resolve(external),testCase.id)
    : path.join(root, 'benchmarks', 'ArkBindingBench', 'projects', testCase.id);
  const file = path.join(project, 'entryability', 'EntryAbility.ets');
  if (!external) {
    const text = source(testCase);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    if (fs.existsSync(file) && fs.readFileSync(file, 'utf8') !== text) {
      throw new Error(`Existing source differs from the fixed case: ${testCase.id}`);
    }
    if (!fs.existsSync(file)) fs.writeFileSync(file, text);
  }
  const observations = path.join(output, `${testCase.id}-bindings.json`);
  const args = ['--max-old-space-size=8192', 'scripts/observe_binding_run.js', project,
    '--output-dir', output, '--sdkPath', sdk, '--no-dot', '--no-pta',
    '--callback-analysis', supplementary, '--ifds-timeout-ms', '300000'];
  const start = Date.now();
  const child = spawnSync(process.execPath, args, {
    cwd: root, encoding: 'utf8', windowsHide: true, timeout: 600000,
    maxBuffer: 32 * 1024 * 1024,
    env: { ...process.env, ARKPRISM_MAX_OLD_SPACE_SIZE_MB: '8192',
      ARKPRISM_BINDING_OBSERVATIONS: observations, ARKPRISM_BUILD_ROOT: buildRoot }
  });
  fs.writeFileSync(path.join(output, `${testCase.id}.log`), (child.stdout || '') + (child.stderr || ''));
  const reportFile = path.join(output, testCase.id, `${testCase.id}-arkprism-report.json`);
  const result = { id: testCase.id, expected: testCase.expected, elapsedMs: Date.now() - start, status: child.status };
  if (child.status !== 0 || !fs.existsSync(reportFile) || !fs.existsSync(observations)) {
    result.error = child.error?.message || 'Analysis failed or output missing';
  } else {
    const report = JSON.parse(fs.readFileSync(reportFile, 'utf8'));
    const observed = JSON.parse(fs.readFileSync(observations, 'utf8'));
    const privacy = observed.bindings.filter(b => b.rule.sourceKind === 'privacy_data');
    const flows = (report.taintFlows || []).filter(f => f.sourceKind === 'privacy_data');
    result.metadata = report.taintAnalysis;
    result.flows = flows.length;
    result.predicted = flows.length > 0;
    result.flowCorrect = result.predicted === testCase.expected;
    result.bindings = privacy;
    const expected = testCase.binding;
    result.bindingCorrect = bindingCorrect(expected, privacy);
  }
  manifest.results.push(result);
  save();
  console.log(`${testCase.id}: flow=${result.flowCorrect}, binding=${result.bindingCorrect}, seconds=${(result.elapsedMs / 1000).toFixed(1)}${result.error ? ', ' + result.error : ''}`);
}
manifest.finished = new Date().toISOString();
manifest.summary = {
  cases: selected.length,
  failures: manifest.results.filter(r => r.error).length,
  correctFlows: manifest.results.filter(r => r.flowCorrect).length,
  correctBindings: manifest.results.filter(r => r.bindingCorrect).length
};
save();
console.log(JSON.stringify(manifest.summary));
