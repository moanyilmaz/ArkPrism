'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { synchronizeSources } = require('../scripts/synchronize_hapflow_sources');

const root = path.resolve(__dirname, '..');
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'config', 'sensitive_apis.json')));
const aliases = JSON.parse(fs.readFileSync(path.join(root, 'config', 'package_aliases.json')));
const sources = JSON.parse(fs.readFileSync(path.join(root, 'config', 'hapflow_sources.json')));
const audit = JSON.parse(fs.readFileSync(
  path.join(root, 'docs', 'rule_set_audit', 'ifds_source_catalog_sync.json'),
));

assert.strictEqual(sources.length, 166);
assert.ok(sources.every(source =>
  source.dataType && source.label && source.catalogApiSignature
));
const synchronized = synchronizeSources(catalog, aliases, sources);
assert.strictEqual(synchronized.retained.length, sources.length);
assert.deepStrictEqual(synchronized.removed, []);

assert.strictEqual(audit.beforeRows, 257);
assert.strictEqual(audit.retainedRows, 166);
assert.strictEqual(audit.removedRows, 91);

const removedMethods = new Set([
  'getDeviceCapability',
  'getSystemPasteboard',
  'getSensorList',
]);
assert.ok(sources.every(source => !removedMethods.has(source.api_name)));

const gyroscope = sources.find(source =>
  source.api_name === 'on' &&
  String(source.parameters?.[0]?.type).includes('SensorId.GYROSCOPE') &&
  !String(source.parameters?.[0]?.type).includes('UNCALIBRATED')
);
assert.ok(gyroscope);
assert.strictEqual(gyroscope.dataType, 'Device information');
assert.strictEqual(gyroscope.label, 'Gyroscope');

console.log('IFDS source catalog synchronization verified.');
