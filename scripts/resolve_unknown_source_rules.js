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
  'source_rule_sdk20_resolution.json',
);

const UNKNOWN_CARRIER =
  /(^|[<|,&()[\]\s])(?:any|unknown|object|void|undefined|never)(?=$|[>|,&()[\]\s])/i;

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function sourceKey(rule) {
  return JSON.stringify([
    rule.module || '',
    rule.namespace || '',
    rule.class || '',
    rule.api_name || '',
    rule.source_type || '',
    rule.tainted_param_index,
    rule.parameters || [],
  ]);
}

function compactRuleId(rule) {
  return [
    rule.module || '',
    rule.namespace || '',
    rule.class || '',
    rule.api_name || '',
  ].join('|');
}

function parameter(name, type) {
  return { name, type };
}

function sdkRule({
  apiName,
  module,
  namespace,
  className = '',
  parameters = [],
  returnType,
  sourceType = 'return',
  taintedParamIndex = -1,
  reason,
  sensitivity,
  sdkLine,
}) {
  return {
    api_name: apiName,
    module,
    class: className,
    namespace,
    parameters,
    returnType,
    api_type: 'source',
    source_type: sourceType,
    tainted_param_index: taintedParamIndex,
    reason,
    sensitivity,
    source_kind: 'privacy_data',
    rule_origin: 'sdk20_verified_privacy_source',
    sdk_declaration: sdkLine,
  };
}

const calendarReason =
  'Returns calendar accounts, configuration, or events that may contain user schedule data.';
const pasteboardReason =
  'Returns user-controlled pasteboard content.';
const mediaReason =
  'Returns metadata, cover art, or a frame extracted from user media.';

const replacements = [
  sdkRule({
    apiName: 'getLocalDeviceId',
    module: '@ohos.distributedDeviceManager',
    namespace: 'distributedDeviceManager',
    className: 'DeviceManager',
    returnType: 'string',
    reason: 'Returns the identifier of the local distributed device.',
    sensitivity: 'medium',
    sdkLine: '@ohos.distributedDeviceManager.d.ts:210',
  }),

  sdkRule({
    apiName: 'getCalendar',
    module: '@ohos.calendarManager',
    namespace: 'calendarManager',
    className: 'CalendarManager',
    parameters: [parameter('calendarAccount', 'CalendarAccount')],
    returnType: 'Promise<Calendar>',
    reason: calendarReason,
    sensitivity: 'medium',
    sdkLine: '@ohos.calendarManager.d.ts:147',
  }),
  sdkRule({
    apiName: 'getCalendar',
    module: '@ohos.calendarManager',
    namespace: 'calendarManager',
    className: 'CalendarManager',
    parameters: [
      parameter('calendarAccount', 'CalendarAccount'),
      parameter('callback', 'AsyncCallback<Calendar>'),
    ],
    returnType: 'void',
    sourceType: 'callback',
    taintedParamIndex: 2,
    reason: calendarReason,
    sensitivity: 'medium',
    sdkLine: '@ohos.calendarManager.d.ts:173',
  }),
  sdkRule({
    apiName: 'getCalendar',
    module: '@ohos.calendarManager',
    namespace: 'calendarManager',
    className: 'CalendarManager',
    parameters: [parameter('callback', 'AsyncCallback<Calendar>')],
    returnType: 'void',
    sourceType: 'callback',
    taintedParamIndex: 1,
    reason: calendarReason,
    sensitivity: 'medium',
    sdkLine: '@ohos.calendarManager.d.ts:197',
  }),
  sdkRule({
    apiName: 'getAllCalendars',
    module: '@ohos.calendarManager',
    namespace: 'calendarManager',
    className: 'CalendarManager',
    returnType: 'Promise<Calendar[]>',
    reason: calendarReason,
    sensitivity: 'medium',
    sdkLine: '@ohos.calendarManager.d.ts:209',
  }),
  sdkRule({
    apiName: 'getAllCalendars',
    module: '@ohos.calendarManager',
    namespace: 'calendarManager',
    className: 'CalendarManager',
    parameters: [parameter('callback', 'AsyncCallback<Calendar[]>')],
    returnType: 'void',
    sourceType: 'callback',
    taintedParamIndex: 1,
    reason: calendarReason,
    sensitivity: 'medium',
    sdkLine: '@ohos.calendarManager.d.ts:221',
  }),
  sdkRule({
    apiName: 'getEvents',
    module: '@ohos.calendarManager',
    namespace: 'calendarManager',
    className: 'Calendar',
    parameters: [
      parameter('eventFilter', 'EventFilter'),
      parameter('eventKey', '(keyof Event)[]'),
    ],
    returnType: 'Promise<Event[]>',
    reason: calendarReason,
    sensitivity: 'high',
    sdkLine: '@ohos.calendarManager.d.ts:367',
  }),
  sdkRule({
    apiName: 'getEvents',
    module: '@ohos.calendarManager',
    namespace: 'calendarManager',
    className: 'Calendar',
    parameters: [
      parameter('eventFilter', 'EventFilter'),
      parameter('eventKey', '(keyof Event)[]'),
      parameter('callback', 'AsyncCallback<Event[]>'),
    ],
    returnType: 'void',
    sourceType: 'callback',
    taintedParamIndex: 3,
    reason: calendarReason,
    sensitivity: 'high',
    sdkLine: '@ohos.calendarManager.d.ts:376',
  }),
  sdkRule({
    apiName: 'getEvents',
    module: '@ohos.calendarManager',
    namespace: 'calendarManager',
    className: 'Calendar',
    parameters: [parameter('callback', 'AsyncCallback<Event[]>')],
    returnType: 'void',
    sourceType: 'callback',
    taintedParamIndex: 1,
    reason: calendarReason,
    sensitivity: 'high',
    sdkLine: '@ohos.calendarManager.d.ts:383',
  }),
  sdkRule({
    apiName: 'getConfig',
    module: '@ohos.calendarManager',
    namespace: 'calendarManager',
    className: 'Calendar',
    returnType: 'CalendarConfig',
    reason: calendarReason,
    sensitivity: 'medium',
    sdkLine: '@ohos.calendarManager.d.ts:390',
  }),
  sdkRule({
    apiName: 'getAccount',
    module: '@ohos.calendarManager',
    namespace: 'calendarManager',
    className: 'Calendar',
    returnType: 'CalendarAccount',
    reason: calendarReason,
    sensitivity: 'medium',
    sdkLine: '@ohos.calendarManager.d.ts:413',
  }),
  sdkRule({
    apiName: 'queryEventInstances',
    module: '@ohos.calendarManager',
    namespace: 'calendarManager',
    className: 'Calendar',
    parameters: [
      parameter('start', 'number'),
      parameter('end', 'number'),
      parameter('ids', 'number[]'),
      parameter('eventKey', '(keyof Event)[]'),
    ],
    returnType: 'Promise<Event[]>',
    reason: calendarReason,
    sensitivity: 'high',
    sdkLine: '@ohos.calendarManager.d.ts:425',
  }),

  sdkRule({
    apiName: 'getDataSync',
    module: '@ohos.pasteboard',
    namespace: 'pasteboard',
    className: 'SystemPasteboard',
    returnType: 'PasteData',
    reason: pasteboardReason,
    sensitivity: 'high',
    sdkLine: '@ohos.pasteboard.d.ts:1426',
  }),
  sdkRule({
    apiName: 'getUnifiedData',
    module: '@ohos.pasteboard',
    namespace: 'pasteboard',
    className: 'SystemPasteboard',
    returnType: 'Promise<unifiedDataChannel.UnifiedData>',
    reason: pasteboardReason,
    sensitivity: 'high',
    sdkLine: '@ohos.pasteboard.d.ts:1580',
  }),
  sdkRule({
    apiName: 'getUnifiedDataSync',
    module: '@ohos.pasteboard',
    namespace: 'pasteboard',
    className: 'SystemPasteboard',
    returnType: 'unifiedDataChannel.UnifiedData',
    reason: pasteboardReason,
    sensitivity: 'high',
    sdkLine: '@ohos.pasteboard.d.ts:1592',
  }),
  sdkRule({
    apiName: 'getDataWithProgress',
    module: '@ohos.pasteboard',
    namespace: 'pasteboard',
    className: 'SystemPasteboard',
    parameters: [parameter('params', 'GetDataParams')],
    returnType: 'Promise<PasteData>',
    reason: pasteboardReason,
    sensitivity: 'high',
    sdkLine: '@ohos.pasteboard.d.ts:1690',
  }),

  sdkRule({
    apiName: 'getFile',
    module: '@ohos.wallpaper',
    namespace: 'wallpaper',
    parameters: [parameter('wallpaperType', 'WallpaperType')],
    returnType: 'Promise<number>',
    reason: 'Returns a file descriptor for the configured wallpaper.',
    sensitivity: 'medium',
    sdkLine: '@ohos.wallpaper.d.ts:163',
  }),
  sdkRule({
    apiName: 'getFile',
    module: '@ohos.wallpaper',
    namespace: 'wallpaper',
    parameters: [
      parameter('wallpaperType', 'WallpaperType'),
      parameter('callback', 'AsyncCallback<number>'),
    ],
    returnType: 'void',
    sourceType: 'callback',
    taintedParamIndex: 2,
    reason: 'Returns a file descriptor for the configured wallpaper.',
    sensitivity: 'medium',
    sdkLine: '@ohos.wallpaper.d.ts:151',
  }),

  sdkRule({
    apiName: 'fetchFrameByTime',
    module: '@ohos.multimedia.media',
    namespace: 'media',
    className: 'AVMetadataExtractor',
    parameters: [
      parameter('timeUs', 'number'),
      parameter('options', 'AVImageQueryOptions'),
      parameter('param', 'PixelMapParams'),
    ],
    returnType: 'Promise<image.PixelMap>',
    reason: mediaReason,
    sensitivity: 'medium',
    sdkLine: '@ohos.multimedia.media.d.ts:608',
  }),
  sdkRule({
    apiName: 'fetchFrameByTime',
    module: '@ohos.multimedia.media',
    namespace: 'media',
    className: 'AVImageGenerator',
    parameters: [
      parameter('timeUs', 'number'),
      parameter('options', 'AVImageQueryOptions'),
      parameter('param', 'PixelMapParams'),
    ],
    returnType: 'Promise<image.PixelMap>',
    reason: mediaReason,
    sensitivity: 'medium',
    sdkLine: '@ohos.multimedia.media.d.ts:1059',
  }),
  sdkRule({
    apiName: 'fetchFrameByTime',
    module: '@ohos.multimedia.media',
    namespace: 'media',
    className: 'AVImageGenerator',
    parameters: [
      parameter('timeUs', 'number'),
      parameter('options', 'AVImageQueryOptions'),
      parameter('param', 'PixelMapParams'),
      parameter('callback', 'AsyncCallback<image.PixelMap>'),
    ],
    returnType: 'void',
    sourceType: 'callback',
    taintedParamIndex: 4,
    reason: mediaReason,
    sensitivity: 'medium',
    sdkLine: '@ohos.multimedia.media.d.ts:1047',
  }),
  sdkRule({
    apiName: 'fetchScaledFrameByTime',
    module: '@ohos.multimedia.media',
    namespace: 'media',
    className: 'AVImageGenerator',
    parameters: [
      parameter('timeUs', 'number'),
      parameter('queryMode', 'AVImageQueryOptions'),
      parameter('outputSize', 'OutputSize'),
    ],
    returnType: 'Promise<image.PixelMap>',
    reason: mediaReason,
    sensitivity: 'medium',
    sdkLine: '@ohos.multimedia.media.d.ts:1072',
  }),
  sdkRule({
    apiName: 'fetchMetadata',
    module: '@ohos.multimedia.media',
    namespace: 'media',
    className: 'AVMetadataExtractor',
    returnType: 'Promise<AVMetadata>',
    reason: mediaReason,
    sensitivity: 'medium',
    sdkLine: '@ohos.multimedia.media.d.ts:545',
  }),
  sdkRule({
    apiName: 'fetchMetadata',
    module: '@ohos.multimedia.media',
    namespace: 'media',
    className: 'AVMetadataExtractor',
    parameters: [parameter('callback', 'AsyncCallback<AVMetadata>')],
    returnType: 'void',
    sourceType: 'callback',
    taintedParamIndex: 1,
    reason: mediaReason,
    sensitivity: 'medium',
    sdkLine: '@ohos.multimedia.media.d.ts:527',
  }),
  sdkRule({
    apiName: 'fetchAlbumCover',
    module: '@ohos.multimedia.media',
    namespace: 'media',
    className: 'AVMetadataExtractor',
    returnType: 'Promise<image.PixelMap>',
    reason: mediaReason,
    sensitivity: 'medium',
    sdkLine: '@ohos.multimedia.media.d.ts:583',
  }),
  sdkRule({
    apiName: 'fetchAlbumCover',
    module: '@ohos.multimedia.media',
    namespace: 'media',
    className: 'AVMetadataExtractor',
    parameters: [parameter('callback', 'AsyncCallback<image.PixelMap>')],
    returnType: 'void',
    sourceType: 'callback',
    taintedParamIndex: 1,
    reason: mediaReason,
    sensitivity: 'medium',
    sdkLine: '@ohos.multimedia.media.d.ts:565',
  }),

  sdkRule({
    apiName: 'getPersistentDeviceIds',
    module: '@ohos.bluetooth.access',
    namespace: 'access',
    returnType: 'string[]',
    reason: 'Returns persistent identifiers for Bluetooth devices.',
    sensitivity: 'high',
    sdkLine: '@ohos.bluetooth.access.d.ts:360',
  }),
  sdkRule({
    apiName: 'getLocalName',
    module: '@ohos.bluetooth.connection',
    namespace: 'connection',
    returnType: 'string',
    reason: 'Returns the local Bluetooth device name.',
    sensitivity: 'medium',
    sdkLine: '@ohos.bluetooth.connection.d.ts:428',
  }),
  sdkRule({
    apiName: 'getPairedDevices',
    module: '@ohos.bluetooth.connection',
    namespace: 'connection',
    returnType: 'Array<string>',
    reason: 'Returns identifiers of paired Bluetooth devices.',
    sensitivity: 'high',
    sdkLine: '@ohos.bluetooth.connection.d.ts:471',
  }),
];

const expectedUnknownIds = [
  '@kit.DistributedServiceKit|distributedDeviceManager||distributedDeviceManager.DeviceManager.getLocalDeviceId',
  '@ohos.calendarManager|CalendarManager||getAllCalendars',
  '@ohos.calendarManager|CalendarManager||getCalendar',
  '@ohos.calendarManager|Calendar||getAccount',
  '@ohos.calendarManager|Calendar||getConfig',
  '@ohos.calendarManager|Calendar||getEvents',
  '@ohos.calendarManager|Calendar||queryEventInstances',
  '@ohos.contact|contact||queryContactsCount',
  '@ohos.deviceInfo|SystemPasteboard||getData',
  '@ohos.deviceInfo|SystemPasteboard||getDataSync',
  '@ohos.deviceInfo|SystemPasteboard||getDataWithProgress',
  '@ohos.deviceInfo|SystemPasteboard||getUnifiedData',
  '@ohos.deviceInfo|SystemPasteboard||getUnifiedDataSync',
  '@ohos.deviceInfo|deviceInfo||ODID',
  '@ohos.deviceInfo|deviceInfo||diskSN',
  '@ohos.deviceInfo|deviceInfo||serial',
  '@ohos.deviceInfo|deviceInfo||udid',
  '@ohos.deviceInfo|wallpaper||getFile',
  '@ohos.geoLocationManager|geoLocationManager||flushCachedGnssLocations',
  '@ohos.multimedia.media|AVImageGenerator||fetchFrameByTime',
  '@ohos.multimedia.media|AVImageGenerator||fetchScaledFrameByTime',
  '@ohos.multimedia.media|AVMetadataExtractor||fetchAlbumCover',
  '@ohos.multimedia.media|AVMetadataExtractor||fetchFrameByTime',
  '@ohos.multimedia.media|AVMetadataExtractor||fetchFramesByTimes',
  '@ohos.multimedia.media|AVMetadataExtractor||fetchMetadata',
  '@ohos.sensor|sensor||getSensorListByDeviceSync',
  '@ohos.wifiManager|access||getPersistentDeviceIds',
  '@ohos.wifiManager|connection||getLocalName',
  '@ohos.wifiManager|connection||getPairedDevices',
].sort();

const removalDisposition = new Map([
  ['@ohos.contact|contact||queryContactsCount', 'not_declared_in_api20'],
  ['@ohos.multimedia.media|AVMetadataExtractor||fetchFramesByTimes', 'not_declared_in_api20'],
  ['@ohos.deviceInfo|deviceInfo||serial', 'detector_only_property'],
  ['@ohos.deviceInfo|deviceInfo||udid', 'detector_only_property'],
  ['@ohos.deviceInfo|deviceInfo||ODID', 'detector_only_property'],
  ['@ohos.deviceInfo|deviceInfo||diskSN', 'detector_only_property'],
  ['@ohos.sensor|sensor||getSensorListByDeviceSync', 'capability_metadata_not_privacy_carrier'],
  ['@ohos.geoLocationManager|geoLocationManager||flushCachedGnssLocations', 'no_sensitive_return_carrier'],
  ['@ohos.deviceInfo|SystemPasteboard||getData', 'superseded_by_existing_sdk_typed_rules'],
]);

function main() {
  const beforeText = fs.readFileSync(SOURCE_PATH, 'utf8');
  const before = JSON.parse(beforeText.replace(/^\uFEFF/, ''));
  const unknown = before.filter(rule =>
    rule.source_type === 'return' &&
    UNKNOWN_CARRIER.test(String(rule.returnType || '').trim()),
  );
  const actualUnknownIds = unknown.map(compactRuleId).sort();
  if (actualUnknownIds.length === 0) {
    assert(
      before.every(rule =>
        rule.source_type !== 'return' ||
        !UNKNOWN_CARRIER.test(String(rule.returnType || '').trim()),
      ),
      'Source inventory still contains an unknown return carrier.',
    );
    console.log('Source inventory already contains no unknown return carriers.');
    return;
  }
  assert.deepStrictEqual(
    actualUnknownIds,
    expectedUnknownIds,
    'Unknown-carrier inventory changed; audit the delta before rewriting rules.',
  );

  const retained = before.filter(rule => !unknown.includes(rule));
  const seen = new Set(retained.map(sourceKey));
  const added = [];
  const duplicateReplacements = [];
  for (const replacement of replacements) {
    const key = sourceKey(replacement);
    if (seen.has(key)) {
      duplicateReplacements.push(replacement);
      continue;
    }
    seen.add(key);
    added.push(replacement);
  }

  const output = [...retained, ...added];
  for (const rule of output) {
    assert(
      rule.source_type !== 'return' ||
        !UNKNOWN_CARRIER.test(String(rule.returnType || '').trim()),
      `Rule still has an unknown carrier: ${compactRuleId(rule)}`,
    );
  }

  fs.writeFileSync(SOURCE_PATH, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
  const afterText = fs.readFileSync(SOURCE_PATH, 'utf8');
  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    sdk: {
      apiLevel: 20,
      root: '${OPENHARMONY_SDK_PATH}',
      evidence: 'Declaration file and line recorded in every replacement rule.',
    },
    before: {
      rules: before.length,
      unknownCarrierRules: unknown.length,
      sha256: sha256(beforeText),
    },
    after: {
      rules: output.length,
      unknownCarrierRules: 0,
      sha256: sha256(afterText),
    },
    removed: unknown.map(rule => {
      const id = compactRuleId(rule);
      return {
        id,
        disposition: removalDisposition.get(id) || 'replaced_by_sdk20_declaration',
      };
    }),
    added: added.map(rule => ({
      id: compactRuleId(rule),
      sourceType: rule.source_type,
      carrier: rule.source_type === 'callback'
        ? rule.parameters[rule.tainted_param_index - 1].type
        : rule.returnType,
      sdkDeclaration: rule.sdk_declaration,
    })),
    duplicateReplacements: duplicateReplacements.map(compactRuleId),
  };
  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  fs.writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify(report.after, null, 2));
  console.log(
    `Removed ${unknown.length} unknown-carrier rules and added ${added.length} SDK-verified rules.`,
  );
}

if (require.main === module) main();

module.exports = {
  UNKNOWN_CARRIER,
  compactRuleId,
  replacements,
  sourceKey,
};
