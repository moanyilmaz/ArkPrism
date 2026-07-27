const assert = require('assert');
const {
  diversitySelect,
  normalizeSourceIdentity,
  pathLengthBin,
  sinkFamily,
} = require('../scripts/select_semantic_path_audit');

assert.strictEqual(pathLengthBin(1), 'short_1_3');
assert.strictEqual(pathLengthBin(4), 'medium_4_7');
assert.strictEqual(pathLengthBin(8), 'long_8_plus');
assert.strictEqual(sinkFamily('instanceinvoke hilog.<x: .info()>(v)'), 'logging');
assert.strictEqual(sinkFamily('instanceinvoke promptAction.<x: .showToast()>(v)'), 'ui');
assert.strictEqual(sinkFamily('instanceinvoke http.<x: .sendRequest()>(v)'), 'network');
const sourceIdentity = normalizeSourceIdentity({
  module: '@ohos.identifier.oaid',
  namespace: 'identifier',
  className: '',
  apiName: 'getOAID',
  sourceType: 'return',
  sourceIndex: -1,
  callbackIndex: -1,
  methodSignature: '@sdk: identifier.getOAID()',
  ruleOrigin: 'typed_privacy_source_inventory',
});
assert.strictEqual(sourceIdentity.apiName, 'getOAID');
assert.throws(
  () => normalizeSourceIdentity({ apiName: 'getOAID' }, 'fixture'),
  /sourceIdentity\.module/,
);

const candidates = [
  ['a', 'ifds', 'logging', 'short_1_3', 'p1'],
  ['b', 'ifds', 'logging', 'short_1_3', 'p2'],
  ['c', 'async_supplement', 'logging', 'medium_4_7', 'p3'],
  ['d', 'ifds', 'ui', 'long_8_plus', 'p4'],
].map(([id, provenance, family, length, project]) => ({
  id,
  provenance,
  sinkFamily: family,
  pathLengthBin: length,
  project,
  stratum: `privacy_data|${provenance}|${family}|${length}`,
}));
const selected = diversitySelect(candidates, 3, 'fixed-seed');
assert.strictEqual(selected.length, 3);
assert.strictEqual(new Set(selected.map((item) => item.id)).size, 3);
assert(selected.some((item) => item.provenance === 'async_supplement'));
assert(selected.some((item) => item.sinkFamily === 'ui'));
assert.deepStrictEqual(
  diversitySelect(candidates, 3, 'fixed-seed').map(item => item.id),
  selected.map(item => item.id),
);

console.log('Semantic path-audit queue selection verified.');
