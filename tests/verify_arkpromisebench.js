const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const benchmark = path.join(root, 'benchmarks', 'ArkPromiseBench');
const oracle = JSON.parse(fs.readFileSync(path.join(benchmark, 'oracle.json'), 'utf8'));

assert.strictEqual(oracle.schemaVersion, 3);
assert.strictEqual(oracle.cases.length, 24);
assert.strictEqual(oracle.cases.filter(item => item.expected).length, 7);
assert.strictEqual(oracle.cases.filter(item => !item.expected).length, 17);
assert.strictEqual(new Set(oracle.cases.map(item => item.id)).size, oracle.cases.length);

const requiredCategories = [
  'success-handler',
  'alias-identity',
  'handler-position',
  'sequential-chain',
  'promise-flattening',
  'promise-owner',
  'rejection-operator',
  'value-dependence',
  'sanitizer-return',
  'callback-execution',
];
for (const category of requiredCategories) {
  assert(oracle.cases.some(item => item.category === category), category);
}
for (const item of oracle.cases) {
  assert.strictEqual(typeof item.expected, 'boolean', item.id);
  assert.strictEqual(typeof item.oracleReason, 'string', item.id);
  assert.strictEqual(typeof item.boundaryOperator, 'string', item.id);
  assert(item.oracleReason.length >= 40, item.id);
  const source = path.join(benchmark, item.id, item.sourceFile);
  assert(fs.existsSync(source), source);
  assert(fs.readFileSync(source, 'utf8').includes('identifier.getOAID()'));
}

const ignoredCustomReturn = oracle.cases.find(item => item.id === 'custom_then_ignored_return');
assert(ignoredCustomReturn, 'custom_then_ignored_return');
assert.strictEqual(ignoredCustomReturn.category, 'promise-owner');

console.log('ArkPromiseBench oracle and source layout verified.');
