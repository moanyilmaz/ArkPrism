const assert = require('assert');
const {
  callbackAnalysisEnabled,
  continuationFlowDisabled,
  unrestrictedSdkCallbacksEnabled,
  validateRunConfiguration,
} = require('../scripts/evaluate_arkasyncbench');

function run(disableContinuationFlow, callbackAnalysis, unrestrictedSdkCallbacks = false) {
  return { disableContinuationFlow, callbackAnalysis, unrestrictedSdkCallbacks };
}

assert.strictEqual(callbackAnalysisEnabled({ execution: { arkArgs: [] } }), true);
assert.strictEqual(callbackAnalysisEnabled({
  execution: { arkArgs: ['--callback-analysis', 'false'] },
}), false);
assert.strictEqual(continuationFlowDisabled({
  execution: { disableContinuationFlow: true },
}), true);
assert.strictEqual(unrestrictedSdkCallbacksEnabled({
  execution: { unrestrictedSdkCallbacks: true },
}), true);
assert.strictEqual(continuationFlowDisabled({
  environment: { analysisFeatureFlags: { disableContinuationFlow: true } },
}), true);

assert.doesNotThrow(() => validateRunConfiguration(
  'continuation_off',
  run(false, false),
  run(true, false),
));
assert.doesNotThrow(() => validateRunConfiguration(
  'post_ifds',
  run(false, false),
  run(true, true),
));
assert.doesNotThrow(() => validateRunConfiguration(
  'callback_off',
  run(false, true),
  run(false, false),
));
assert.doesNotThrow(() => validateRunConfiguration(
  'unrestricted_sdk_callbacks',
  run(false, false),
  run(false, false, true),
));
assert.throws(() => validateRunConfiguration(
  'post_ifds',
  run(false, false),
  run(false, true),
), /incompatible flags/);
assert.throws(() => callbackAnalysisEnabled({
  execution: { arkArgs: ['--callback-analysis', 'sometimes'] },
}), /Invalid --callback-analysis/);

console.log('ArkAsyncBench evaluator configurations verified.');
