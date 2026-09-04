const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const { normalizeSensitiveApiCatalog } = require('../dist/sensitiveApiCatalog');

const root = path.resolve(__dirname, '..');
const dataset = process.env.ARGUS_DATASET;
if (!dataset || !fs.existsSync(dataset)) {
  throw new Error('ARGUS_DATASET must point to the 1,015-project source corpus.');
}

function read(relative) {
  return fs.readFileSync(path.join(root, relative));
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function apiKey(api) {
  return [api.package, api.namespace, api.configuredMethod || api.method].join('|');
}

function candidateKey(project, candidate) {
  return [project, candidate.file, candidate.line, candidate.column, candidate.member].join('|');
}

function normalizeRelative(value) {
  return String(value || '').replace(/\\/g, '/').replace(/^\.\//, '').toLowerCase();
}

const benchmarkDir = 'benchmarks/ArkPrismTop120/pac_v2';
const gold = JSON.parse(read(`${benchmarkDir}/gold.json`));
const manifestBytes = read(`${benchmarkDir}/selection_manifest.json`);
const queueBytes = read(`${benchmarkDir}/review_queue.json`);
const decisionBytes = read(`${benchmarkDir}/manual_review_decisions.json`);
const ruleBytes = read('config/sensitive_apis.json');
const aliasBytes = read('config/package_aliases.json');
const manifest = JSON.parse(manifestBytes);
const queue = JSON.parse(queueBytes);
const manual = JSON.parse(decisionBytes);

assert.strictEqual(gold.benchmark, 'ArkPrismTop120-PAC-v2');
assert.strictEqual(gold.projectCount, 120);
assert.strictEqual(gold.projects.length, 120);
assert.strictEqual(new Set(gold.projects.map(project => project.project)).size, 120);
assert.strictEqual(gold.occurrenceCount, 576);
assert.strictEqual(gold.annotations.length, 576);
assert.strictEqual(gold.acceptedCandidateCount, 496);
assert.strictEqual(gold.rejectedCandidateCount, 746);
assert.strictEqual(gold.acceptedCandidateCount + gold.rejectedCandidateCount, 1242);
assert.strictEqual(gold.selectionManifestSha256, sha256(manifestBytes));
assert.strictEqual(gold.reviewQueueSha256, sha256(queueBytes));
assert.strictEqual(gold.manualDecisionSha256, sha256(decisionBytes));
assert.strictEqual(gold.ruleSetSha256, sha256(ruleBytes));
assert.strictEqual(gold.packageAliasSha256, sha256(aliasBytes));

assert.strictEqual(manifest.projectCount, 120);
assert.strictEqual(manifest.candidateGenerationReadsArkPrismReports, false);
assert.strictEqual(manifest.ruleSetSha256, sha256(ruleBytes));
assert.strictEqual(manifest.packageAliasSha256, sha256(aliasBytes));
assert.strictEqual(queue.projectCount, 120);
assert.strictEqual(queue.candidateCount, 1242);
assert.strictEqual(queue.manifestSha256, sha256(manifestBytes));
assert.strictEqual(manual.role, 'exhaustive-manual-source-decisions');
assert.strictEqual(manual.reviewQueueSha256, sha256(queueBytes));
assert.strictEqual(manual.candidateCount, 1242);
assert.strictEqual(manual.decisions.length, 1242);
assert.strictEqual(new Set(manual.decisions.map(item => item.key)).size, 1242);
assert.strictEqual(manual.decisions.filter(item => item.decision === 'accept').length, 496);
assert.strictEqual(manual.decisions.filter(item => item.decision === 'reject').length, 746);

const queueCandidates = new Map();
for (const project of queue.projects) {
  for (const candidate of project.candidates || []) {
    const key = candidateKey(project.project, candidate);
    assert.ok(!queueCandidates.has(key), `Duplicate source candidate: ${key}`);
    queueCandidates.set(key, candidate);
  }
}
assert.strictEqual(queueCandidates.size, 1242);
for (const decision of manual.decisions) {
  assert.ok(queueCandidates.has(decision.key), `Decision absent from source queue: ${decision.key}`);
  assert.ok(['accept', 'reject'].includes(decision.decision));
  if (decision.decision === 'accept') {
    assert.ok(decision.api || decision.apis?.length, `Accepted decision has no API: ${decision.key}`);
    assert.ok(decision.evidenceKind, `Accepted decision has no evidence: ${decision.key}`);
  } else {
    assert.ok(decision.reason, `Rejected decision has no reason: ${decision.key}`);
  }
}

const configured = new Map();
for (const group of normalizeSensitiveApiCatalog(JSON.parse(ruleBytes))) {
  for (const api of group.privacyApis || []) {
    configured.set([group.systemPackage, api.namespace, api.method].join('|'), api);
  }
}

const manifestProjects = new Map(manifest.projects.map(project => [project.project, project]));
const projectCounts = new Map(gold.projects.map(project => [project.project, 0]));
const occurrenceKeys = new Set();
for (const annotation of gold.annotations) {
  assert.ok(projectCounts.has(annotation.project), `Unknown project: ${annotation.project}`);
  const project = manifestProjects.get(annotation.project);
  assert.ok(project, `Project missing from manifest: ${annotation.project}`);
  const relativeFile = normalizeRelative(annotation.file);
  assert.ok(
    project.sourceRoots.some(sourceRoot => {
      const rootPath = normalizeRelative(sourceRoot).replace(/\/$/, '');
      return rootPath === '.' || relativeFile === rootPath || relativeFile.startsWith(`${rootPath}/`);
    }),
    `Annotation is outside declared module roots: ${annotation.project}/${annotation.file}`,
  );

  const configuredApi = configured.get(apiKey(annotation.api));
  assert.ok(configuredApi, `Unconfigured gold API: ${apiKey(annotation.api)}`);
  assert.strictEqual(annotation.dataType, configuredApi.dataType);
  assert.strictEqual(annotation.label, configuredApi.label);
  assert.strictEqual(annotation.catalogApiSignature, configuredApi.catalogApiSignature);
  assert.strictEqual(annotation.category, configuredApi.profilingCategory);
  assert.ok(['call', 'property'].includes(annotation.accessKind));
  assert.ok(annotation.evidenceKind);

  const occurrenceKey = [
    annotation.project,
    relativeFile,
    annotation.line,
    annotation.column,
    apiKey(annotation.api),
  ].join('|');
  assert.ok(!occurrenceKeys.has(occurrenceKey), `Duplicate gold occurrence: ${occurrenceKey}`);
  occurrenceKeys.add(occurrenceKey);

  const sourceFile = path.join(dataset, annotation.project, annotation.file);
  assert.ok(fs.existsSync(sourceFile), `Missing source file: ${sourceFile}`);
  const sourceBytes = fs.readFileSync(sourceFile);
  assert.strictEqual(sha256(sourceBytes), annotation.sourceFileSha256, `Source hash drift: ${sourceFile}`);
  const sourceLine = sourceBytes.toString('utf8').split(/\r?\n/)[annotation.line - 1];
  assert.ok(sourceLine != null, `Source line is out of range: ${occurrenceKey}`);
  assert.strictEqual(sourceLine.trim(), annotation.sourceLine, `Source line drift: ${occurrenceKey}`);
  assert.ok(annotation.column > 0 && annotation.column <= sourceLine.length + 1);
  assert.ok(
    sourceLine.slice(annotation.column - 1).startsWith(annotation.api.member),
    `Member column drift: ${occurrenceKey}`,
  );
  assert.ok(annotation.sourceExpression.includes(annotation.api.member));
  projectCounts.set(annotation.project, projectCounts.get(annotation.project) + 1);
}

for (const project of gold.projects) {
  const manifestProject = manifestProjects.get(project.project);
  assert.strictEqual(project.sourceFiles, manifestProject.sourceFiles);
  assert.strictEqual(project.sourceTreeSha256, manifestProject.sourceTreeSha256);
  assert.strictEqual(project.goldOccurrences, projectCounts.get(project.project));
}

const dynamicSensorAnnotations = gold.annotations.filter(annotation =>
  annotation.evidenceKind === 'finite-sensor-id-set',
);
assert.strictEqual(dynamicSensorAnnotations.length, 85);
assert.strictEqual(new Set(dynamicSensorAnnotations.map(annotation => [
  annotation.project,
  annotation.file,
  annotation.line,
  annotation.column,
].join('|'))).size, 5);
assert.strictEqual(
  gold.annotations.filter(annotation => annotation.evidenceKind === 'numeric-sensor-id').length,
  1,
);

console.log(
  `ArkPrismTop120-PAC-v2 verified: ${gold.projectCount} projects, ` +
  `${gold.occurrenceCount} gold occurrences from ${gold.acceptedCandidateCount} accepted sites, ` +
  `${gold.rejectedCandidateCount} rejected candidates.`,
);
