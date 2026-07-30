const assert = require('assert');

const {
  isArkUIFrameworkEventSignature,
} = require('../dist/hapflow/TaintAnalysis');

assert.strictEqual(isArkUIFrameworkEventSignature('onClick', ''), true);
assert.strictEqual(isArkUIFrameworkEventSignature('onTouch', ''), true);
assert.strictEqual(isArkUIFrameworkEventSignature('onClick', 'AppHandlers'), false);
assert.strictEqual(isArkUIFrameworkEventSignature('storeCallback', ''), false);
assert.strictEqual(isArkUIFrameworkEventSignature('then', ''), false);

console.log('SDK continuation edge classification verified.');
