'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const FILES = {
  detector: path.join(ROOT, 'config', 'sensitive_apis.json'),
  sources: path.join(ROOT, 'config', 'hapflow_sources.json'),
  sinks: path.join(ROOT, 'config', 'hapflow_sinks.json'),
};

function parseArgs(argv) {
  const outputIndex = argv.indexOf('--output-dir');
  return {
    outputDir:
      outputIndex >= 0 && argv[outputIndex + 1]
        ? path.resolve(argv[outputIndex + 1])
        : path.join(ROOT, 'docs', 'rule_set_audit'),
  };
}

function readJson(file) {
  const buffer = fs.readFileSync(file);
  return {
    value: JSON.parse(buffer.toString('utf8')),
    sha256: crypto.createHash('sha256').update(buffer).digest('hex'),
  };
}

function normalized(value) {
  return String(value == null ? '' : value).trim().toLowerCase();
}

function countBy(values, selector) {
  const counts = {};
  for (const value of values) {
    const key = selector(value);
    counts[key] = (counts[key] || 0) + 1;
  }
  return Object.fromEntries(
    Object.entries(counts).sort((left, right) => {
      const countOrder = right[1] - left[1];
      return countOrder || left[0].localeCompare(right[0]);
    })
  );
}

function accessKind(entry) {
  if (!/\)\s*:/.test(String(entry.descrip0 || ''))) return 'property';
  if (String(entry.call_catagory || '').trim() === '直接调用') return 'direct';
  if (String(entry.call_catagory || '').trim() === '间接调用') return 'manager_receiver';
  return 'invalid';
}

function detectorIdentity(entry) {
  const signature = String(entry.api_signature || '').trim();
  const callIndex = signature.indexOf('(');
  const head = callIndex >= 0 ? signature.slice(0, callIndex) : signature;
  const suffix = callIndex >= 0 ? signature.slice(callIndex) : '';
  const parts = head.split('.').filter(Boolean);
  const namespace = parts.length > 1 ? parts[0] : parts[0] || '';
  const method = parts.length > 1 ? `${parts.slice(1).join('.')}${suffix}` : `${namespace}${suffix}`;
  return { namespace, method };
}

function detectorAudit(records) {
  const entries = records.map(record => ({
    ...record,
    package: record.import_kit,
    ...detectorIdentity(record),
  }));

  const exactCounts = countBy(entries, entry =>
    [
      normalized(entry.package),
      normalized(entry.api_signature),
      accessKind(entry),
      normalized(entry.permission),
      normalized(entry.dataType),
      normalized(entry.label),
      normalized(entry.descrip0),
    ].join('|')
  );
  const duplicates = Object.entries(exactCounts)
    .filter(([, count]) => count > 1)
    .map(([key, count]) => ({ key, count }));

  const modesByApi = new Map();
  for (const entry of entries) {
    const key = [
      normalized(entry.package),
      normalized(entry.api_signature),
    ].join('|');
    if (!modesByApi.has(key)) modesByApi.set(key, new Set());
    modesByApi.get(key).add(accessKind(entry));
  }
  const modeVariants = [...modesByApi.entries()]
    .filter(([, modes]) => modes.size > 1)
    .map(([key, modes]) => ({ key, modes: [...modes].sort() }));

  const missing = entries
    .map((entry, index) => ({
      index,
      package: entry.package,
      namespace: entry.namespace,
      method: entry.method,
      missing: [
        !normalized(entry.package) && 'package',
        !normalized(entry.api_signature) && 'api_signature',
        !normalized(entry.descrip0) && 'descrip0',
        !normalized(entry.dataType) && 'dataType',
        !normalized(entry.label) && 'label',
      ].filter(Boolean),
    }))
    .filter(item => item.missing.length > 0);

  const invalidDirectCall = entries
    .map((entry, index) => ({ index, value: entry.call_catagory }))
    .filter(item => !['直接调用', '间接调用'].includes(String(item.value || '').trim()));

  const pacMappings = new Map();
  for (const entry of entries) {
    const key = `${normalized(entry.package)}|${normalized(entry.api_signature)}`;
    if (!pacMappings.has(key)) pacMappings.set(key, new Set());
    pacMappings.get(key).add(`${entry.dataType}|${entry.label}`);
  }
  const pacMappingConflicts = [...pacMappings.entries()]
    .filter(([, mappings]) => mappings.size > 1)
    .map(([key, mappings]) => ({ key, mappings: [...mappings].sort() }));

  return {
    packageGroups: new Set(entries.map(entry => normalized(entry.package))).size,
    entries: entries.length,
    uniquePackageNamespaceMembers: modesByApi.size,
    uniqueNamespaceMembers: new Set(
      entries.map(entry =>
        `${normalized(entry.namespace)}|${normalized(entry.method)}`
      )
    ).size,
    accessKinds: countBy(entries, accessKind),
    categories: countBy(entries, entry =>
      `${entry.dataType}|${entry.label}`
    ),
    permissionCoverage: {
      withPermission: entries.filter(entry => entry.permission != null).length,
      withoutPermission: entries.filter(entry => entry.permission == null).length,
      distinctPermissions: new Set(
        entries
          .filter(entry => entry.permission != null)
          .map(entry => normalized(entry.permission))
      ).size,
    },
    receiverFactories: {
      entriesWithFactories: 0,
      distinctFactories: 0,
      managerEntriesUsingTypeOrTargetOnly: entries
        .filter(entry => accessKind(entry) === 'manager_receiver')
        .map(entry => ({
          package: entry.package,
          namespace: entry.namespace,
          method: entry.method,
        })),
    },
    integrity: {
      missingRequiredFields: missing,
      invalidDirectCall,
      exactDuplicates: duplicates,
      accessModeVariants: modeVariants,
      pacMappingConflicts,
    },
  };
}

function ifdsAudit(sources, sinks) {
  const hasConcreteCarrier = type => {
    const value = String(type || '').trim();
    return Boolean(value) &&
      !/(^|[<|,&()[\]\s])(?:any|unknown|object|void|undefined|never)(?=$|[>|,&()[\]\s])/i
        .test(value);
  };
  const sourceKey = entry =>
    [
      normalized(entry.module),
      normalized(entry.class),
      normalized(entry.namespace),
      normalized(entry.api_name),
      normalized(entry.source_type),
      String(entry.tainted_param_index),
      JSON.stringify(entry.parameters || []),
      normalized(entry.returnType),
    ].join('|');
  const sinkKey = entry =>
    [
      normalized(entry.module),
      normalized(entry.class),
      normalized(entry.namespace),
      normalized(entry.api_name),
      JSON.stringify(entry.parameters || []),
      normalized(entry.returnType),
    ].join('|');

  const invalidSources = sources
    .map((entry, index) => ({
      index,
      api: entry.api_name,
      sourceType: entry.source_type,
      sourceKind: entry.source_kind,
      taintedParamIndex: entry.tainted_param_index,
      parameters: entry.parameters,
      returnType: entry.returnType,
      reason: entry.reason,
      sensitivity: entry.sensitivity,
    }))
    .filter(
      item =>
        !['return', 'callback'].includes(item.sourceType) ||
        item.sourceKind !== 'privacy_data' ||
        !Array.isArray(item.parameters) ||
        !normalized(item.reason) ||
        !normalized(item.sensitivity) ||
        (item.sourceType === 'callback' &&
          (!Number.isInteger(item.taintedParamIndex) ||
            item.taintedParamIndex < 1 ||
            !/(?:Async)?Callback\s*</.test(
              String(item.parameters?.[item.taintedParamIndex - 1]?.type || ''),
            ))) ||
        (item.sourceType === 'return' &&
          (item.taintedParamIndex !== -1 ||
            !hasConcreteCarrier(item.returnType)))
    );
  const invalidSinks = sinks
    .map((entry, index) => ({ index, api: entry.api_name, isSink: entry.is_sink }))
    .filter(item => normalized(item.isSink) !== 'yes');

  return {
    sources: {
      entries: sources.length,
      sourceTypes: countBy(sources, entry => normalized(entry.source_type)),
      sourceKinds: countBy(sources, entry => normalized(entry.source_kind)),
      ruleOrigins: countBy(sources, entry => normalized(entry.rule_origin)),
      sensitivities: countBy(sources, entry => normalized(entry.sensitivity)),
      exactDuplicates: Object.entries(countBy(sources, sourceKey))
        .filter(([, count]) => count > 1)
        .map(([key, count]) => ({ key, count })),
      invalidEntries: invalidSources,
    },
    sinks: {
      entries: sinks.length,
      exactDuplicates: Object.entries(countBy(sinks, sinkKey))
        .filter(([, count]) => count > 1)
        .map(([key, count]) => ({ key, count })),
      invalidEntries: invalidSinks,
    },
  };
}

function markdown(result) {
  const detector = result.detector;
  const ifds = result.ifds;
  const integrity = detector.integrity;
  return [
    '# Rule-set Audit',
    '',
    'This report checks structural consistency and provenance hashes. It does not establish that the rule sets are semantically exhaustive.',
    '',
    '| Measure | Value |',
    '|---|---:|',
    `| Detector package groups | ${detector.packageGroups} |`,
    `| Detector entries | ${detector.entries} |`,
    `| Unique package-namespace-member keys | ${detector.uniquePackageNamespaceMembers} |`,
    `| Unique namespace-member keys | ${detector.uniqueNamespaceMembers} |`,
    `| Direct / manager / property entries | ${detector.accessKinds.direct || 0} / ${detector.accessKinds.manager_receiver || 0} / ${detector.accessKinds.property || 0} |`,
    `| Entries with receiver factories | ${detector.receiverFactories.entriesWithFactories} |`,
    `| Distinct receiver factories | ${detector.receiverFactories.distinctFactories} |`,
    `| Entries with permission metadata | ${detector.permissionCoverage.withPermission} |`,
    `| IFDS source entries | ${ifds.sources.entries} |`,
    `| Typed privacy-data source entries | ${ifds.sources.sourceKinds.privacy_data || 0} |`,
    `| IFDS sink entries | ${ifds.sinks.entries} |`,
    '',
    '## Integrity Findings',
    '',
    '| Check | Count |',
    '|---|---:|',
    `| Missing detector fields | ${integrity.missingRequiredFields.length} |`,
    `| Invalid directCall values | ${integrity.invalidDirectCall.length} |`,
    `| Exact detector duplicates | ${integrity.exactDuplicates.length} |`,
    `| Detector keys with multiple access modes | ${integrity.accessModeVariants.length} |`,
    `| PAC mapping conflicts | ${integrity.pacMappingConflicts.length} |`,
    `| Manager entries relying on type/target evidence | ${detector.receiverFactories.managerEntriesUsingTypeOrTargetOnly.length} |`,
    `| Invalid IFDS source entries | ${ifds.sources.invalidEntries.length} |`,
    `| Invalid IFDS sink entries | ${ifds.sinks.invalidEntries.length} |`,
    '',
    'The JSON companion retains every duplicate, conflict, and missing-field record for review.',
    '',
  ].join('\n');
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const detector = readJson(FILES.detector);
  const sources = readJson(FILES.sources);
  const sinks = readJson(FILES.sinks);
  const result = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    scope:
      'Structural consistency only; semantic completeness and privacy categorization require independent expert review.',
    hashes: {
      'sensitive_apis.json': detector.sha256,
      'hapflow_sources.json': sources.sha256,
      'hapflow_sinks.json': sinks.sha256,
    },
    detector: detectorAudit(detector.value),
    packageInventory: {
      entries: detector.value.length,
      uniqueEntries: new Set(detector.value.map(entry => normalized(entry.import_kit))).size,
      duplicates: 0,
    },
    ifds: ifdsAudit(sources.value, sinks.value),
  };

  fs.mkdirSync(args.outputDir, { recursive: true });
  fs.writeFileSync(
    path.join(args.outputDir, 'rule_set_audit.json'),
    `${JSON.stringify(result, null, 2)}\n`
  );
  fs.writeFileSync(
    path.join(args.outputDir, 'rule_set_audit.md'),
    markdown(result)
  );
  console.log(
    JSON.stringify({
      outputDir: args.outputDir,
      detectorEntries: result.detector.entries,
      ifdsSources: result.ifds.sources.entries,
      ifdsSinks: result.ifds.sinks.entries,
      integrity: {
        missingRequiredFields:
          result.detector.integrity.missingRequiredFields.length,
        invalidDirectCall: result.detector.integrity.invalidDirectCall.length,
        invalidIfdsSources: result.ifds.sources.invalidEntries.length,
        invalidIfdsSinks: result.ifds.sinks.invalidEntries.length,
      },
    })
  );
}

if (require.main === module) {
  main();
}

module.exports = {
  detectorAudit,
  ifdsAudit,
};
