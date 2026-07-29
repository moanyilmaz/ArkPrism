const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const benchmark = path.join(root, 'benchmarks', 'ArkPromiseBench');
const oracle = JSON.parse(fs.readFileSync(path.join(benchmark, 'oracle.json'), 'utf8'));

assert.strictEqual(oracle.schemaVersion, 2);
assert.strictEqual(oracle.cases.length, 17);
assert.strictEqual(oracle.cases.filter(item => item.expected).length, 6);
assert.strictEqual(oracle.cases.filter(item => !item.expected).length, 11);
assert.strictEqual(new Set(oracle.cases.map(item => item.id)).size, oracle.cases.length);

const requiredCategories = [
  'success-handler',
  'alias-identity',
  'handler-position',
  'sequential-chain',
  'promise-flattening',
  'promise-owner',
  'custom-return-semantics',
  'rejection-operator',
  'value-dependence',
  'sanitizer-return',
];
for (const category of requiredCategories) {
  assert(oracle.cases.some(item => item.category === category), category);
}
for (const item of oracle.cases) {
  assert.strictEqual(typeof item.expected, 'boolean', item.id);
  assert.strictEqual(typeof item.oracleReason, 'string', item.id);
  assert(item.oracleReason.length >= 40, item.id);
  const source = path.join(benchmark, item.id, item.sourceFile);
  assert(fs.existsSync(source), source);
  assert(fs.readFileSync(source, 'utf8').includes('identifier.getOAID()'));
}

console.log('ArkPromiseBench oracle and source layout verified.');
