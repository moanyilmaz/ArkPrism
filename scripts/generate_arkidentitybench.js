const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const OUTPUT = path.join(ROOT, 'benchmarks', 'ArkIdentityBench');

const directFamily = ({
  id,
  importLine,
  aliasImportLine,
  root,
  alias,
  access,
  targetNamespace,
  targetMethod,
  accessKind = 'call',
}) => {
  const expression = receiver =>
    accessKind === 'property' ? `${receiver}.${access}` : `${receiver}.${access}()`;
  return {
    id,
    target: {
      namespace: targetNamespace,
      method: targetMethod,
      canonicalPath: `${root}.${access}`,
      lexicalToken: access.split('.').pop(),
      accessKind,
      receiverClass: '',
      factoryPath: '',
    },
    cases: [
      {
        id: 'direct',
        expected: true,
        evidence: 'import-qualified executable access',
        source: `${importLine}\nexport function execute(): void {\n  ${expression(root)};\n}`,
      },
      {
        id: 'import_alias',
        expected: true,
        evidence: 'aliased import-qualified executable access',
        source: `${aliasImportLine}\nexport function execute(): void {\n  ${expression(alias)};\n}`,
      },
      {
        id: 'assigned',
        expected: true,
        evidence: 'assigned result of an import-qualified access',
        source: `${importLine}\nexport function execute(): void {\n  const value = ${expression(root)};\n  console.info(String(value));\n}`,
      },
      {
        id: 'helper',
        expected: true,
        evidence: 'access in a helper method',
        source: `${importLine}\nfunction helper(): void {\n  ${expression(root)};\n}\nexport function execute(): void {\n  helper();\n}`,
      },
      {
        id: 'comment_and_string',
        expected: false,
        evidence: 'method text occurs only in a comment and string',
        source: `${importLine}\n// ${root}.${access}()\nexport function execute(): void {\n  const text = '${root}.${access}';\n  console.info(text);\n}`,
      },
      {
        id: 'local_collision',
        expected: false,
        evidence: 'same member on an unrelated local receiver',
        source: `${importLine}\nconst local = { ${access.split('.').pop()}: () => 'local' };\nexport function execute(): void {\n  local.${access.split('.').pop()}();\n}`,
      },
      {
        id: 'member_reference',
        expected: false,
        evidence: accessKind === 'property'
          ? 'namespace is referenced but the target property is not read'
          : 'member is referenced but not invoked',
        source: accessKind === 'property'
          ? `${importLine}\nexport function execute(): void {\n  const ref = ${root};\n  console.info('${access}', String(ref));\n}`
          : `${importLine}\nexport function execute(): void {\n  const ref = ${root}.${access};\n  console.info(String(ref));\n}`,
      },
      {
        id: 'import_only',
        expected: false,
        evidence: 'package is imported but the target member is not accessed',
        source: `${importLine}\nexport function execute(): void {\n  const marker = '${access.split('.').pop()}';\n  console.info(marker);\n}`,
      },
    ],
  };
};

const managerFamily = ({
  id,
  importLine,
  namespaceRoot,
  receiverClass,
  method,
  factoryExpression,
  factoryPath,
  awaitFactory = false,
  targetNamespace,
}) => {
  const factory = awaitFactory ? `await ${factoryExpression}` : factoryExpression;
  return {
    id,
    target: {
      namespace: targetNamespace,
      method,
      canonicalPath: '',
      lexicalToken: method,
      accessKind: 'call',
      receiverClass,
      factoryPath,
    },
    cases: [
      {
        id: 'typed_parameter',
        expected: true,
        evidence: 'declared receiver type',
        source: `${importLine}\nexport function execute(receiver: ${namespaceRoot}.${receiverClass}): void {\n  receiver.${method}();\n}`,
      },
      {
        id: 'typed_alias',
        expected: true,
        evidence: 'declared receiver type propagated through a local alias',
        source: `${importLine}\nexport function execute(receiver: ${namespaceRoot}.${receiverClass}): void {\n  const alias = receiver;\n  alias.${method}();\n}`,
      },
      {
        id: 'factory_local',
        expected: true,
        evidence: 'factory-returned receiver',
        source: `${importLine}\nexport async function execute(): Promise<void> {\n  const context = undefined as any;\n  const receiver = ${factory};\n  receiver.${method}();\n}`,
      },
      {
        id: 'factory_typed_local',
        expected: true,
        evidence: 'factory origin and declared receiver type',
        source: `${importLine}\nexport async function execute(): Promise<void> {\n  const context = undefined as any;\n  const receiver: ${namespaceRoot}.${receiverClass} = ${factory};\n  receiver.${method}();\n}`,
      },
      {
        id: 'comment_and_string',
        expected: false,
        evidence: 'member text occurs only in a comment and string',
        source: `${importLine}\n// receiver.${method}()\nexport function execute(): void {\n  console.info('${receiverClass}.${method}');\n}`,
      },
      {
        id: 'local_collision',
        expected: false,
        evidence: 'same member on an unrelated structural object',
        source: `${importLine}\nclass LocalReceiver { ${method}(): void {} }\nexport function execute(): void {\n  new LocalReceiver().${method}();\n}`,
      },
      {
        id: 'factory_only',
        expected: false,
        evidence: 'factory is called but the sensitive receiver method is not',
        source: `${importLine}\nexport async function execute(): Promise<void> {\n  const context = undefined as any;\n  const receiver = ${factory};\n  console.info('${method}', String(receiver));\n}`,
      },
      {
        id: 'member_reference',
        expected: false,
        evidence: 'typed receiver member is referenced but not invoked',
        source: `${importLine}\nexport function execute(receiver: ${namespaceRoot}.${receiverClass}): void {\n  const ref = receiver.${method};\n  console.info(String(ref));\n}`,
      },
    ],
  };
};

const FAMILIES = [
  directFamily({
    id: 'oaid',
    importLine: "import { identifier } from '@kit.AdsKit';",
    aliasImportLine: "import { identifier as adsId } from '@kit.AdsKit';",
    root: 'identifier',
    alias: 'adsId',
    access: 'getOAID',
    targetNamespace: 'identifier',
    targetMethod: 'getOAID',
  }),
  directFamily({
    id: 'sim_account',
    importLine: "import { sim } from '@kit.TelephonyKit';",
    aliasImportLine: "import { sim as telephonySim } from '@kit.TelephonyKit';",
    root: 'sim',
    alias: 'telephonySim',
    access: 'getSimAccountInfo',
    targetNamespace: 'sim',
    targetMethod: 'getSimAccountInfo',
  }),
  directFamily({
    id: 'reverse_geocode',
    importLine: "import { geoLocationManager } from '@kit.LocationKit';",
    aliasImportLine: "import { geoLocationManager as geo } from '@kit.LocationKit';",
    root: 'geoLocationManager',
    alias: 'geo',
    access: 'getAddressesFromLocation',
    targetNamespace: 'geoLocationManager',
    targetMethod: 'getAddressesFromLocation',
  }),
  directFamily({
    id: 'request_agent',
    importLine: "import { request } from '@kit.BasicServicesKit';",
    aliasImportLine: "import { request as req } from '@kit.BasicServicesKit';",
    root: 'request',
    alias: 'req',
    access: 'agent.create',
    targetNamespace: 'request',
    targetMethod: 'agent.create',
  }),
  directFamily({
    id: 'device_serial_property',
    importLine: "import deviceInfo from '@ohos.deviceInfo';",
    aliasImportLine: "import info from '@ohos.deviceInfo';",
    root: 'deviceInfo',
    alias: 'info',
    access: 'serial',
    targetNamespace: 'deviceInfo',
    targetMethod: 'serial',
    accessKind: 'property',
  }),
  managerFamily({
    id: 'media_metadata',
    importLine: "import { media } from '@kit.MediaKit';",
    namespaceRoot: 'media',
    receiverClass: 'AVMetadataExtractor',
    method: 'fetchMetadata',
    factoryExpression: 'media.createAVMetadataExtractor()',
    factoryPath: 'media.createAVMetadataExtractor',
    awaitFactory: true,
    targetNamespace: 'AVMetadataExtractor',
  }),
  managerFamily({
    id: 'calendar_manager',
    importLine: "import { calendarManager } from '@kit.CalendarKit';",
    namespaceRoot: 'calendarManager',
    receiverClass: 'CalendarManager',
    method: 'getAllCalendars',
    factoryExpression: 'calendarManager.getCalendarManager(context)',
    factoryPath: 'calendarManager.getCalendarManager',
    targetNamespace: 'CalendarManager',
  }),
  {
    id: 'user_auth_event',
    target: {
      namespace: 'UserAuthInstance',
      method: "on('result')",
      canonicalPath: '',
      lexicalToken: 'on',
      accessKind: 'call',
      receiverClass: 'UserAuthInstance',
      factoryPath: '',
      eventLiteral: 'result',
    },
    cases: [
      {
        id: 'typed_parameter',
        expected: true,
        evidence: 'typed receiver and exact event literal',
        source: "import userAuth from '@kit.UserAuthenticationKit';\nexport function execute(auth: userAuth.UserAuthInstance): void {\n  auth.on('result', { onResult(): void {} });\n}",
      },
      {
        id: 'typed_alias',
        expected: true,
        evidence: 'typed receiver alias and exact event literal',
        source: "import userAuth from '@kit.UserAuthenticationKit';\nexport function execute(auth: userAuth.UserAuthInstance): void {\n  const alias = auth;\n  alias.on('result', { onResult(): void {} });\n}",
      },
      {
        id: 'typed_field',
        expected: true,
        evidence: 'typed field receiver and exact event literal',
        source: "import userAuth from '@kit.UserAuthenticationKit';\nexport class Case {\n  constructor(private auth: userAuth.UserAuthInstance) {}\n  execute(): void { this.auth.on('result', { onResult(): void {} }); }\n}",
      },
      {
        id: 'helper',
        expected: true,
        evidence: 'typed receiver used in a helper',
        source: "import userAuth from '@kit.UserAuthenticationKit';\nfunction helper(auth: userAuth.UserAuthInstance): void {\n  auth.on('result', { onResult(): void {} });\n}\nexport function execute(auth: userAuth.UserAuthInstance): void { helper(auth); }",
      },
      {
        id: 'wrong_event',
        expected: false,
        evidence: 'same generic method with a non-sensitive event literal',
        source: "import userAuth from '@kit.UserAuthenticationKit';\nexport function execute(auth: userAuth.UserAuthInstance): void {\n  auth.on('progress', { onResult(): void {} });\n}",
      },
      {
        id: 'local_collision',
        expected: false,
        evidence: 'same method and literal on an unrelated receiver',
        source: "class LocalAuth { on(type: string, value: object): void {} }\nexport function execute(): void {\n  new LocalAuth().on('result', {});\n}",
      },
      {
        id: 'comment_and_string',
        expected: false,
        evidence: 'event registration occurs only in text',
        source: "import userAuth from '@kit.UserAuthenticationKit';\n// auth.on('result', callback)\nexport function execute(): void { console.info(\"on('result')\"); }",
      },
      {
        id: 'member_reference',
        expected: false,
        evidence: 'typed receiver method is referenced but not called',
        source: "import userAuth from '@kit.UserAuthenticationKit';\nexport function execute(auth: userAuth.UserAuthInstance): void {\n  const ref = auth.on;\n  console.info(String(ref));\n}",
      },
    ],
  },
];

function main() {
  fs.rmSync(OUTPUT, { recursive: true, force: true });
  fs.mkdirSync(OUTPUT, { recursive: true });
  const cases = [];
  for (const family of FAMILIES) {
    for (const testCase of family.cases) {
      const id = `${family.id}__${testCase.id}`;
      const directory = path.join(OUTPUT, id, 'entry', 'src', 'main', 'ets');
      fs.mkdirSync(directory, { recursive: true });
      fs.writeFileSync(
        path.join(directory, 'IdentityCase.ets'),
        `${testCase.source}\n`,
        'utf8',
      );
      cases.push({
        id,
        family: family.id,
        expected: testCase.expected,
        evidence: testCase.evidence,
        sourceFile: 'entry/src/main/ets/IdentityCase.ets',
        target: family.target,
      });
    }
  }
  const oracle = {
    schemaVersion: 1,
    definition:
      'A positive case contains an executable access to the specified configured API identity. Comments, strings, method references, wrong event literals, and same-name unrelated receivers are negative.',
    frozenBeforeExecution: true,
    cases,
  };
  fs.writeFileSync(
    path.join(OUTPUT, 'oracle.json'),
    `${JSON.stringify(oracle, null, 2)}\n`,
    'utf8',
  );
  console.log(
    `Generated ${cases.length} cases: `
      + `${cases.filter(item => item.expected).length} positive, `
      + `${cases.filter(item => !item.expected).length} negative.`,
  );
}

if (require.main === module) main();

module.exports = {
  FAMILIES,
};
