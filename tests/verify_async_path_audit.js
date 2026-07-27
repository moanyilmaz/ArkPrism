const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const dataset = process.env.ARGUS_DATASET;
if (!dataset || !fs.existsSync(dataset)) {
  throw new Error('ARGUS_DATASET must point to the real-project source corpus.');
}

const auditPath = path.join(
  root,
  'docs',
  'experiment_async_regression_20260727_v22_final',
  'manual_async_path_audit.json',
);
const audit = JSON.parse(fs.readFileSync(auditPath, 'utf8'));
const runDirectory = path.resolve(root, audit.runDirectory);

function sha256(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function reportPaths(directory) {
  const files = [];
  const pending = [directory];
  while (pending.length > 0) {
    const current = pending.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const target = path.join(current, entry.name);
      if (entry.isDirectory()) pending.push(target);
      else if (entry.name.endsWith('-arkprism-report.json')) files.push(target);
    }
  }
  return files;
}

const asyncPaths = [];
for (const reportPath of reportPaths(runDirectory)) {
  const report = JSON.parse(fs.readFileSync(reportPath, 'utf8').replace(/^\uFEFF/, ''));
  for (const flow of report.taintFlows || []) {
    if (flow.provenance !== 'async_supplement') continue;
    if (flow.sourceKind !== 'privacy_data') {
      throw new Error(`${report.projectName}: async path has source kind ${flow.sourceKind}`);
    }
    asyncPaths.push({ project: report.projectName, flow });
  }
}

if (audit.reviewedPaths !== audit.records.length
  || audit.confirmedPaths !== audit.records.length
  || audit.rejectedPaths !== 0) {
  throw new Error('Audit counters do not match the retained decisions.');
}
if (asyncPaths.length !== audit.records.length) {
  throw new Error(`Async path count mismatch: reports=${asyncPaths.length}, audit=${audit.records.length}`);
}

const matched = new Set();
for (const record of audit.records) {
  if (record.decision !== 'confirmed') {
    throw new Error(`${record.project}:${record.sourceLine} is not confirmed.`);
  }
  const sourceFile = path.join(dataset, record.project, record.file);
  if (!fs.existsSync(sourceFile)) {
    throw new Error(`Missing source file: ${sourceFile}`);
  }
  if (sha256(sourceFile) !== record.fileSha256) {
    throw new Error(`Source hash mismatch: ${record.project}/${record.file}`);
  }
  const lines = fs.readFileSync(sourceFile, 'utf8').split(/\r?\n/);
  const sourceLine = lines[record.sourceLine - 1] || '';
  const sinkLine = lines[record.sinkLine - 1] || '';
  const sourceMember = record.sourceApi.split('.').pop();
  const sinkMember = record.sinkApi.split('.').pop();
  if (!sourceLine.includes(sourceMember) || !sinkLine.includes(sinkMember)) {
    throw new Error(`Source/sink text mismatch: ${record.project}:${record.sourceLine}->${record.sinkLine}`);
  }

  const matchIndex = asyncPaths.findIndex(({ project, flow }, index) => (
    !matched.has(index)
    && project === record.project
    && Number(flow.sourceLine) === record.sourceLine
    && Number(flow.sinkLine) === record.sinkLine
    && String(flow.sourceApi || '').includes(sourceMember)
    && String(flow.sinkApi || '').includes(sinkMember)
  ));
  if (matchIndex < 0) {
    throw new Error(`No report path for audit record: ${record.project}:${record.sourceLine}`);
  }
  const identity = asyncPaths[matchIndex].flow.sourceIdentity;
  if (!identity
    || identity.apiName !== sourceMember
    || !identity.module
    || !identity.methodSignature
    || !identity.ruleOrigin) {
    throw new Error(`Incomplete source identity: ${record.project}:${record.sourceLine}`);
  }
  matched.add(matchIndex);
}

console.log(`Async semantic audit verified: ${audit.records.length}/${asyncPaths.length} paths.`);
