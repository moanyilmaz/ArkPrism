const assert = require('assert');
const {
  callbackMethodSignatureMatches,
} = require('../dist/hapflow/TaintAnalysis');

function signature(text) {
  return { toString: () => text };
}

const callbackSignature = signature('@P/Index.ets: Page.%AM0$build(unknown)');
const callbackMethod = { getSignature: () => callbackSignature };
const independentlyResolvedMethod = { getSignature: () => callbackSignature };

assert.strictEqual(
  callbackMethodSignatureMatches(callbackSignature, callbackMethod, callbackMethod),
  true,
  'the canonical callback object must remain accepted',
);
assert.strictEqual(
  callbackMethodSignatureMatches(callbackSignature, callbackMethod, independentlyResolvedMethod),
  true,
  'equivalent callback objects must be matched by canonical method signature',
);
assert.strictEqual(
  callbackMethodSignatureMatches(signature('@P/Index.ets: Page.%AM1$build(unknown)'), callbackMethod),
  false,
  'a different callback signature must remain rejected',
);

console.log('SDK callback identity matching verified.');
