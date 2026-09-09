const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { cases, source } = require('../benchmarks/ArkBindingBench/cases');
const { evaluate } = require('./evaluate_binding_bench');
const root = path.resolve(__dirname, '..');
const buildRoot = path.resolve(process.env.ARKPRISM_BUILD_ROOT || root);
const { Scene, SceneConfig } = require(path.join(buildRoot, 'dist/arkanalyzer'));
const { readPrivacyApis } = require(path.join(buildRoot, 'dist/utils'));
const { analyzeFileForPrivacyApis } = require(path.join(buildRoot, 'dist/apiDetector'));
const { bindCatalogSources } = require(path.join(buildRoot, 'dist/hapflow/CatalogSourceBindings'));
const { TaintAnalysisChecker } = require(path.join(buildRoot, 'dist/hapflow/TaintAnalysis'));
const { TaintAnalysisSolver } = require(path.join(buildRoot, 'dist/hapflow/TaintAnalysisSolver'));
const { convertOutcome } = require(path.join(buildRoot, 'dist/hapflowRunner'));
const split = process.argv[2] || 'development';
const output = process.argv[3];
const sdk = process.env.OPENHARMONY_SDK_PATH;
if (!sdk || !output) throw new Error('Usage: OPENHARMONY_SDK_PATH=... node scripts/check_binding_continuations.js <split> <output.json>');
if (fs.existsSync(output)) throw new Error('Output exists');
const external = process.env.ARKPRISM_EXTERNAL_BENCHMARK;
const selected = external ? JSON.parse(fs.readFileSync(path.join(external, 'oracle.json'), 'utf8')).cases
  : cases.filter(c => (split === 'all' || c.split === split) && (!process.argv[4] || c.id === process.argv[4]));
const projects = external ? path.resolve(external) : path.join(root, 'benchmarks/ArkBindingBench/projects');
const files = selected.map(c => {
  const file = path.join(projects, c.id, c.sourceFile || 'entryability/EntryAbility.ets');
  if (external) {
    if (!fs.existsSync(file)) throw new Error('Source missing: ' + file);
    return file;
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (fs.existsSync(file) && fs.readFileSync(file, 'utf8') !== source(c)) throw new Error('Fixture changed: ' + c.id);
  if (!fs.existsSync(file)) fs.writeFileSync(file, source(c));
  return file;
});
const config = new SceneConfig();
config.buildConfig('ArkBindingBench', projects, [], files);
const scene = new Scene();
scene.buildBasicInfo(config);
scene.genArkFiles();
scene.inferTypes();
const rules = readPrivacyApis(path.join(buildRoot, 'config/sensitive_apis.json'));
const packages = [...new Set(rules.flatMap(p => [p.systemPackage, ...p.privacyApis.flatMap(a => a.packageAliases || [])]))];
const usages = scene.getFiles().flatMap(f => analyzeFileForPrivacyApis(f, packages, rules));
const catalog = bindCatalogSources(scene, usages, rules);
scene.buildSdk('@ohosSdk', sdk);
const result = {
  revision: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  buildRoot, sdk, split, external,
  mode: 'IR integration: separate onCreate entry and IFDS solver per case; one frontend scene. CLI experiments are recorded separately.',
  cases: selected.map(({body, helpers, imports, ...label}) => label), results: []
};
for (const c of selected) {
  const file = files[selected.indexOf(c)];
  const entry = scene.getMethods().find(m => m.getName() === 'onCreate' && path.resolve(m.getDeclaringArkFile().getFilePath()) === file);
  if (!entry) throw new Error('Entry not found: ' + c.id);
  const checker = new TaintAnalysisChecker(entry.getCfg().getStartingStmt(), entry);
  checker.setCatalogBindings(catalog);
  checker.addSinksFromJson(path.join(buildRoot, 'config/hapflow_sinks.json'), sdk);
  const bindings = new Map();
  const original = checker.createSourceFact;
  checker.createSourceFact = function(value, stmt, source) {
    const record = { value: value.toString(), type: source.sourceType, rule: source.rule,
      line: stmt.getOriginPositionInfo().getLineNo(), parameter: source.sourceIndex, callbackArgument: source.callbackIndex };
    bindings.set(JSON.stringify(record), record);
    return original.call(this, value, stmt, source);
  };
  const solver = new TaintAnalysisSolver(checker, scene);
  solver.setBudgetOptions({maxEdges:1000000, maxWorkList:1000000, maxMillis:60000});
  solver.solve();
  const flows = convertOutcome(checker.getOutcome(), 'ifds');
  const predicted = flows.length > 0;
  const row = {id:c.id, expected:c.expected, predicted, flowCorrect:predicted === c.expected,
    bindings:[...bindings.values()], flows,
    metadata:{ifds:solver.getStats()},
    unresolved:catalog.stats.unresolved.filter(u => u.file.replace(/\\/g, '/').includes(c.id + '/'))};
  result.results.push(row);
  if (process.env.ARKPRISM_BINDING_TRACE === '1') {
    row.edges = [...solver.getPathEdgeSet()].map(e => ({
      statement: e.edgeEnd.node.toString(), value: e.edgeEnd.fact.getValue().toString(),
      valueType: e.edgeEnd.fact.getValue().constructor.name,
      state: e.edgeEnd.fact.getCarrierState?.(), source: e.edgeEnd.fact.getSourceIdentityKey()
    }));
  }
  console.log(c.id, row.flowCorrect, flows.length);
}
result.evaluation = evaluate(result);
fs.mkdirSync(path.dirname(path.resolve(output)), {recursive:true});
fs.writeFileSync(output, JSON.stringify(result, null, 2));
console.log(result.evaluation.summary);
