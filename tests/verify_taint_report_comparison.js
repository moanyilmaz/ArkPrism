const assert = require('assert');

const {
  compareProject,
  endpointKey,
  exactPathKey,
} = require('../scripts/compare_taint_reports');

const baseFlow = {
  sourceApi: 'instanceinvoke source.get()',
  sourceFile: 'src/A.ets',
  sourceLine: 10,
  sinkApi: 'console.info',
  sinkFile: 'src/A.ets',
  sinkLine: 20,
  taintedValue: '%0',
  path: [
    { statement: '%0 = source.get()', file: 'src/A.ets', line: 10, method: 'run' },
    { statement: 'console.info(%0)', file: 'src/A.ets', line: 20, method: 'run' },
  ],
};
const alternatePath = {
  ...baseFlow,
  path: [
    baseFlow.path[0],
    { statement: '%1 = %0', file: 'src/A.ets', line: 15, method: 'run' },
    baseFlow.path[1],
  ],
};
const addedEndpoint = {
  ...baseFlow,
  sinkApi: 'network.send',
  sinkLine: 30,
};

assert.strictEqual(endpointKey(baseFlow), endpointKey(alternatePath));
assert.notStrictEqual(exactPathKey(baseFlow), exactPathKey(alternatePath));

const result = compareProject(
  'fixture',
  { report: { taintFlows: [baseFlow, alternatePath, addedEndpoint] } },
  { report: { taintFlows: [baseFlow] } },
);
assert.strictEqual(result.fullPositive, true);
assert.strictEqual(result.baselinePositive, true);
assert.strictEqual(result.fullUniqueEndpoints, 2);
assert.strictEqual(result.fullUniqueExactPaths, 3);
assert.strictEqual(result.fullDuplicateExactPaths, 0);
assert.strictEqual(result.addedEndpoints.length, 1);
assert.strictEqual(result.removedEndpoints.length, 0);
assert.strictEqual(result.addedExactPaths.length, 2);
assert.strictEqual(result.removedExactPaths.length, 0);

console.log('Taint report comparison verified.');
