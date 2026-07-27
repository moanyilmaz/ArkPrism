const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const RULE_PATH = path.join(ROOT, 'config', 'sensitive_apis.json');
const REPORT_PATH = path.join(
  ROOT,
  'docs',
  'rule_set_audit',
  'detector_domain_migration.json',
);

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function identity(group, api) {
  return {
    packageName: String(group.systemPackage || ''),
    namespace: String(api.namespace || ''),
    member: String(api.method || ''),
  };
}

function matches(value, expected) {
  if (expected instanceof RegExp) return expected.test(value);
  if (Array.isArray(expected)) return expected.includes(value);
  return value === expected;
}

const RULES = [
  {
    id: 'canonical-financial-label',
    category: 'financial.asset',
    when: { category: 'Financial information.Asset information' },
  },
  {
    id: 'canonical-hardware-identifier',
    category: 'device_identity.hardware',
    when: { category: 'Identifiers.diskSN' },
  },
  {
    id: 'visible-window-state',
    category: 'device_status.screen',
    when: { packageName: '@kit.ArkUI', namespace: 'window' },
  },
  {
    id: 'account-management',
    category: 'user_data.account',
    when: {
      packageName: '@kit.BasicServicesKit',
      namespace: ['AppAccountManager', 'AccountManager'],
    },
  },
  {
    id: 'do-not-disturb-setting',
    category: 'user_preference.settings',
    when: {
      packageName: '@kit.BasicServicesKit',
      namespace: 'intelligentScene',
    },
  },
  {
    id: 'domain-server-configuration',
    category: 'network.connectivity',
    when: {
      packageName: '@kit.BasicServicesKit',
      namespace: 'DomainServerConfigManager',
    },
  },
  {
    id: 'nfc-control',
    category: 'network.nfc',
    when: {
      packageName: '@kit.ConnectivityKit',
      namespace: ['nfcController', 'NdefFormatableTag'],
    },
  },
  {
    id: 'distributed-device-discovery',
    category: 'device_identity.distributed',
    when: {
      packageName: '@kit.DistributedServiceKit',
      namespace: 'DeviceManager',
      member: /^(getAvailableDeviceList|startDiscovering)/,
    },
  },
  {
    id: 'distributed-file-service',
    category: 'storage.distributed',
    when: { packageName: '@kit.CoreFileKit' },
  },
  {
    id: 'system-integrity',
    category: 'system.security',
    when: { packageName: '@kit.DeviceSecurityKit' },
  },
  {
    id: 'game-profile',
    category: 'user_data.game_profile',
    when: { packageName: '@kit.GameServiceKit', namespace: 'gamePlayer' },
  },
  {
    id: 'game-nearby-transfer',
    category: 'network.connectivity',
    when: {
      packageName: '@kit.GameServiceKit',
      namespace: 'gameNearbyTransfer',
    },
  },
  {
    id: 'input-control',
    category: 'device_status.input',
    when: { packageName: '@kit.InputKit' },
  },
  {
    id: 'mdm-policy',
    category: 'device_management.policy',
    when: {
      packageName: '@kit.MDMKit',
      namespace: ['adminManager', 'applicationManager', 'systemManager'],
    },
  },
  {
    id: 'mdm-cellular',
    category: 'network.cellular',
    when: {
      packageName: '@kit.MDMKit',
      namespace: ['telephonyManager'],
    },
  },
  {
    id: 'mdm-apn',
    category: 'network.cellular',
    when: {
      packageName: '@kit.MDMKit',
      namespace: 'networkManager',
      member: /Apn/i,
    },
  },
  {
    id: 'mdm-network-interface',
    category: 'network.connectivity',
    when: {
      packageName: '@kit.MDMKit',
      namespace: 'networkManager',
      member: /NetworkInterface/i,
    },
  },
  {
    id: 'nearlink',
    category: 'network.nearlink',
    when: { packageName: '@kit.NearLinkKit' },
  },
  {
    id: 'network-boost',
    category: 'network.connectivity',
    when: { packageName: '@kit.NetworkBoostKit' },
  },
  {
    id: 'notification-access',
    category: 'user_data.notification',
    when: { packageName: '@kit.NotificationKit' },
  },
  {
    id: 'remote-communication',
    category: 'network.connectivity',
    when: { packageName: '@kit.RemoteCommunicationKit' },
  },
  {
    id: 'cellular-data',
    category: 'network.cellular',
    when: { packageName: '@kit.TelephonyKit', namespace: 'data' },
  },
  {
    id: 'esim-profile',
    category: 'device_identity.sim',
    when: { packageName: '@kit.TelephonyKit', namespace: 'eSIM' },
  },
  {
    id: 'user-authentication',
    category: 'device_identity.biometric',
    when: { packageName: '@kit.UserAuthenticationKit' },
  },
  {
    id: 'distributed-database',
    category: 'storage.distributed',
    when: { packageName: '@ohos.data.rdb' },
  },
  {
    id: 'reminder-data',
    category: 'user_data.notification',
    when: { packageName: '@ohos.reminderAgent' },
  },
];

function applies(rule, group, api) {
  const values = {
    ...identity(group, api),
    category: String(api.profilingCategory || ''),
  };
  return Object.entries(rule.when).every(
    ([key, expected]) => matches(values[key], expected),
  );
}

function reclassify(groups) {
  const changes = [];
  const output = groups.map(group => ({
    ...group,
    privacyApis: (group.privacyApis || []).map(api => {
      const matchingRules = RULES.filter(rule => applies(rule, group, api));
      if (matchingRules.length > 1) {
        throw new Error(
          `Overlapping domain rules for ${group.systemPackage} `
          + `${api.namespace}.${api.method}: ${matchingRules.map(rule => rule.id).join(', ')}`,
        );
      }
      if (matchingRules.length === 0) return api;
      const rule = matchingRules[0];
      if (api.profilingCategory === rule.category) return api;
      changes.push({
        ...identity(group, api),
        from: api.profilingCategory,
        to: rule.category,
        rule: rule.id,
      });
      return { ...api, profilingCategory: rule.category };
    }),
  }));
  return { output, changes };
}

function categoryCounts(groups) {
  const counts = {};
  for (const group of groups) {
    for (const api of group.privacyApis || []) {
      const category = String(api.profilingCategory || '(missing)');
      counts[category] = (counts[category] || 0) + 1;
    }
  }
  return Object.fromEntries(
    Object.entries(counts).sort(([left], [right]) => left.localeCompare(right)),
  );
}

function main() {
  const beforeText = fs.readFileSync(RULE_PATH, 'utf8');
  const before = JSON.parse(beforeText.replace(/^\uFEFF/, ''));
  const result = reclassify(before);
  const afterText = `${JSON.stringify(result.output, null, 2)}\n`;
  fs.writeFileSync(RULE_PATH, afterText, 'utf8');
  const prior = fs.existsSync(REPORT_PATH)
    ? JSON.parse(fs.readFileSync(REPORT_PATH, 'utf8'))
    : null;
  const continuesPriorMigration = prior?.afterSha256 === sha256(beforeText);
  const changedRules = continuesPriorMigration
    ? [...(prior.changedRules || []), ...result.changes]
    : result.changes;

  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    definition:
      'Explicit package/namespace/member corrections for detector profiling domains. API identity and matching semantics are unchanged.',
    beforeSha256: continuesPriorMigration ? prior.beforeSha256 : sha256(beforeText),
    afterSha256: sha256(afterText),
    entries: result.output.reduce(
      (sum, group) => sum + (group.privacyApis || []).length,
      0,
    ),
    changes: changedRules.length,
    beforeCategories: continuesPriorMigration
      ? prior.beforeCategories
      : categoryCounts(before),
    afterCategories: categoryCounts(result.output),
    changedRules,
  };
  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  fs.writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(`Reclassified ${report.changes}/${report.entries} detector rules.`);
}

if (require.main === module) main();

module.exports = { RULES, applies, reclassify };
