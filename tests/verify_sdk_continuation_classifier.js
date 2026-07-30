const assert = require('assert');

const {
  isArkUIFrameworkEventSignature,
} = require('../dist/hapflow/TaintAnalysis');
const {
  isPlatformTaskCallbackSignature,
  isPromiseTypeText,
  sdkContractsGuaranteePromise,
  sdkMethodArityMatches,
} = require('../dist/hapflow/SdkContinuationContracts');

assert.strictEqual(isArkUIFrameworkEventSignature('onClick', ''), true);
assert.strictEqual(isArkUIFrameworkEventSignature('onTouch', ''), true);
assert.strictEqual(isArkUIFrameworkEventSignature('onClick', 'AppHandlers'), false);
assert.strictEqual(isArkUIFrameworkEventSignature('storeCallback', ''), false);
assert.strictEqual(isArkUIFrameworkEventSignature('then', ''), false);

assert.strictEqual(isPlatformTaskCallbackSignature('setTimeout', '', 0), true);
assert.strictEqual(isPlatformTaskCallbackSignature('setInterval', '', 0), true);
assert.strictEqual(isPlatformTaskCallbackSignature('queueMicrotask', '', 0), true);
assert.strictEqual(isPlatformTaskCallbackSignature('setTimeout', '', 1), false);
assert.strictEqual(isPlatformTaskCallbackSignature('setTimeout', 'AppTimers', 0), false);
assert.strictEqual(isPlatformTaskCallbackSignature('storeCallback', '', 0), false);

assert.strictEqual(isPromiseTypeText('Promise<PermissionRequestResult>'), true);
assert.strictEqual(isPromiseTypeText('PermissionRequestResult | Promise<void>'), true);
assert.strictEqual(isPromiseTypeText('PromiseLike<Result>'), false);
assert.strictEqual(isPromiseTypeText('CustomPromise<Result>'), false);
assert.strictEqual(isPromiseTypeText('void'), false);

assert.strictEqual(sdkMethodArityMatches(2, 2, 2), true);
assert.strictEqual(sdkMethodArityMatches(2, 2, 3), true);
assert.strictEqual(sdkMethodArityMatches(2, 3, 3), false);
assert.strictEqual(sdkMethodArityMatches(4, 2, 3), false);
assert.strictEqual(sdkMethodArityMatches(8, 2, null), true);

const promiseAndCallbackOverloads = [
  { minArgs: 2, maxArgs: 2, returnsPromise: true },
  { minArgs: 3, maxArgs: 3, returnsPromise: false },
];
assert.strictEqual(sdkContractsGuaranteePromise(2, promiseAndCallbackOverloads), true);
assert.strictEqual(sdkContractsGuaranteePromise(3, promiseAndCallbackOverloads), false);
assert.strictEqual(sdkContractsGuaranteePromise(1, promiseAndCallbackOverloads), false);
assert.strictEqual(sdkContractsGuaranteePromise(2, [
  { minArgs: 2, maxArgs: 3, returnsPromise: true },
  { minArgs: 2, maxArgs: 2, returnsPromise: false },
]), false);

console.log('SDK continuation edge classification verified.');
