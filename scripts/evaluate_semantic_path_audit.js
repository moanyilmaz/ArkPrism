#!/usr/bin/env node

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const DIMENSIONS = [
  'sourceIdentityCorrect',
  'sinkIdentityCorrect',
  'explicitDataDependence',
  'reachabilityConsistent',
  'provenanceCorrect',
];

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 2) {
    const token = argv[index];
    if (!token.startsWith('--') || !argv[index + 1]) throw new Error(`Invalid argument: ${token}`);
    args[token.slice(2)] = path.resolve(argv[index + 1]);
  }
  for (const required of ['queue', 'decisions', 'output']) {
    if (!args[required]) throw new Error(`--${required} is required`);
  }
  return args;
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function resolveUnder(root, ...parts) {
  const resolvedRoot = path.resolve(root);
  const target = path.resolve(resolvedRoot, ...parts);
  const relative = path.relative(resolvedRoot, target);
  if (relative.startsWith('..') || path.isAbsolute(relative)) return null;
  return target;
}

function verifyQueueArtifacts(queue, overrides = {}) {
  const datasetValue = overrides.dataset || queue.datasetDirectory;
  const reportsValue = overrides.reports || queue.reportsDirectory;
  const datasetRoot = path.resolve(datasetValue || '');
  const reportsRoot = path.resolve(reportsValue || '');
  if (!datasetValue || !fs.existsSync(datasetRoot)) {
    throw new Error(`Queue dataset directory is missing: ${datasetValue || '(missing)'}`);
  }
  if (!reportsValue || !fs.existsSync(reportsRoot)) {
    throw new Error(`Queue reports directory is missing: ${reportsValue || '(missing)'}`);
  }
  const runManifestPath = path.join(reportsRoot, 'run_manifest.json');
  if (!queue.runManifestSha256 || !fs.existsSync(runManifestPath)) {
    throw new Error('Queue run manifest fingerprint is missing');
  }
  if (sha256(fs.readFileSync(runManifestPath)) !== queue.runManifestSha256) {
    throw new Error('Queue run manifest hash mismatch');
  }

  let filesVerified = 0;
  let reportsVerified = 0;
  for (const record of queue.records || []) {
    const projectRoot = resolveUnder(datasetRoot, record.project);
    if (!projectRoot || !fs.existsSync(projectRoot)) {
      throw new Error(`${record.id}: project directory is missing`);
    }
    for (const [role, relativePath, expectedHash, line] of [
      ['source', record.sourceFile, record.sourceFileSha256, record.sourceLine],
      ['sink', record.sinkFile, record.sinkFileSha256, record.sinkLine],
    ]) {
      const filePath = relativePath ? resolveUnder(projectRoot, relativePath) : null;
      if (!filePath || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
        throw new Error(`${record.id}: ${role} file is missing or escapes the project`);
      }
      const actualHash = sha256(fs.readFileSync(filePath));
      if (!expectedHash || actualHash !== expectedHash) {
        throw new Error(`${record.id}: ${role} file hash mismatch`);
      }
      const lineCount = fs.readFileSync(filePath, 'utf8').split(/\r?\n/).length;
      if (!Number.isInteger(line) || line <= 0 || line > lineCount) {
        throw new Error(`${record.id}: ${role} line is outside the source file`);
      }
      filesVerified += 1;
    }

    const reportPath = record.report ? resolveUnder(reportsRoot, record.report) : null;
    if (!reportPath || !fs.existsSync(reportPath) || !fs.statSync(reportPath).isFile()) {
      throw new Error(`${record.id}: report is missing or escapes the report directory`);
    }
    if (!record.reportSha256 || sha256(fs.readFileSync(reportPath)) !== record.reportSha256) {
      throw new Error(`${record.id}: report hash mismatch`);
    }
    reportsVerified += 1;
  }
  return { filesVerified, reportsVerified, runManifestVerified: true };
}

function wilson(successes, total, z = 1.959963984540054) {
  if (total === 0) return { estimate: null, lower: null, upper: null };
  const p = successes / total;
  const z2 = z * z;
  const denominator = 1 + z2 / total;
  const center = (p + z2 / (2 * total)) / denominator;
  const half = z * Math.sqrt((p * (1 - p) + z2 / (4 * total)) / total) / denominator;
  return { estimate: p, lower: Math.max(0, center - half), upper: Math.min(1, center + half) };
}

function metric(items, field) {
  const successes = items.filter(item => item.decision[field]).length;
  return { successes, total: items.length, ...wilson(successes, items.length) };
}

function grouped(items, field) {
  const groups = new Map();
  for (const item of items) {
    const value = item.record[field];
    groups.set(value, (groups.get(value) || []).concat(item));
  }
  return Object.fromEntries([...groups.entries()]
    .sort(([left], [right]) => String(left).localeCompare(String(right)))
    .map(([key, values]) => [key, metric(values, 'fullPathCorrect')]));
}

function percent(value) {
  return value === null ? '--' : `${(100 * value).toFixed(2)}%`;
}

function markdown(result) {
  const lines = [
    '# Semantic Path Audit',
    '',
    `Queue SHA-256: \`${result.queueSha256}\``,
    '',
    '| Dimension | Correct | Audited | Estimate | 95% Wilson CI |',
    '|---|---:|---:|---:|---:|',
  ];
  for (const [name, value] of Object.entries(result.metrics)) {
    lines.push(
      `| ${name} | ${value.successes} | ${value.total} | ${percent(value.estimate)} | `
      + `${percent(value.lower)}--${percent(value.upper)} |`,
    );
  }
  lines.push('', '## Rejected Paths', '');
  if (result.rejected.length === 0) lines.push('None.');
  for (const item of result.rejected) {
    lines.push(`- \`${item.id}\` (${item.project}): ${item.evidence}`);
  }
  return `${lines.join('\n')}\n`;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const queueBytes = fs.readFileSync(args.queue);
  const queue = JSON.parse(queueBytes);
  const manual = JSON.parse(fs.readFileSync(args.decisions));
  const queueHash = sha256(queueBytes);
  const artifactVerification = verifyQueueArtifacts(queue, args);
  if (manual.role !== 'manual-semantic-path-decisions') {
    throw new Error('Decision file has the wrong role');
  }
  if (manual.reviewQueueSha256 !== queueHash) {
    throw new Error('Decision file does not match the review queue');
  }

  const recordById = new Map((queue.records || []).map(record => [record.id, record]));
  if (recordById.size !== (queue.records || []).length) throw new Error('Duplicate queue record IDs');
  const decisionById = new Map();
  for (const decision of manual.decisions || []) {
    if (!recordById.has(decision.id)) throw new Error(`Decision absent from queue: ${decision.id}`);
    if (decisionById.has(decision.id)) throw new Error(`Duplicate decision: ${decision.id}`);
    for (const field of [...DIMENSIONS, 'fullPathCorrect']) {
      if (typeof decision[field] !== 'boolean') throw new Error(`${decision.id}: ${field} must be boolean`);
    }
    const conjunction = DIMENSIONS.every(field => decision[field]);
    if (decision.fullPathCorrect !== conjunction) {
      throw new Error(`${decision.id}: fullPathCorrect must equal the conjunction of audited dimensions`);
    }
    if (typeof decision.evidence !== 'string' || decision.evidence.trim().length < 8) {
      throw new Error(`${decision.id}: missing manual evidence note`);
    }
    decisionById.set(decision.id, decision);
  }
  if (decisionById.size !== recordById.size) {
    const missing = [...recordById.keys()].filter(id => !decisionById.has(id));
    throw new Error(`Unreviewed semantic paths: ${missing.join(', ')}`);
  }

  const reviewed = [...recordById.values()].map(record => ({
    record,
    decision: decisionById.get(record.id),
  }));
  const metrics = Object.fromEntries(
    [...DIMENSIONS, 'fullPathCorrect'].map(field => [field, metric(reviewed, field)]),
  );
  const result = {
    schemaVersion: 1,
    benchmark: 'ArkSemanticPath120',
    queueSha256: queueHash,
    decisionSha256: sha256(fs.readFileSync(args.decisions)),
    sample: queue.sample,
    artifactVerification,
    metrics,
    fullPathBreakdown: {
      sourceKind: grouped(reviewed, 'sourceKind'),
      provenance: grouped(reviewed, 'provenance'),
      sinkFamily: grouped(reviewed, 'sinkFamily'),
      pathLengthBin: grouped(reviewed, 'pathLengthBin'),
    },
    rejected: reviewed
      .filter(item => !item.decision.fullPathCorrect)
      .map(item => ({
        id: item.record.id,
        project: item.record.project,
        sourceKind: item.record.sourceKind,
        provenance: item.record.provenance,
        evidence: item.decision.evidence,
      })),
  };
  fs.mkdirSync(args.output, { recursive: true });
  fs.writeFileSync(path.join(args.output, 'semantic_path_audit.json'), `${JSON.stringify(result, null, 2)}\n`);
  fs.writeFileSync(path.join(args.output, 'semantic_path_audit.md'), markdown(result));
  console.log(JSON.stringify(result, null, 2));
}

if (require.main === module) main();

module.exports = { DIMENSIONS, metric, resolveUnder, verifyQueueArtifacts, wilson };
