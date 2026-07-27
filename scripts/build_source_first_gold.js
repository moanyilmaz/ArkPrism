const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    if (!key.startsWith('--') || !argv[index + 1]) throw new Error(`Invalid argument: ${key}`);
    args[key.slice(2)] = path.resolve(argv[index + 1]);
  }
  for (const required of ['dataset', 'manifest', 'queue', 'decisions', 'rules', 'aliases', 'output']) {
    if (!args[required]) throw new Error(`--${required} is required`);
  }
  return args;
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function member(method) {
  return String(method).replace(/\(\)\s*$/, '').replace(/\s*\(.*/, '').split('.').filter(Boolean).pop();
}

function key(project, candidate) {
  return [project, candidate.file, candidate.line, candidate.column, candidate.member].join('|');
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const manifestBytes = fs.readFileSync(args.manifest);
  const ruleBytes = fs.readFileSync(args.rules);
  const aliasBytes = fs.readFileSync(args.aliases);
  const decisionBytes = fs.readFileSync(args.decisions);
  const queueBytes = fs.readFileSync(args.queue);
  const manifest = JSON.parse(manifestBytes);
  const queue = JSON.parse(queueBytes);
  const manual = JSON.parse(decisionBytes);
  if (manual.reviewQueueSha256 !== sha256(queueBytes)) {
    throw new Error('Manual decisions do not match the current review queue');
  }
  const decisionByKey = new Map();
  for (const decision of manual.decisions || []) {
    if (!decision.key || decisionByKey.has(decision.key)) {
      throw new Error(`Duplicate or missing manual decision key: ${decision.key}`);
    }
    if (!['accept', 'reject'].includes(decision.decision)) {
      throw new Error(`Invalid manual decision for ${decision.key}`);
    }
    if (decision.decision === 'accept' && (!decision.api || !decision.evidenceKind)) {
      throw new Error(`Accepted decision lacks API/evidence: ${decision.key}`);
    }
    if (decision.decision === 'reject' && !decision.reason) {
      throw new Error(`Rejected decision lacks reason: ${decision.key}`);
    }
    decisionByKey.set(decision.key, decision);
  }

  const annotations = [];
  const decisions = [];
  const usedDecisions = new Set();
  for (const project of queue.projects) {
    for (const candidate of project.candidates) {
      const candidateKey = key(project.project, candidate);
      const decision = decisionByKey.get(candidateKey);
      if (!decision) throw new Error(`Unreviewed candidate: ${candidateKey}`);
      usedDecisions.add(candidateKey);
      if (decision.decision === 'reject') {
        decisions.push({ key: candidateKey, decision: 'reject', reason: decision.reason });
        continue;
      }

      const selected = decision.api;
      const selectedRule = candidate.candidateApis.find(rule =>
        rule.package === selected.package &&
        rule.namespace === selected.namespace &&
        rule.configuredMethod === selected.method,
      );
      if (!selectedRule) throw new Error(`Selected API is not a candidate: ${candidateKey}`);
      const filePath = path.join(args.dataset, project.project, candidate.file);
      const sourceBytes = fs.readFileSync(filePath);
      const sourceText = sourceBytes.toString('utf8');
      const sourceLine = sourceText.split(/\r?\n/)[candidate.line - 1] || '';
      const evidenceKind = decision.evidenceKind;
      const annotationId = sha256(candidateKey).slice(0, 16);
      annotations.push({
        annotationId,
        project: project.project,
        file: candidate.file,
        line: candidate.line,
        column: candidate.column,
        api: {
          package: selected.package,
          namespace: selected.namespace,
          member: member(selected.method),
          configuredMethod: selected.method,
        },
        accessKind: candidate.accessKind,
        evidenceKind,
        receiver: candidate.receiver,
        sourceExpression: candidate.expression,
        sourceLine: sourceLine.trim(),
        sourceImports: candidate.imports,
        category: selectedRule.category,
        permission: selectedRule.permission,
        sourceFileSha256: sha256(sourceBytes),
      });
      decisions.push({ key: candidateKey, decision: 'accept', annotationId });
    }
  }
  const unusedDecisions = [...decisionByKey.keys()].filter(item => !usedDecisions.has(item));
  if (unusedDecisions.length > 0) {
    throw new Error(`Manual decisions absent from queue: ${unusedDecisions.join(', ')}`);
  }
  if (usedDecisions.size !== queue.candidateCount) {
    throw new Error(`Manual decision coverage mismatch: ${usedDecisions.size}/${queue.candidateCount}`);
  }

  annotations.sort((left, right) =>
    left.project.localeCompare(right.project) ||
    left.file.localeCompare(right.file) ||
    left.line - right.line ||
    left.column - right.column,
  );
  const counts = new Map(manifest.projects.map(project => [project.project, 0]));
  for (const annotation of annotations) counts.set(annotation.project, counts.get(annotation.project) + 1);
  const projects = manifest.projects.map(project => ({
    project: project.project,
    importStratum: project.importStratum,
    sizeStratum: project.sizeStratum,
    sourceFiles: project.sourceFiles,
    sourceTreeSha256: project.sourceTreeSha256,
    goldOccurrences: counts.get(project.project),
  }));
  const gold = {
    schemaVersion: 1,
    benchmark: 'ArkSourceFirst60',
    projectCount: projects.length,
    occurrenceCount: annotations.length,
    acceptedCandidateCount: decisions.filter(item => item.decision === 'accept').length,
    rejectedCandidateCount: decisions.filter(item => item.decision === 'reject').length,
    selectionManifestSha256: sha256(manifestBytes),
    reviewQueueSha256: sha256(queueBytes),
    ruleSetSha256: sha256(ruleBytes),
    packageAliasSha256: sha256(aliasBytes),
    manualDecisionSha256: sha256(decisionBytes),
    projects,
    annotations,
  };
  fs.mkdirSync(path.dirname(args.output), { recursive: true });
  fs.writeFileSync(args.output, `${JSON.stringify(gold, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({
    output: args.output,
    projects: gold.projectCount,
    accepted: gold.acceptedCandidateCount,
    rejected: gold.rejectedCandidateCount,
  }));
}

main();
