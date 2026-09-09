const assert = require('assert');
const path = require('path');
const { Scene, SceneConfig } = require('../dist/arkanalyzer');
const { readPrivacyApis } = require('../dist/utils');
const { analyzeFileForPrivacyApis } = require('../dist/apiDetector');
const { bindCatalogSources } = require('../dist/hapflow/CatalogSourceBindings');
const { TaintAnalysisChecker } = require('../dist/hapflow/TaintAnalysis');

const directory = path.join(__dirname, 'fixtures/catalog_binding');
const config = new SceneConfig();
config.buildFromProjectFiles('catalog_binding', directory, [path.join(directory, 'Index.ets')]);
const scene = new Scene();
scene.buildBasicInfo(config);
scene.genArkFiles();
scene.inferTypes();
const rules = readPrivacyApis(path.join(__dirname, '../config/sensitive_apis.json'));
const usages = scene.getFiles().flatMap(file => analyzeFileForPrivacyApis(file, rules.map(p => p.systemPackage), rules));
const bindings = bindCatalogSources(scene, usages, rules);
const sensorRules = rules.flatMap(p => p.privacyApis).filter(a => a.catalogApiSignature?.startsWith("sensor.on('SensorId."));
assert.strictEqual(usages.length, 5 + sensorRules.length);
assert.deepStrictEqual(bindings.stats.unresolved, []);
const expected = { networkCallback: 'callback', networkPromise: 'return', accountCallback: 'callback',
  accountPromise: 'return', thumbnailAlias: 'return' };
for (const [stmt, sources] of bindings.statements) {
  if (stmt.getCfg().getDeclaringMethod().getName() === 'dynamicSensor') {
    assert.strictEqual(sources.length, sensorRules.length);
    const checker = new TaintAnalysisChecker(stmt, stmt.getCfg().getDeclaringMethod());
    checker.setCatalogBindings(bindings);
    const callback = scene.getMethod(stmt.getInvokeExpr().getArgs()[1].getType().getMethodSignature());
    const facts = new Set();
    checker.addTaintFromSourceCall(stmt, callback, facts);
    assert.strictEqual(facts.size, sensorRules.length);
    assert.strictEqual(new Set([...facts].map(f => f.getSourceIdentityKey())).size, sensorRules.length);
    assert.deepStrictEqual(new Set([...facts].map(f => f.getSourceEvidence().rule.catalogApiSignature)),
      new Set(sensorRules.map(r => r.catalogApiSignature)));
    continue;
  }
  assert.strictEqual(sources.length, 1);
  const source = sources[0];
  const name = stmt.getCfg().getDeclaringMethod().getName();
  assert.strictEqual(source.sourceType, expected[name], name);
  if (source.sourceType === 'callback') {
    assert.strictEqual(source.sourceIndex, 1, name);
    assert.strictEqual(source.callbackIndex, 0, name);
  } else assert.match(source.rule.returnType, /^Promise</, name);
  delete expected[name];
}
assert.deepStrictEqual(expected, {});
const wrongPackage = usages.map(u => ({ ...u, apiPackage: '@application/photos' }));
assert.strictEqual(bindCatalogSources(scene, wrongPackage, rules).stats.boundUsages, 0);
console.log('Catalog aliases, overload carriers and distinct dynamic-event source identities verified.');
