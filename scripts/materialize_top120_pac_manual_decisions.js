'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith('--') || !value) throw new Error(`Invalid argument: ${key}`);
    args[key.slice(2)] = path.resolve(value);
  }
  for (const required of ['queue', 'workbook', 'output']) {
    if (!args[required]) throw new Error(`--${required} is required`);
  }
  return args;
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function apiIdentity(rule) {
  return {
    package: rule.package,
    namespace: rule.namespace,
    method: rule.configuredMethod,
  };
}

const REVIEWED_INDIRECT = new Map([
  ['harmonyos_samples_CustomCamera|camera/src/main/ets/cameramanagers/PhotoManager.ets|141|49|requestImageData', 'MediaAssetManager'],
  ['Photos|entry/src/main/ets/common/AlbumDataImpl.ts|102|58|getAlbums', 'PhotoAccessHelper'],
  ['Photos|entry/src/main/ets/common/AlbumDataImpl.ts|174|58|getAlbums', 'PhotoAccessHelper'],
  ['Photos|entry/src/main/ets/common/AlbumDataImpl.ts|211|63|getAssets', 'PhotoAccessHelper'],
  ['Photos|entry/src/main/ets/common/AlbumDataImpl.ts|242|63|getAssets', 'PhotoAccessHelper'],
  ['Photos|entry/src/main/ets/menus/TranscodingMenuOperation.ts|111|49|requestVideoFile', 'MediaAssetManager'],
  ['ChildrenEducation|commons/utils/src/main/ets/utils/AuthUtil.ets|86|33|on', 'UserAuthInstance'],
  ['ChildrenEducation|commons/utils/src/main/ets/utils/AuthUtil.ets|100|33|start', 'UserAuthInstance'],
  ['harmonyos_samples_graphic-creation|entry/src/main/ets/pages/PreviewMovingPhotoPage.ets|203|41|requestMovingPhoto', 'MediaAssetManager'],
  ['Notes|components/secretlock/src/main/ets/util/AuthUtil.ets|84|33|on', 'UserAuthInstance'],
  ['Notes|components/secretlock/src/main/ets/util/AuthUtil.ets|98|33|start', 'UserAuthInstance'],
  ['ReminderAgentManager|entry/src/main/ets/pages/timer/Timer.ets|191|18|getCalendar', 'CalendarManager'],
  ['ReminderAgentManager|entry/src/main/ets/util/AlarmClockReminder.ets|47|18|getCalendar', 'CalendarManager'],
  ['ReminderAgentManager|entry/src/main/ets/util/CalendarReminder.ets|44|18|getCalendar', 'CalendarManager'],
]);

const DYNAMIC_SENSOR_CALLS = new Map([
  ['SensorJsSamples|entry/src/main/ets/pages/Index.ets|252|28|on', 'all'],
  ['SensorJsSamples|entry/src/main/ets/pages/Index.ets|265|22|on', 'all'],
  ['Sensor|entry/src/main/ets/pages/Index.ets|166|28|on', 'all'],
  ['Sensor|entry/src/main/ets/pages/Index.ets|177|22|on', 'all'],
  ['Sensor|entry/src/main/ets/pages/Index.ets|192|20|on', 'ACCELEROMETER'],
  ['Sensor|entry/src/main/ets/pages/Index.ets|204|20|once', 'all'],
]);

function rejectionReason(candidate) {
  if (candidate.receiverTypeHint) return 'receiver type is unrelated to the configured API';
  if (/^(this|[A-Z][A-Za-z0-9_$]*)$/.test(candidate.receiver)) {
    return 'application member has the same name but no configured API receiver';
  }
  if ((candidate.importBindings || []).some(binding => binding.local === candidate.receiver)) {
    return 'receiver resolves to a different imported module';
  }
  return 'no package, receiver-type, or factory-origin evidence for the configured API';
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const queueBytes = fs.readFileSync(args.queue);
  const queue = JSON.parse(queueBytes);
  const workbook = JSON.parse(fs.readFileSync(args.workbook, 'utf8'));
  const decisions = [];
  const consumedIndirect = new Set();
  const consumedDynamic = new Set();

  for (const candidate of workbook.candidates) {
    const strong = candidate.ruleEvidence.filter(item => item.evidence.length > 0);
    if (strong.length === 1) {
      const evidencePrefix = strong[0].evidence[0].split(':')[0];
      decisions.push({
        key: candidate.key,
        decision: 'accept',
        api: apiIdentity(strong[0].rule),
        evidenceKind: evidencePrefix,
      });
      continue;
    }

    const reviewedNamespace = REVIEWED_INDIRECT.get(candidate.key);
    if (reviewedNamespace) {
      const selected = candidate.candidateApis.find(rule => rule.namespace === reviewedNamespace);
      if (!selected) throw new Error(`Reviewed API missing from candidate: ${candidate.key}`);
      consumedIndirect.add(candidate.key);
      decisions.push({
        key: candidate.key,
        decision: 'accept',
        api: apiIdentity(selected),
        evidenceKind: 'reviewed-receiver-origin',
      });
      continue;
    }

    const sensorSelection = DYNAMIC_SENSOR_CALLS.get(candidate.key);
    if (sensorSelection) {
      const selected = candidate.candidateApis.filter(rule =>
        rule.namespace === 'sensor' &&
        (sensorSelection === 'all' ||
          rule.configuredMethod.match(/SensorId\.([A-Z_]+)/)?.[1] === sensorSelection),
      );
      if (selected.length === 0) throw new Error(`Sensor API set missing: ${candidate.key}`);
      consumedDynamic.add(candidate.key);
      decisions.push({
        key: candidate.key,
        decision: 'accept',
        apis: selected.map(apiIdentity),
        evidenceKind: sensorSelection === 'all' ? 'finite-sensor-id-set' : 'numeric-sensor-id',
      });
      continue;
    }

    decisions.push({
      key: candidate.key,
      decision: 'reject',
      reason: rejectionReason(candidate),
    });
  }

  for (const key of REVIEWED_INDIRECT.keys()) {
    if (!consumedIndirect.has(key)) throw new Error(`Reviewed occurrence absent from queue: ${key}`);
  }
  for (const key of DYNAMIC_SENSOR_CALLS.keys()) {
    if (!consumedDynamic.has(key)) throw new Error(`Dynamic sensor occurrence absent from queue: ${key}`);
  }
  if (decisions.length !== queue.candidateCount) {
    throw new Error(`Decision coverage mismatch: ${decisions.length}/${queue.candidateCount}`);
  }

  const output = {
    schemaVersion: 1,
    benchmark: queue.benchmark,
    role: 'exhaustive-manual-source-decisions',
    reviewQueueSha256: sha256(queueBytes),
    candidateCount: queue.candidateCount,
    decisions,
  };
  fs.mkdirSync(path.dirname(args.output), { recursive: true });
  fs.writeFileSync(args.output, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({
    output: args.output,
    candidates: decisions.length,
    acceptedCandidates: decisions.filter(item => item.decision === 'accept').length,
    acceptedOccurrences: decisions.reduce((sum, item) =>
      sum + (item.decision === 'accept' ? (item.apis?.length || 1) : 0), 0),
    rejectedCandidates: decisions.filter(item => item.decision === 'reject').length,
  }));
}

main();
