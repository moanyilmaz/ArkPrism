const assert = require('assert');
const { LexicalEnvType } = require('../dist/arkanalyzer');
const { getParameterInstanceForArgument } = require('../dist/hapflow/TaintAnalysis');

function method(parameters, instances) {
  return {
    getParameters: () => parameters,
    getParameterInstances: () => instances
  };
}

const direct = method(
  [{ getType: () => ({}) }, { getType: () => ({}) }],
  ['first', 'second']
);
assert.strictEqual(getParameterInstanceForArgument(direct, 0), 'first');
assert.strictEqual(getParameterInstanceForArgument(direct, 1), 'second');
assert.strictEqual(getParameterInstanceForArgument(direct, 2), undefined);

const lexicalType = new LexicalEnvType({}, []);
const closure = method(
  [{ getType: () => lexicalType }, { getType: () => ({}) }],
  ['lexical-env', 'explicit']
);
assert.strictEqual(getParameterInstanceForArgument(closure, 0), 'explicit');
assert.strictEqual(getParameterInstanceForArgument(closure, 1), undefined);
assert.strictEqual(getParameterInstanceForArgument(closure, -1), undefined);

console.log('IFDS argument-to-parameter mapping verified.');
