const assert = require('assert');

const { linkTaintFlowsToPrivacyUsages } = require('../dist/evidenceLinker');

const usages = [
  {
    category: 'direct invoke stmt after assignment',
    apiPackage: '@kit.BasicServicesKit',
    namespace: 'pasteboard',
    method: 'getSystemPasteboard',
    args: [],
    code: '%5 = instanceinvoke pasteboard.<@%unk/%unk: .getSystemPasteboard()>()',
    file: 'entry/src/main/ets/settings.ets',
    line: 42,
  },
  {
    category: 'indirect invoke',
    apiPackage: '@kit.MediaKit',
    namespace: 'PhotoAccessHelper',
    method: 'createAsset',
    args: [],
    code: 'instanceinvoke helper.<@%unk/%unk: .createAsset()>()',
    file: 'entry/src/main/ets/media.ets',
    line: 80,
  },
];

const flows = [
  {
    provenance: 'ifds',
    sourceKind: 'privacy_data',
    sourceApi: usages[0].code,
    sourceFile: 'E:/dataset/App/entry/src/main/ets/settings.ets',
    sourceLine: 42,
    sinkApi: 'console.info()',
    sinkFile: 'E:/dataset/App/entry/src/main/ets/settings.ets',
    sinkLine: 45,
    taintedValue: '%5',
    path: [],
  },
  {
    provenance: 'async_supplement',
    sourceKind: 'privacy_data',
    sourceApi: 'instanceinvoke helper.<@%unk/%unk: .createAsset()>()',
    sourceFile: 'E:/dataset/App/entry/src/main/ets/media.ets',
    sourceLine: 80,
    sinkApi: 'console.info()',
    sinkFile: 'E:/dataset/App/entry/src/main/ets/media.ets',
    sinkLine: 90,
    taintedValue: '%1',
    path: [],
  },
  {
    provenance: 'ifds',
    sourceKind: 'framework_input',
    sourceApi: 'instanceinvoke unrelated.<@%unk/%unk: .createAsset()>()',
    sourceFile: 'E:/dataset/App/entry/src/main/ets/other.ets',
    sourceLine: 80,
    sinkApi: 'console.info()',
    sinkFile: 'E:/dataset/App/entry/src/main/ets/other.ets',
    sinkLine: 90,
    taintedValue: '%1',
    path: [],
  },
];

assert.deepStrictEqual(linkTaintFlowsToPrivacyUsages(usages, flows), [
  { apiUsageIndex: 0, taintFlowIndex: 0, evidence: 'exact_statement' },
  { apiUsageIndex: 1, taintFlowIndex: 1, evidence: 'exact_statement' },
]);

console.log('Evidence linkage verified.');
