const assert = require('assert');
const { Local } = require('../dist/arkanalyzer');
const { TaintFact } = require('../dist/hapflow/TaintFact');
const {
  TaintOutcomeEqual,
  ValueDependsOn,
} = require('../dist/hapflow/Util');
const { shouldPropagateErrorPayload } = require('../dist/hapflow/TaintAnalysis');

const temporary8 = new Local('%8');
const temporary85 = new Local('%85');

assert.strictEqual(ValueDependsOn(temporary8, temporary8), true);
assert.strictEqual(ValueDependsOn(temporary85, temporary8), false);

const nested = {
  getUses: () => [{
    getUses: () => [temporary8],
  }],
};
assert.strictEqual(ValueDependsOn(nested, temporary8), true);

const cyclic = {
  getUses: () => [cyclic],
};
assert.strictEqual(ValueDependsOn(cyclic, temporary8), false);
assert.strictEqual(shouldPropagateErrorPayload(true, [temporary8], temporary8), false);
assert.strictEqual(shouldPropagateErrorPayload(false, [temporary85], temporary8), false);
assert.strictEqual(shouldPropagateErrorPayload(false, [temporary8], temporary8), true);

const sourceA = {};
const sourceB = {};
const sink = {};
const first = new TaintFact(temporary8);
first.addPath(sourceA);
first.addPath(sink);
const exactDuplicate = new TaintFact(temporary8);
exactDuplicate.addPath(sourceA);
exactDuplicate.addPath(sink);
const differentSource = new TaintFact(temporary8);
differentSource.addPath(sourceB);
differentSource.addPath(sink);
const differentValue = new TaintFact(temporary85);
differentValue.addPath(sourceA);
differentValue.addPath(sink);

assert.strictEqual(TaintOutcomeEqual(first, exactDuplicate), true);
assert.strictEqual(TaintOutcomeEqual(first, differentSource), false);
assert.strictEqual(TaintOutcomeEqual(first, differentValue), false);

console.log('Structured taint value-dependency regression passed.');
