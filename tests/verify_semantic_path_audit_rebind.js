const assert = require('assert');
const {
  matchRecords,
  stablePathKey,
} = require('../scripts/rebind_semantic_path_audit');

function record(overrides = {}) {
  return {
    id: 'old-id',
    project: 'P',
    sourceKind: 'privacy_data',
    provenance: 'async_supplement',
    analysisDerivations: [],
    carrierState: null,
    sourceIdentity: {
      module: '@ohos.identifier.oaid',
      namespace: 'identifier',
      className: '',
      apiName: 'getOAID',
      sourceType: 'return',
      sourceIndex: -1,
      callbackIndex: -1,
    },
    sourceApi: 'p = getOAID()',
    sourceFile: 'entry/Index.ets',
    sourceFileSha256: 'source-hash',
    sourceLine: 10,
    sinkApi: 'hilog.info(v)',
    sinkFile: 'entry/Index.ets',
    sinkFileSha256: 'source-hash',
    sinkLine: 12,
    path: [
      { statement: 'p = getOAID()', file: 'entry/Index.ets', line: 10, method: 'f' },
      { statement: 'hilog.info(v)', file: 'entry/Index.ets', line: 12, method: 'cb' },
    ],
    ...overrides,
  };
}

const previous = record();
const current = record({
  id: 'new-id',
  provenance: 'both',
  analysisDerivations: ['promise_then'],
  carrierState: 'callback_payload',
  report: 'P/P-arkprism-report.json',
  reportSha256: 'report-hash',
  flowIndex: 0,
});
assert.strictEqual(stablePathKey(previous), stablePathKey(current));
const [match] = matchRecords([previous], [current]);
assert.strictEqual(match.provenanceChanged, true);
assert.strictEqual(match.derivationsChanged, true);
assert.strictEqual(match.carrierStateChanged, true);

assert.throws(() => matchRecords([previous], []), /found 0/);
assert.throws(() => matchRecords([previous], [current, { ...current, id: 'duplicate' }]), /found 2/);
assert.throws(
  () => matchRecords([previous], [{ ...current, sourceFileSha256: 'changed' }]),
  /sourceFileSha256 changed/,
);

console.log('Semantic path-audit exact rebind verified.');
