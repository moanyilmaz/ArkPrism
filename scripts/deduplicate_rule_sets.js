'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

function canonical(value) {
  if (Array.isArray(value)) {
    return `[${value.map(canonical).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map(key => `${JSON.stringify(key)}:${canonical(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function sha256(text) {
  return crypto.createHash('sha256').update(text).digest('hex');
}

function deduplicateFlat(entries) {
  const seen = new Set();
  const retained = [];
  for (const entry of entries) {
    const key = canonical(entry);
    if (seen.has(key)) continue;
    seen.add(key);
    retained.push(entry);
  }
  return retained;
}

function normalizeDetectorEntry(entry) {
  if (entry.class !== '') return entry;
  const normalized = { ...entry };
  delete normalized.class;
  return normalized;
}

function deduplicateDetector(groups) {
  const seen = new Set();
  const result = [];
  for (const group of groups) {
    const retained = [];
    for (const entry of group.privacyApis || []) {
      const normalizedEntry = normalizeDetectorEntry(entry);
      const key = `${canonical(group.systemPackage)}|${canonical(normalizedEntry)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      retained.push(normalizedEntry);
    }
    if (retained.length > 0) {
      result.push({ ...group, privacyApis: retained });
    }
  }
  return result;
}

function entryCount(kind, value) {
  return kind === 'detector'
    ? value.reduce((sum, group) => sum + (group.privacyApis || []).length, 0)
    : value.length;
}

function semanticSet(kind, value) {
  if (kind === 'detector') {
    return new Set(
      value.flatMap(group =>
        (group.privacyApis || []).map(
          entry =>
            `${canonical(group.systemPackage)}|${canonical(
              normalizeDetectorEntry(entry)
            )}`
        )
      )
    );
  }
  return new Set(value.map(canonical));
}

function equalSets(left, right) {
  return left.size === right.size && [...left].every(key => right.has(key));
}

function processFile(file, kind, write) {
  const beforeText = fs.readFileSync(file, 'utf8');
  const before = JSON.parse(beforeText);
  const after =
    kind === 'detector'
      ? deduplicateDetector(before)
      : deduplicateFlat(before);
  const beforeSet = semanticSet(kind, before);
  const afterSet = semanticSet(kind, after);
  if (!equalSets(beforeSet, afterSet)) {
    throw new Error(`Semantic rule set changed while deduplicating ${file}`);
  }
  const afterText = `${JSON.stringify(after, null, 2)}\n`;
  if (write) fs.writeFileSync(file, afterText);
  return {
    file: path.relative(ROOT, file).replace(/\\/g, '/'),
    beforeEntries: entryCount(kind, before),
    afterEntries: entryCount(kind, after),
    removedExactDuplicates:
      entryCount(kind, before) - entryCount(kind, after),
    semanticKeys: beforeSet.size,
    beforeSha256: sha256(beforeText),
    afterSha256: sha256(afterText),
    written: write,
  };
}

function main() {
  const write = process.argv.includes('--write');
  const results = [
    processFile(
      path.join(ROOT, 'config', 'sensitive_apis.json'),
      'detector',
      write
    ),
    processFile(
      path.join(ROOT, 'config', 'hapflow_sources.json'),
      'flat',
      write
    ),
  ];
  console.log(JSON.stringify({ write, results }, null, 2));
}

if (require.main === module) {
  main();
}

module.exports = {
  canonical,
  deduplicateDetector,
  deduplicateFlat,
  normalizeDetectorEntry,
  semanticSet,
  equalSets,
};
