const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SOURCE_PATH = path.join(ROOT, 'config', 'hapflow_sources.json');
const REPORT_PATH = path.join(
  ROOT,
  'docs',
  'rule_set_audit',
  'source_rule_sdk20_parameter_normalization.json',
);

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function main() {
  const beforeText = fs.readFileSync(SOURCE_PATH, 'utf8');
  const before = JSON.parse(beforeText.replace(/^\uFEFF/, ''));
  let contextTypesUpdated = 0;
  const removedOutsideSdk = [];
  const output = [];

  for (const rule of before) {
    if (rule.module === '@hms.health.store') {
      removedOutsideSdk.push({
        module: rule.module,
        namespace: rule.namespace,
        apiName: rule.api_name,
        disposition: 'detector_only_external_sdk_not_loaded',
      });
      continue;
    }

    const migrated = {
      ...rule,
      parameters: (rule.parameters || []).map(parameter => {
        const type = String(parameter.type || '');
        if (!type.includes('/application/BaseContext").default')) {
          return parameter;
        }
        contextTypesUpdated++;
        return {
          ...parameter,
          type: type.replace(
            '/application/BaseContext").default',
            '/application/Context").default',
          ),
        };
      }),
    };
    output.push(migrated);
  }

  if (contextTypesUpdated === 0 && removedOutsideSdk.length === 0) {
    assert(
      before.every(rule =>
        rule.module !== '@hms.health.store' &&
        (rule.parameters || []).every(parameter =>
          !String(parameter.type || '').includes('/application/BaseContext").default'),
        ),
      ),
      'SDK parameter normalization is only partially applied.',
    );
    console.log('Source parameters are already normalized for the loaded SDK.');
    return;
  }
  assert.strictEqual(
    contextTypesUpdated,
    33,
    'Expected exactly 33 stale BaseContext parameter types.',
  );
  assert.deepStrictEqual(
    removedOutsideSdk.map(item => item.apiName),
    ['readData'],
    'Unexpected external-SDK source inventory.',
  );

  fs.writeFileSync(SOURCE_PATH, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
  const afterText = fs.readFileSync(SOURCE_PATH, 'utf8');
  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    definition:
      'IFDS rules must resolve against the SDK loaded by the frozen analysis configuration.',
    before: {
      rules: before.length,
      sha256: sha256(beforeText),
    },
    after: {
      rules: output.length,
      sha256: sha256(afterText),
    },
    contextTypesUpdated,
    removedOutsideSdk,
  };
  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  fs.writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify(report, null, 2));
}

if (require.main === module) main();
