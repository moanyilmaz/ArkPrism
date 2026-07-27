const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

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

const gold = JSON.parse(read('benchmarks/ArkSourceFirst60/gold.json'));
const manifestBytes = read('benchmarks/ArkSourceFirst60/selection_manifest.json');
const queueBytes = read('benchmarks/ArkSourceFirst60/review_queue.json');
const decisionBytes = read('benchmarks/ArkSourceFirst60/manual_review_decisions.json');
const queue = JSON.parse(queueBytes);
const manual = JSON.parse(decisionBytes);
const ruleBytes = read('config/sensitive_apis.json');
const aliasBytes = read('config/package_aliases.json');
const rules = JSON.parse(ruleBytes);

assert.strictEqual(gold.projectCount, 60);
assert.strictEqual(gold.projects.length, 60);
assert.strictEqual(gold.annotations.length, gold.occurrenceCount);
assert.strictEqual(gold.acceptedCandidateCount + gold.rejectedCandidateCount, 186);
assert.strictEqual(gold.selectionManifestSha256, sha256(manifestBytes));
assert.strictEqual(gold.reviewQueueSha256, sha256(queueBytes));
assert.strictEqual(gold.manualDecisionSha256, sha256(decisionBytes));
assert.strictEqual(queue.candidateCount, 186);
assert.strictEqual(manual.role, 'exhaustive-manual-source-decisions');
assert.strictEqual(manual.reviewQueueSha256, sha256(queueBytes));
assert.strictEqual(manual.candidateCount, queue.candidateCount);
assert.strictEqual(manual.decisions.length, queue.candidateCount);
assert.strictEqual(new Set(manual.decisions.map(item => item.key)).size, queue.candidateCount);
assert.strictEqual(manual.decisions.filter(item => item.decision === 'accept').length, 90);
assert.strictEqual(manual.decisions.filter(item => item.decision === 'reject').length, 96);
assert.strictEqual(gold.ruleSetSha256, sha256(ruleBytes));
assert.strictEqual(gold.packageAliasSha256, sha256(aliasBytes));

const configured = new Set();
for (const group of rules) {
  for (const api of group.privacyApis || []) {
    configured.add([group.systemPackage, api.namespace, api.method].join('|'));
  }
}

const occurrenceKeys = new Set();
const projectCounts = new Map(gold.projects.map(project => [project.project, 0]));
for (const annotation of gold.annotations) {
  assert.ok(projectCounts.has(annotation.project), `Unknown project: ${annotation.project}`);
  const apiKey = [
    annotation.api.package,
    annotation.api.namespace,
    annotation.api.configuredMethod,
  ].join('|');
  assert.ok(configured.has(apiKey), `Unconfigured API: ${apiKey}`);
  assert.ok(['call', 'property'].includes(annotation.accessKind));
  assert.ok(annotation.evidenceKind);

  const occurrenceKey = [
    annotation.project,
    annotation.file,
    annotation.line,
    annotation.column,
    apiKey,
  ].join('|');
  assert.ok(!occurrenceKeys.has(occurrenceKey), `Duplicate occurrence: ${occurrenceKey}`);
  occurrenceKeys.add(occurrenceKey);

  const file = path.join(dataset, annotation.project, annotation.file);
  assert.ok(fs.existsSync(file), `Missing source file: ${file}`);
  const bytes = fs.readFileSync(file);
  assert.strictEqual(sha256(bytes), annotation.sourceFileSha256, `Source hash drift: ${file}`);
  const rawLine = bytes.toString('utf8').split(/\r?\n/)[annotation.line - 1];
  const line = rawLine.trim();
  assert.strictEqual(line, annotation.sourceLine, `Source line drift: ${occurrenceKey}`);
  assert.ok(annotation.column > 0 && annotation.column <= rawLine.length + 1);
  const sourcePrefix = annotation.sourceExpression.split(/\r?\n/)[0].trim();
  assert.ok(
    rawLine.slice(annotation.column - 1).trimStart().startsWith(sourcePrefix),
    `Source column drift: ${occurrenceKey}`,
  );
  assert.ok(
    annotation.sourceExpression.includes(annotation.api.member),
    `Member absent from expression: ${occurrenceKey}`,
  );
  projectCounts.set(annotation.project, projectCounts.get(annotation.project) + 1);
}

for (const project of gold.projects) {
  assert.strictEqual(project.goldOccurrences, projectCounts.get(project.project));
}

assert.strictEqual(
  [...projectCounts.values()].reduce((sum, count) => sum + count, 0),
  gold.occurrenceCount,
);

console.log(
  `ArkSourceFirst60 verified: ${gold.projectCount} projects, ` +
  `${gold.occurrenceCount} accepted and ${gold.rejectedCandidateCount} rejected candidates.`,
);
