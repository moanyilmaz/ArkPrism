const assert = require('assert');
const path = require('path');
const fs = require('fs');
const { SceneConfig, Scene } = require('../dist/arkanalyzer');
const { getSceneFromJson, readPrivacyApis } = require('../dist/utils');
const { analyzeFileForPrivacyApis } = require('../dist/apiDetector');
const { bindCatalogSources } = require('../dist/hapflow/CatalogSourceBindings');
const { TaintAnalysisChecker } = require('../dist/hapflow/TaintAnalysis');
const { TaintAnalysisSolver } = require('../dist/hapflow/TaintAnalysisSolver');
const { Json2ArkMethodSignature, acceptsSourceArity, callSource } = require('../dist/hapflow/Util');
const { AnalysisWorklist } = require('../dist/hapflow/AnalysisWorklist');
const root = path.resolve(__dirname, '..');
const sdk = process.env.OPENHARMONY_SDK_PATH;
assert.ok(sdk && fs.existsSync(sdk), 'Set OPENHARMONY_SDK_PATH to an installed SDK');
const config = new SceneConfig();
config.buildFromProjectDir(path.join(__dirname, 'fixtures/catalog_taint'));
const scene = new Scene();
scene.buildBasicInfo(config);
scene.genArkFiles();
scene.inferTypes();
const rules = readPrivacyApis(path.join(root, 'config/sensitive_apis.json'));
const packages = [...new Set(rules.flatMap(p => [p.systemPackage, ...p.privacyApis.flatMap(a => a.packageAliases || [])]))];
const usages = scene.getFiles().flatMap(f => analyzeFileForPrivacyApis(f, packages, rules));
const bindings = bindCatalogSources(scene, usages, rules);
assert.ok(usages.length >= 8, `Expected sources in real IR, found ${usages.length}`);
assert.deepStrictEqual(bindings.stats.unresolved, []);
const settingUsage = usages.find(u => u.catalogApiSignature === 'settings.getValueSync');
const voidRules = rules.map(p => ({ ...p, privacyApis: p.privacyApis.map(a => ({ ...a,
  overloads: a.overloads?.map(o => ({ ...o, signature: o.signature.replace(/\):.*$/, '): Promise<void>') }))
})) }));
const voidBindings = bindCatalogSources(scene, [settingUsage], voidRules);
assert.strictEqual(voidBindings.stats.boundUsages, 0, 'Promise<void> has no sensitive result carrier');
assert.strictEqual(voidBindings.stats.unresolved.length, 1);
scene.buildSdk('@ohosSdk', sdk);
const sinks = JSON.parse(fs.readFileSync(path.join(root, 'config/hapflow_sinks.json')));
for (const rule of sinks) {
  assert.ok(Json2ArkMethodSignature(rule.module, rule.namespace, rule.class, rule.api_name, scene, rule.parameters).length,
    `Sink failed SDK resolution: ${JSON.stringify(rule)}`);
}
const sensor = Json2ArkMethodSignature('@ohos.sensor', 'sensor', '', 'on', scene)
  .find(s => s.toString().includes('PEDOMETER,') || s.toString().includes('PEDOMETER>'));
assert.ok(sensor, 'SDK pedometer overload');
assert.ok(acceptsSourceArity(sensor, 2));
assert.ok(acceptsSourceArity(sensor, 3));
assert.ok(!acceptsSourceArity(sensor, 1));
assert.ok(!acceptsSourceArity(sensor, 4));
const callbackMethod = scene.getMethods().find(m => m.getName() === 'sensorPositive');
const callbackStmts = [...callbackMethod.getCfg().getBlocks()].flatMap(b => b.getStmts());
const legacyChecker = new TaintAnalysisChecker(callbackStmts[0], callbackMethod);
legacyChecker.addSourcesFromJson(path.join(root, 'config/hapflow_sources.json'), sdk);
const callbackCall = callbackStmts.find(s => s.getInvokeExpr()?.getMethodSignature().getMethodSubSignature().getMethodName() === 'on').getInvokeExpr();
assert.strictEqual(callSource(callbackCall, legacyChecker.getSources(), scene)?.rule.catalogApiSignature,
  "sensor.on('SensorId.PEDOMETER')", 'Optional parameters must not select a different sensor overload');

const expected = { filePositive: true, fileDescriptorNegative: false, repeatedCallsPositive: true, fieldPositive: true, fieldKilled: false, settingsPositive: true,
  sensorPositive: true, sensorNegative: false, httpPositive: true,
  httpFactoryNegative: false, pasteboardErrorNegative: false };
for (const [name, positive] of Object.entries(expected)) {
  const method = scene.getMethods().find(m => m.getName() === name);
  assert.ok(method, name);
  const stmt = [...method.getCfg().getBlocks()][0].getStmts()[0];
  const checker = new TaintAnalysisChecker(stmt, method);
  checker.setCatalogBindings(bindings);
  checker.addSinksFromJson(path.join(root, 'config/hapflow_sinks.json'), sdk);
  const solver = new TaintAnalysisSolver(checker, scene);
  solver.setBudgetOptions({maxEdges:100000,maxWorkList:100000,maxMillis:30000});
  solver.solve();
  assert.ok(!solver.getStats().budgetExceeded, name + ' exhausted budget');
  console.log(name, checker.getOutcome().map(f => f.getPath().map(s => s.toString())));
  assert.strictEqual(checker.getOutcome().length > 0, positive, name);
  if (name === 'repeatedCallsPositive') assert.strictEqual(checker.getOutcome().length, 2, 'Both callers must receive the cached return flow');
}

// Compare scheduling against the previous array policy over a deterministic mixed workload.
const queue = new AnalysisWorklist();
const reference = [];
const deferred = new Set();
let seed = 17;
for (let i = 0; i < 20000; i++) {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  if (seed % 3 === 0 && reference.length) {
    const value = reference.shift();
    assert.strictEqual(queue.shift(), value);
    deferred.delete(value);
  } else {
    const later = seed % 2 === 0;
    const index = reference.findIndex(v => deferred.has(v));
    reference.splice(index < 0 ? reference.length : index, 0, i);
    if (later) { deferred.add(i); queue.defer(i); } else queue.push(i);
  }
  assert.strictEqual(queue.length, reference.length);
}
while (reference.length) assert.strictEqual(queue.shift(), reference.shift());

// Retain exact and same-method textual PTA matches without rescanning every edge.
const targets = ['filePositive', 'fieldPositive'].map(name => scene.getMethods().find(m => m.getName() === name));
let renders = 0;
const callsite = (name, method = callbackMethod) => ({
  toString: () => { renders++; return name; },
  getCfg: () => ({ getDeclaringMethod: () => method })
});
const sites = Array.from({ length: 500 }, (_, i) => callsite('call-' + i));
const edges = sites.map((stmt, i) => ({
  indirectCalls: new Set([stmt]), getDstNode: () => ({ getID: () => i % 2 })
}));
edges.push({ indirectCalls: new Set([callsite('call-0', targets[0])]), getDstNode: () => ({ getID: () => 1 }) });
const pta = { getCallGraph: () => ({
  getCallGraphNodeByMethod: () => ({ getOutgoingEdges: () => edges }),
  getMethodByFuncID: id => targets[id].getSignature()
}) };
const indexedSolver = new TaintAnalysisSolver(legacyChecker, scene, pta);
for (let i = 0; i < 200; i++) {
  const result = indexedSolver.getPointerResolvedCallees(callsite('call-0'), []);
  assert.deepStrictEqual([...result], [targets[0]], 'Textual matches must stay within the declaring method');
}
assert.deepStrictEqual([...indexedSolver.getPointerResolvedCallees(sites[1], [])], [targets[1]]);
assert.strictEqual(indexedSolver.getPointerResolvedCallees(sites[0], [targets[0]]).size, 0);
assert.ok(renders < 1000, `Expected indexed lookup, got ${renders} statement renderings`);
console.log('Catalog source binding, flow endpoints, SDK sinks, optional arguments and queue scheduling verified.');
