#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const {
  candidateFromFlow,
  countBy,
  createSourceCache,
  reportPaths,
  sha256,
  sha256File,
} = require('./select_semantic_path_audit');

function usage() {
  return [
    'Usage: node scripts/rebind_semantic_path_audit.js',
    '  --queue <review-queue.json> --decisions <manual-decisions.json>',
    '  --reports <new-run-dir> --dataset <corpus-dir>',
    '  --output-queue <json> --output-mapping <json>',
    '  --output-decision-template <json>',
  ].join('\n');
}

function parseArgs(argv) {
  if (argv.includes('--help') || argv.includes('-h')) {
    console.log(usage());
    process.exit(0);
  }
  const args = {};
  for (let index = 0; index < argv.length; index += 2) {
    const token = argv[index];
    const value = argv[index + 1];
    if (!token?.startsWith('--') || !value) throw new Error(`Invalid argument: ${token || ''}`);
    args[token.slice(2)] = path.resolve(value);
  }
  for (const required of [
    'queue',
    'decisions',
    'reports',
    'dataset',
    'output-queue',
    'output-mapping',
    'output-decision-template',
  ]) {
    if (!args[required]) throw new Error(`--${required} is required\n${usage()}`);
  }
  return args;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, ''));
}

function identityKey(identity = {}) {
  return {
    module: String(identity.module || ''),
    namespace: String(identity.namespace || ''),
    className: String(identity.className || ''),
    apiName: String(identity.apiName || ''),
    sourceType: String(identity.sourceType || ''),
    sourceIndex: Number(identity.sourceIndex),
    callbackIndex: Number(identity.callbackIndex),
  };
}

function stablePathKey(record) {
  return JSON.stringify({
    project: record.project,
    sourceKind: record.sourceKind,
    sourceIdentity: identityKey(record.sourceIdentity),
    sourceApi: record.sourceApi,
    sourceFile: record.sourceFile,
    sourceLine: record.sourceLine,
    sinkApi: record.sinkApi,
    sinkFile: record.sinkFile,
    sinkLine: record.sinkLine,
    path: (record.path || []).map(entry => ({
      statement: entry.statement,
      file: entry.file,
      line: entry.line,
      method: entry.method,
    })),
  });
}

function assertArtifactIdentity(previous, current) {
  for (const field of ['sourceFileSha256', 'sinkFileSha256']) {
    if (!previous[field] || previous[field] !== current[field]) {
      throw new Error(`${previous.id}: ${field} changed`);
    }
  }
}

function matchRecords(previousRecords, candidates) {
  const candidatesByKey = new Map();
  for (const candidate of candidates) {
    const key = stablePathKey(candidate);
    const bucket = candidatesByKey.get(key) || [];
    bucket.push(candidate);
    candidatesByKey.set(key, bucket);
  }
  const used = new Set();
  return previousRecords.map((previous) => {
    const matches = candidatesByKey.get(stablePathKey(previous)) || [];
    if (matches.length !== 1) {
      throw new Error(`${previous.id}: expected one exact path in the new run, found ${matches.length}`);
    }
    const [current] = matches;
    if (used.has(current.id)) throw new Error(`${previous.id}: new path ${current.id} was matched twice`);
    used.add(current.id);
    assertArtifactIdentity(previous, current);
    return {
      previous,
      current,
      provenanceChanged: previous.provenance !== current.provenance,
      derivationsChanged: JSON.stringify(previous.analysisDerivations || [])
        !== JSON.stringify(current.analysisDerivations || []),
      carrierStateChanged: (previous.carrierState || null) !== (current.carrierState || null),
    };
  });
}

function buildCandidates(reportRoot, datasetRoot) {
  const sourceCache = createSourceCache();
  const candidates = [];
  for (const reportPath of reportPaths(reportRoot)) {
    const report = readJson(reportPath);
    const reportHash = sha256File(reportPath);
    (report.taintFlows || []).forEach((flow, flowIndex) => {
      if (!['privacy_data', 'framework_input'].includes(flow.sourceKind)) return;
      if (!['ifds', 'async_supplement', 'both'].includes(flow.provenance)) return;
      candidates.push(candidateFromFlow({
        report,
        reportPath,
        reportRoot,
        reportHash,
        flow,
        flowIndex,
        datasetRoot,
        sourceCache,
      }));
    });
  }
  return candidates;
}

function sampleSummary(records) {
  return {
    paths: records.length,
    projects: new Set(records.map(record => record.project)).size,
    sourceKind: countBy(records, 'sourceKind'),
    provenance: countBy(records, 'provenance'),
    sinkFamily: countBy(records, 'sinkFamily'),
    pathLengthBin: countBy(records, 'pathLengthBin'),
    strata: countBy(records, 'stratum'),
  };
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const previousQueueBytes = fs.readFileSync(args.queue);
  const previousQueue = JSON.parse(previousQueueBytes.toString('utf8').replace(/^\uFEFF/, ''));
  const previousDecisions = readJson(args.decisions);
  const previousQueueHash = sha256(previousQueueBytes);
  if (previousDecisions.role !== 'manual-semantic-path-decisions') {
    throw new Error('The predecessor decision file is not a finalized manual audit');
  }
  if (previousDecisions.reviewQueueSha256 !== previousQueueHash) {
    throw new Error('The predecessor decisions do not match the predecessor queue');
  }

  const manifestPath = path.join(args.reports, 'run_manifest.json');
  const manifest = readJson(manifestPath);
  if (manifest.status !== 'complete') throw new Error(`New run status is ${manifest.status}`);
  if (Number(manifest.progress?.errors) !== 0) throw new Error('New run contains errors');
  const expectedProjects = Number(manifest.inputs?.projectCount);
  if (!Number.isInteger(expectedProjects) || expectedProjects <= 0) {
    throw new Error('New run manifest has no valid project count');
  }
  if (Number(manifest.progress?.completed) !== expectedProjects) {
    throw new Error('New run manifest is not complete at the project level');
  }
  const reportCount = reportPaths(args.reports).length;
  if (reportCount !== expectedProjects) {
    throw new Error(`New run contains ${reportCount}/${expectedProjects} reports`);
  }

  const candidates = buildCandidates(args.reports, args.dataset);
  const matches = matchRecords(previousQueue.records || [], candidates);
  const reboundRecords = matches.map(match => ({
    ...match.current,
    predecessorId: match.previous.id,
    rebindEvidence: 'exact source, sink, source identity, and normalized statement path',
  }));
  const reboundQueue = {
    schemaVersion: 3,
    reportsDirectory: args.reports,
    datasetDirectory: args.dataset,
    runManifestSha256: sha256File(manifestPath),
    selectionAlgorithm: 'exact-path-rebind-v1',
    predecessorQueueSha256: previousQueueHash,
    requested: previousQueue.requested,
    population: {
      paths: candidates.length,
      sourceKind: countBy(candidates, 'sourceKind'),
      provenance: countBy(candidates, 'provenance'),
      sinkFamily: countBy(candidates, 'sinkFamily'),
      pathLengthBin: countBy(candidates, 'pathLengthBin'),
      strata: countBy(candidates, 'stratum'),
    },
    sample: sampleSummary(reboundRecords),
    records: reboundRecords,
  };
  writeJson(args['output-queue'], reboundQueue);
  const reboundQueueHash = sha256(fs.readFileSync(args['output-queue']));

  const decisionById = new Map((previousDecisions.decisions || []).map(item => [item.id, item]));
  if (decisionById.size !== (previousDecisions.decisions || []).length) {
    throw new Error('The predecessor decision file contains duplicate IDs');
  }
  if (decisionById.size !== (previousQueue.records || []).length) {
    throw new Error('The predecessor decision file is incomplete');
  }
  const decisionTemplate = {
    schemaVersion: previousDecisions.schemaVersion || 1,
    role: 'draft-rebound-semantic-path-decisions',
    reviewQueueSha256: reboundQueueHash,
    predecessorDecisionSha256: sha256(fs.readFileSync(args.decisions)),
    decisions: matches.map((match) => {
      const previousDecision = decisionById.get(match.previous.id);
      if (!previousDecision) throw new Error(`Missing predecessor decision: ${match.previous.id}`);
      const needsReview = match.provenanceChanged || match.derivationsChanged;
      return {
        ...previousDecision,
        id: match.current.id,
        predecessorId: match.previous.id,
        rebindStatus: needsReview ? 'provenance_review_required' : 'exact_path_unchanged',
        provenanceCorrect: needsReview ? null : previousDecision.provenanceCorrect,
        fullPathCorrect: needsReview ? null : previousDecision.fullPathCorrect,
      };
    }),
  };
  writeJson(args['output-decision-template'], decisionTemplate);

  const mapping = {
    schemaVersion: 1,
    predecessorQueueSha256: previousQueueHash,
    reboundQueueSha256: reboundQueueHash,
    total: matches.length,
    exactUnchanged: matches.filter(match => !(
      match.provenanceChanged || match.derivationsChanged
    )).length,
    provenanceReviewRequired: matches.filter(match => (
      match.provenanceChanged || match.derivationsChanged
    )).map(match => ({
      project: match.current.project,
      previousId: match.previous.id,
      currentId: match.current.id,
      previousProvenance: match.previous.provenance,
      currentProvenance: match.current.provenance,
      previousDerivations: match.previous.analysisDerivations || [],
      currentDerivations: match.current.analysisDerivations || [],
      previousCarrierState: match.previous.carrierState || null,
      currentCarrierState: match.current.carrierState || null,
    })),
  };
  writeJson(args['output-mapping'], mapping);
  console.log(JSON.stringify(mapping, null, 2));
}

if (require.main === module) main();

module.exports = { assertArtifactIdentity, identityKey, matchRecords, stablePathKey };
