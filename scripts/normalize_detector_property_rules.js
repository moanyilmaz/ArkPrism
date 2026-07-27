const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const configPath = path.join(root, 'config', 'sensitive_apis.json');
const reportPath = path.join(
  root,
  'docs',
  'rule_set_audit',
  'detector_property_rule_normalization.json',
);

const packages = JSON.parse(fs.readFileSync(configPath, 'utf8'));
const properties = [];
let changed = 0;

for (const pkg of packages) {
  for (const api of pkg.privacyApis || []) {
    const isDeviceInfoProperty =
      String(api.namespace || '').toLowerCase() === 'deviceinfo' &&
      !/[.(]/.test(String(api.method || ''));
    if (!isDeviceInfoProperty) continue;
    properties.push({
      package: pkg.systemPackage,
      namespace: api.namespace,
      property: api.method,
      previousDirectCall: api.directCall,
    });
    if (api.directCall !== null) {
      api.directCall = null;
      changed++;
    }
  }
}

if (properties.length !== 50) {
  throw new Error(
    `Expected 50 deviceInfo property rules, found ${properties.length}; audit the rule inventory.`,
  );
}

fs.writeFileSync(configPath, `${JSON.stringify(packages, null, 2)}\n`, 'utf8');
fs.mkdirSync(path.dirname(reportPath), { recursive: true });
fs.writeFileSync(
  reportPath,
  `${JSON.stringify({
    schemaVersion: 1,
    propertyRules: properties.length,
    changed,
    criterion:
      'A simple member in the deviceInfo/deviceinfo namespace is an SDK property read, not a callable method.',
    rules: properties,
  }, null, 2)}\n`,
  'utf8',
);

console.log(`Normalized ${properties.length} property rules; changed=${changed}.`);
