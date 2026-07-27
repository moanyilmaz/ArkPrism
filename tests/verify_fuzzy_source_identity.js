const assert = require('assert');
const { acceptFuzzySourceRule } = require('../dist/hapflow/Util');

const geoRule = {
  module: '@ohos.geoLocationManager',
  namespace: 'geoLocationManager',
  apiName: 'on',
  parameterTypes: [
    '"locationChange"',
    'LocationRequest',
    'Callback<Location>'
  ]
};

assert.strictEqual(
  acceptFuzzySourceRule('on', geoRule, {
    receiverTexts: ['unknown', '%4'],
    firstArgument: "'locationChange'"
  }),
  false,
  'a generic event method must not match without receiver/package evidence'
);

assert.strictEqual(
  acceptFuzzySourceRule('on', geoRule, {
    receiverTexts: ['geoLocationManager', 'unknown'],
    firstArgument: "'locationChange'"
  }),
  true,
  'a namespace receiver and matching event literal should be accepted'
);

assert.strictEqual(
  acceptFuzzySourceRule('on', geoRule, {
    receiverTexts: ['geoLocationManager'],
    firstArgument: "'stateChange'"
  }),
  false,
  'a different event overload must not match'
);

assert.strictEqual(
  acceptFuzzySourceRule('on', {
    module: '@ohos.sensor',
    namespace: 'sensor',
    apiName: 'on',
    parameterTypes: ['SensorId.ACCELEROMETER', 'Callback<AccelerometerResponse>']
  }, {
    receiverTexts: ['sensor']
  }),
  true,
  'enum-dispatched events may use a strong namespace witness'
);

assert.strictEqual(
  acceptFuzzySourceRule('create', {
    module: '@kit.AccountKit',
    className: 'AuthenticationController',
    apiName: 'create'
  }, {
    receiverTexts: ['unknown', '%1']
  }),
  false,
  'generic manager methods require receiver identity'
);

assert.strictEqual(
  acceptFuzzySourceRule('fetchMetadata', {
    module: '@kit.MediaKit',
    className: 'AVMetadataExtractor',
    apiName: 'fetchMetadata'
  }, {
    receiverTexts: ['unknown', '%11']
  }),
  true,
  'non-generic members retain existing fuzzy resolution behavior'
);

console.log('Fuzzy source-identity regression passed.');
