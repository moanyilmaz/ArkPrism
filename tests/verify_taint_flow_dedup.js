const assert = require('assert');

const { deduplicateTaintFlows } = require('../dist/hapflowRunner');

const base = {
  provenance: 'ifds',
  sourceKind: 'privacy_data',
  sourceIdentity: {
    module: '@ohos.test',
    namespace: 'source',
    className: '',
    apiName: 'get',
    sourceType: 'return',
    sourceIndex: -1,
    callbackIndex: -1,
    methodSignature: 'source.get()',
    ruleOrigin: 'test',
  },
  sourceApi: 'source.get()',
  sourceFile: 'src/A.ets',
  sourceLine: 10,
  sinkApi: 'console.info()',
  sinkFile: 'src/A.ets',
  sinkLine: 20,
  taintedValue: '%0',
  path: [
    { statement: '%0 = source.get()', file: 'src/A.ets', line: 10, method: 'run' },
    { statement: 'console.info(%0)', file: 'src/A.ets', line: 20, method: 'run' },
  ],
};
const same = {
  ...JSON.parse(JSON.stringify(base)),
  provenance: 'async_supplement',
};
const distinctPath = {
  ...base,
  path: [
    base.path[0],
    { statement: '%1 = %0', file: 'src/A.ets', line: 15, method: 'run' },
    base.path[1],
  ],
};
const distinctSink = {
  ...base,
  sinkApi: 'network.send()',
  sinkLine: 30,
};

const unique = deduplicateTaintFlows([base, same, distinctPath, distinctSink]);
assert.strictEqual(unique.length, 3);
assert.strictEqual(unique[0], base);
assert.strictEqual(unique[0].provenance, 'both');
assert.strictEqual(unique[1], distinctPath);
assert.strictEqual(unique[2], distinctSink);

console.log('Taint flow deduplication verified.');
