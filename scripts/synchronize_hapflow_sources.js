'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const CATALOG_PATH = path.join(ROOT, 'config', 'sensitive_apis.json');
const ALIASES_PATH = path.join(ROOT, 'config', 'package_aliases.json');
const SOURCES_PATH = path.join(ROOT, 'config', 'hapflow_sources.json');
const AUDIT_PATH = path.join(ROOT, 'docs', 'rule_set_audit', 'ifds_source_catalog_sync.json');

function normalized(value) {
  return String(value == null ? '' : value).trim().toLowerCase();
}

function packageClosure(moduleName, aliases) {
  const visited = new Set();
  const queue = [moduleName];
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || visited.has(current)) continue;
    visited.add(current);
    for (const alias of aliases[current] || []) queue.push(alias);
  }
  return visited;
}

function catalogEntry(record, index, aliases) {
  const signature = String(record.api_signature || '').trim();
  const callIndex = signature.indexOf('(');
  const head = callIndex >= 0 ? signature.slice(0, callIndex) : signature;
  const parts = head.split('.').filter(Boolean);
  const member = parts.pop() || '';
  const owners = new Set([parts[0], parts[parts.length - 1]].filter(Boolean).map(normalized));
  for (const match of String(record.possible_module_title || '')
    .matchAll(/\b(?:Class|Interface)\s*\(([A-Za-z_$][\w$]*)\)/g)) {
    owners.add(normalized(match[1]));
  }

  const modules = packageClosure(String(record.import_kit || ''), aliases);
  for (const match of String(record.possible_module_title || '')
    .matchAll(/@(?:ohos|hms)\.[A-Za-z0-9_.]+/g)) {
    for (const moduleName of packageClosure(match[0], aliases)) modules.add(moduleName);
  }

  return {
    index,
    member: normalized(member),
    owners,
    modules: new Set([...modules].map(normalized)),
    event: (signature.match(/['"]([^'"]+)['"]/) || [])[1] || '',
    record,
  };
}

function sourceEvent(source) {
  const firstType = String(source.parameters?.[0]?.type || '');
  const quoted = (firstType.trim().match(/^['"]([^'"]+)['"]$/) || [])[1];
  if (quoted) return normalized(quoted);
  const sensor = firstType.match(/\bSensorId\.([A-Za-z0-9_]+)/);
  return sensor ? normalized(`SensorId.${sensor[1]}`) : '';
}

function matchCatalogSource(source, entries) {
  let candidates = entries.filter(entry =>
    entry.member === normalized(source.api_name) &&
    entry.modules.has(normalized(source.module))
  );
  if (candidates.length === 0) return undefined;

  const sourceOwner = normalized(source.class || source.namespace);
  const ownerMatches = sourceOwner
    ? candidates.filter(entry => entry.owners.has(sourceOwner))
    : [];
  if (ownerMatches.length > 0) candidates = ownerMatches;

  const event = sourceEvent(source);
  const eventRules = candidates.filter(entry => entry.event);
  if (eventRules.length > 0) {
    const eventMatches = eventRules.filter(entry => normalized(entry.event) === event);
    if (eventMatches.length === 0) return undefined;
    candidates = eventMatches;
  }

  return candidates[0];
}

function synchronizeSources(catalog, aliases, sources) {
  const entries = catalog.map((record, index) => catalogEntry(record, index, aliases));
  const retained = [];
  const removed = [];
  for (const source of sources) {
    const match = matchCatalogSource(source, entries);
    if (!match) {
      removed.push(source);
      continue;
    }
    const record = match.record;
    retained.push({
      ...source,
      dataType: record.dataType,
      label: record.label,
      catalogApiSignature: record.api_signature,
      description: record.descrip1 || '',
      documentation: record.URL_postfix || '',
    });
  }
  return { retained, removed };
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function main() {
  const write = process.argv.includes('--write');
  const catalogText = fs.readFileSync(CATALOG_PATH, 'utf8');
  const sourceText = fs.readFileSync(SOURCES_PATH, 'utf8');
  const catalog = JSON.parse(catalogText);
  const aliases = JSON.parse(fs.readFileSync(ALIASES_PATH, 'utf8'));
  const sources = JSON.parse(sourceText);
  const { retained, removed } = synchronizeSources(catalog, aliases, sources);
  const outputText = `${JSON.stringify(retained, null, 2)}\n`;
  const removedIdentities = [...new Set(removed.map(source =>
    [source.module, source.class || '', source.namespace || '', source.api_name].join('|')
  ))].sort();
  const audit = {
    schemaVersion: 1,
    catalogSha256: sha256(catalogText),
    beforeSourceSha256: sha256(sourceText),
    afterSourceSha256: sha256(outputText),
    beforeRows: sources.length,
    retainedRows: retained.length,
    removedRows: removed.length,
    removedIdentities,
  };

  if (write) {
    fs.writeFileSync(SOURCES_PATH, outputText);
    fs.mkdirSync(path.dirname(AUDIT_PATH), { recursive: true });
    fs.writeFileSync(AUDIT_PATH, `${JSON.stringify(audit, null, 2)}\n`);
  }
  console.log(JSON.stringify({ write, ...audit }, null, 2));
}

if (require.main === module) main();

module.exports = { catalogEntry, matchCatalogSource, synchronizeSources };
