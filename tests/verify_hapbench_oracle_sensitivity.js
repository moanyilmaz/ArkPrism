const assert = require('assert');
const {
  STRICT_NEGATIVE_CASES,
  evaluateCases,
  exactTwoSidedMcNemar,
} = require('../scripts/analyze_hapbench_oracle_sensitivity');

const disputedCases = [...STRICT_NEGATIVE_CASES].map((id) => ({
  id,
  expected: true,
  predicted: false,
}));

const stableCases = [
  { id: 'positive', expected: true, predicted: true },
  { id: 'negative', expected: false, predicted: false },
];

const published = evaluateCases([...stableCases, ...disputedCases], false);
assert.deepStrictEqual(
  {
    tp: published.metrics.tp,
    tn: published.metrics.tn,
    fp: published.metrics.fp,
    fn: published.metrics.fn,
  },
  { tp: 1, tn: 1, fp: 0, fn: 3 },
);

const strict = evaluateCases([...stableCases, ...disputedCases], true);
assert.deepStrictEqual(
  {
    tp: strict.metrics.tp,
    tn: strict.metrics.tn,
    fp: strict.metrics.fp,
    fn: strict.metrics.fn,
  },
  { tp: 1, tn: 4, fp: 0, fn: 0 },
);

const first = [
  { id: 'a', expected: false, predicted: false },
  { id: 'b', expected: false, predicted: false },
  { id: 'c', expected: false, predicted: false },
];
const second = [
  { id: 'a', expected: false, predicted: true },
  { id: 'b', expected: false, predicted: true },
  { id: 'c', expected: false, predicted: true },
];
const paired = exactTwoSidedMcNemar(first, second);
assert.strictEqual(paired.firstOnlyCorrect, 3);
assert.strictEqual(paired.secondOnlyCorrect, 0);
assert.strictEqual(paired.pValue, 0.25);

console.log('HapBench oracle-sensitivity regression passed.');
