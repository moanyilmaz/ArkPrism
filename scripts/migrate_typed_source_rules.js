const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const SOURCE_PATH = path.join(ROOT, 'config', 'hapflow_sources.json');
const LIFECYCLE_PATH = path.join(ROOT, 'config', 'lifecycle_sources.json');
const REPORT_PATH = path.join(
  ROOT,
  'docs',
  'rule_set_audit',
  'source_rule_migration.json',
);

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function stableRuleKey(rule) {
  return JSON.stringify([
    rule.module || '',
    rule.class || '',
    rule.namespace || '',
    rule.api_name || '',
    rule.parameters || [],
    rule.returnType || '',
    rule.source_type || '',
    rule.tainted_param_index,
  ]);
}

function privacyRuleDecision(rule) {
  const missing = [];
  if (!String(rule.api_name || '').trim()) missing.push('api_name');
  if (!String(rule.module || '').trim()) missing.push('module');
  if (!Array.isArray(rule.parameters)) missing.push('parameters');
  if (!String(rule.reason || '').trim()) missing.push('reason');
  if (!String(rule.sensitivity || '').trim()) missing.push('sensitivity');
  if (!['return', 'callback'].includes(rule.source_type)) {
    missing.push('supported source_type');
  }
  if (rule.source_type === 'return') {
    const returnType = String(rule.returnType || '').trim();
    const hasUnknownCarrier =
      /(^|[<|,&()[\]\s])(?:any|unknown|object|void|undefined|never)(?=$|[>|,&()[\]\s])/i
        .test(returnType);
    if (!returnType || hasUnknownCarrier) {
      missing.push('concrete non-void returnType');
    }
    if (rule.tainted_param_index !== -1) missing.push('return carrier index');
  }
  if (rule.source_type === 'callback') {
    const callbackIndex = Number(rule.tainted_param_index) - 1;
    const parameter = Array.isArray(rule.parameters)
      ? rule.parameters[callbackIndex]
      : null;
    if (!Number.isInteger(callbackIndex) || callbackIndex < 0 || !parameter) {
      missing.push('valid callback index');
    } else if (!/(?:Async)?Callback\s*</.test(String(parameter.type || ''))) {
      missing.push('typed callback parameter');
    }
  }
  return missing;
}

function migratePrivacyRules(input) {
  const retained = [];
  const removed = [];
  const duplicates = [];
  const seen = new Set();

  input.forEach((rule, index) => {
    const reasons = privacyRuleDecision(rule);
    if (reasons.length > 0) {
      removed.push({
        index,
        module: rule.module || '',
        namespace: rule.namespace || '',
        apiName: rule.api_name || '',
        sourceType: rule.source_type || '',
        reasons,
      });
      return;
    }

    const migrated = {
      ...rule,
      source_kind: 'privacy_data',
      rule_origin: 'typed_privacy_source_inventory',
    };
    const key = stableRuleKey(migrated);
    if (seen.has(key)) {
      duplicates.push({
        index,
        module: migrated.module,
        namespace: migrated.namespace,
        apiName: migrated.api_name,
      });
      return;
    }
    seen.add(key);
    retained.push(migrated);
  });

  return { retained, removed, duplicates };
}

function migrateLifecycleRules(input) {
  return input.map(rule => ({
    ...rule,
    source_kind: 'framework_input',
    rule_origin: 'explicit_lifecycle_input_model',
  }));
}

function main() {
  const sourceText = fs.readFileSync(SOURCE_PATH, 'utf8');
  const lifecycleText = fs.readFileSync(LIFECYCLE_PATH, 'utf8');
  const sourceRules = JSON.parse(sourceText.replace(/^\uFEFF/, ''));
  const lifecycleRules = JSON.parse(lifecycleText.replace(/^\uFEFF/, ''));
  const migrated = migratePrivacyRules(sourceRules);
  const migratedLifecycle = migrateLifecycleRules(lifecycleRules);

  fs.writeFileSync(
    SOURCE_PATH,
    `${JSON.stringify(migrated.retained, null, 2)}\n`,
    'utf8',
  );
  fs.writeFileSync(
    LIFECYCLE_PATH,
    `${JSON.stringify(migratedLifecycle, null, 2)}\n`,
    'utf8',
  );

  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    definition:
      'IFDS sources require an explicit typed sensitive-value carrier. Detector-only API rules are not taint sources.',
    before: {
      privacyRules: sourceRules.length,
      lifecycleRules: lifecycleRules.length,
      privacySha256: sha256(sourceText),
      lifecycleSha256: sha256(lifecycleText),
    },
    after: {
      privacyRules: migrated.retained.length,
      lifecycleRules: migratedLifecycle.length,
      privacySha256: sha256(fs.readFileSync(SOURCE_PATH)),
      lifecycleSha256: sha256(fs.readFileSync(LIFECYCLE_PATH)),
    },
    removedUntypedOrInvalid: migrated.removed.length,
    removedDuplicates: migrated.duplicates.length,
    removed: migrated.removed,
    duplicates: migrated.duplicates,
  };
  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  fs.writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify(report.after, null, 2));
  console.log(
    `Removed ${report.removedUntypedOrInvalid} untyped/invalid rules and `
      + `${report.removedDuplicates} exact duplicates.`,
  );
}

if (require.main === module) main();

module.exports = {
  migrateLifecycleRules,
  migratePrivacyRules,
  privacyRuleDecision,
  stableRuleKey,
};
