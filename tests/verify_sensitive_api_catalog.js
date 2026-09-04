'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { normalizeSensitiveApiCatalog } = require('../dist/sensitiveApiCatalog');

const catalogPath = path.resolve(__dirname, '..', 'config', 'sensitive_apis.json');
const bytes = fs.readFileSync(catalogPath);
const raw = JSON.parse(bytes.toString('utf8'));

assert.strictEqual(
  crypto.createHash('sha256').update(bytes).digest('hex').toUpperCase(),
  'DDE9AE33009A5C0F2ED060B59265FE33106C816BDB43075BE9C0FFDE6A00A3E4',
  'reviewed catalog bytes changed',
);
assert.strictEqual(raw.length, 295);
assert.strictEqual(new Set(raw.map(record => record.import_kit)).size, 24);

const requiredFields = [
  'import_kit',
  'api_signature',
  'call_catagory',
  'descrip0',
  'dataType',
  'label',
];
for (const [index, record] of raw.entries()) {
  for (const field of requiredFields) {
    assert.ok(String(record[field] || '').trim(), `row ${index} is missing ${field}`);
  }
}

const mappings = new Map();
for (const record of raw) {
  const key = `${record.import_kit}|${record.api_signature}`.toLowerCase();
  if (!mappings.has(key)) mappings.set(key, new Set());
  mappings.get(key).add(`${record.dataType}|${record.label}`);
}
assert.deepStrictEqual(
  [...mappings.entries()].filter(([, values]) => values.size > 1),
  [],
  'one API identity maps to multiple PAC classifications',
);

const groups = normalizeSensitiveApiCatalog(raw);
const rules = groups.flatMap(group => group.privacyApis);
assert.strictEqual(groups.length, 24);
assert.strictEqual(rules.length, 172);
assert.deepStrictEqual(
  rules.reduce((counts, rule) => {
    const kind = rule.directCall === true ? 'direct' : rule.directCall === false ? 'indirect' : 'property';
    counts[kind] = (counts[kind] || 0) + 1;
    return counts;
  }, {}),
  { direct: 115, indirect: 41, property: 16 },
);
assert.ok(rules.every(rule => rule.dataType && rule.label && rule.catalogApiSignature));

const sensorRules = rules.filter(rule => rule.catalogApiSignature.startsWith('sensor.on('));
assert.ok(sensorRules.length > 1);
assert.ok(sensorRules.every(rule => /^on\(['"]SensorId\./.test(rule.method)));
assert.ok(new Set(sensorRules.map(rule => rule.label)).size > 1);

const movingPhoto = rules.find(rule =>
  rule.catalogApiSignature === 'MediaAssetManager.requestContent'
);
assert.ok(movingPhoto, 'reviewed requestContent rule was not normalized');
assert.ok(movingPhoto.receiverTypes.includes('MovingPhoto'));
assert.strictEqual(movingPhoto.overloads.length, 3);

console.log('Reviewed sensitive API catalog normalization verified.');
