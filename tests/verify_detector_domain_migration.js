const assert = require('assert');

const { reclassify } = require('../scripts/reclassify_detector_domains');

const fixture = [
  {
    systemPackage: '@ohos.reminderAgent',
    privacyApis: [{
      namespace: 'reminderAgent',
      method: 'publishReminder',
      profilingCategory: 'network.bluetooth',
    }],
  },
  {
    systemPackage: '@kit.TelephonyKit',
    privacyApis: [{
      namespace: 'data',
      method: 'isCellularDataEnabled',
      profilingCategory: 'network.bluetooth',
    }],
  },
  {
    systemPackage: '@kit.ConnectivityKit',
    privacyApis: [{
      namespace: 'ble',
      method: 'startBLEScan',
      profilingCategory: 'network.bluetooth',
    }],
  },
];

const migrated = reclassify(fixture);
assert.strictEqual(
  migrated.output[0].privacyApis[0].profilingCategory,
  'user_data.notification',
);
assert.strictEqual(
  migrated.output[1].privacyApis[0].profilingCategory,
  'network.cellular',
);
assert.strictEqual(
  migrated.output[2].privacyApis[0].profilingCategory,
  'network.bluetooth',
);
assert.strictEqual(migrated.changes.length, 2);

console.log('Detector-domain migration verified.');
