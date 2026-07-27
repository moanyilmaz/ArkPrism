#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) {
      throw new Error(`Unexpected argument: ${token}`);
    }
    const value = argv[i + 1];
    if (!value || value.startsWith('--')) {
      throw new Error(`Missing value for ${token}`);
    }
    args[token.slice(2)] = value;
    i += 1;
  }
  for (const required of ['reports', 'oracle', 'output']) {
    if (!args[required]) {
      throw new Error(`Missing --${required}`);
    }
  }
  return args;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function sourceLine(filePath, line) {
  if (!filePath || line < 1 || !fs.existsSync(filePath)) {
    return '';
  }
  return fs.readFileSync(filePath, 'utf8').split(/\r?\n/)[line - 1] || '';
}

function normalizeFile(filePath, projectDirectory) {
  if (!filePath) {
    return '';
  }
  const absolute = path.resolve(projectDirectory, filePath);
  return path.relative(projectDirectory, absolute).replace(/\\/g, '/');
}

function pairKey(caseId, flow, projectDirectory) {
  const identity = flow.sourceIdentity || {};
  return [
    caseId,
    identity.module || '',
    identity.className || '',
    identity.apiName || '',
    normalizeFile(flow.sourceFile, projectDirectory),
    flow.sourceLine,
    normalizeFile(flow.sinkFile, projectDirectory),
    flow.sinkLine,
    flow.sinkApi || '',
  ].join('|');
}

const manualDecisions = new Map([
  ['General_Language_Features__Exceptions2|14|-1', {
    accepted: true,
    evidence: 'The exceptional CFG endpoint is the annotated finally-block hilog sink at source line 17; ArkIR has no source line for the handler successor.',
  }],
  ['General_Language_Features__VirtualDispatch1|29|23', {
    accepted: true,
    evidence: 'The endpoint is the annotated Leak.log sink reached through the source-bearing Leak allocation.',
  }],
  ['General_Language_Features__VirtualDispatch1|29|14', {
    accepted: false,
    evidence: 'The endpoint is NoLeak.log; that allocation receives an empty constant rather than the sensitive value.',
  }],
  ['Lifecycle_Modeling__ComponentLifecycle3|19|10', {
    accepted: true,
    evidence: 'The source writes EntryAbility.info and the component lifecycle sink reads that same static field.',
  }],
  ['OpenHarmony_Specific_APIs__CallbackInSource|8|9', {
    accepted: true,
    evidence: 'The configured callback carrier account is passed directly to hilog.info.',
  }],
  ['OpenHarmony_Specific_APIs__DirectLeak-want|-1|10', {
    accepted: true,
    evidence: 'The modeled onCreate Want parameter is serialized and passed to the configured hilog sink.',
  }],
  ['OpenHarmony_Specific_APIs__FileReadWrite|10|12', {
    accepted: true,
    evidence: 'The getLastLocation return is serialized into info and passed to fs.write.',
  }],
]);

function wilsonLower(successes, total, z = 1.96) {
  if (total === 0) {
    return null;
  }
  const p = successes / total;
  const denominator = 1 + (z * z) / total;
  const center = p + (z * z) / (2 * total);
  const margin = z * Math.sqrt((p * (1 - p) + (z * z) / (4 * total)) / total);
  return (center - margin) / denominator;
}

function main() {
  const args = parseArgs(process.argv);
  const reportsRoot = path.resolve(args.reports);
  const oracle = readJson(path.resolve(args.oracle));
  const expectedByCase = new Map(oracle.cases.map((item) => [item.id, item.expected]));
  const records = [];
  const acceptedCases = new Set();
  const seenPairs = new Set();

  for (const entry of fs.readdirSync(reportsRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      continue;
    }
    const caseId = entry.name;
    const reportPath = path.join(reportsRoot, caseId, `${caseId}-arkprism-report.json`);
    if (!fs.existsSync(reportPath)) {
      continue;
    }
    const report = readJson(reportPath);
    for (const flow of report.taintFlows || []) {
      const key = pairKey(caseId, flow, report.projectDirectory);
      if (seenPairs.has(key)) {
        continue;
      }
      seenPairs.add(key);
      const sourceText = sourceLine(
        path.resolve(report.projectDirectory, flow.sourceFile || ''),
        flow.sourceLine,
      );
      const sinkText = sourceLine(
        path.resolve(report.projectDirectory, flow.sinkFile || ''),
        flow.sinkLine,
      );
      const reviewKey = `${caseId}|${flow.sourceLine}|${flow.sinkLine}`;
      const manual = manualDecisions.get(reviewKey);
      const inlineAccepted = /\/\/\s*source\b/i.test(sourceText)
        && /\/\/\s*sink\b/i.test(sinkText);
      if (!manual && !inlineAccepted) {
        throw new Error(`Unreviewed endpoint pair: ${reviewKey}`);
      }
      const accepted = manual ? manual.accepted : true;
      if (accepted) {
        acceptedCases.add(caseId);
      }
      records.push({
        caseId,
        expectedCase: expectedByCase.get(caseId),
        accepted,
        reviewMode: manual ? 'manual_source_ir_review' : 'inline_oracle_markers',
        evidence: manual ? manual.evidence : 'Exact source and sink lines carry the HapBench inline oracle markers.',
        sourceIdentity: flow.sourceIdentity,
        sourceFile: normalizeFile(flow.sourceFile, report.projectDirectory),
        sourceLine: flow.sourceLine,
        sourceText,
        sinkFile: normalizeFile(flow.sinkFile, report.projectDirectory),
        sinkLine: flow.sinkLine,
        sinkText,
        sinkApi: flow.sinkApi,
        provenance: flow.provenance,
        pathLength: (flow.path || []).length,
      });
    }
  }

  const goldCases = oracle.cases.filter((item) => item.expected).map((item) => item.id);
  const tp = records.filter((item) => item.accepted).length;
  const fp = records.filter((item) => !item.accepted).length;
  const fnCases = goldCases.filter((caseId) => !acceptedCases.has(caseId));
  const precision = tp / (tp + fp);
  const recall = tp / goldCases.length;
  const f1 = (2 * precision * recall) / (precision + recall);
  const output = {
    schemaVersion: 1,
    benchmark: 'HapBench',
    unit: 'unique source-sink endpoint pair',
    reportsRoot,
    oraclePath: path.resolve(args.oracle),
    metrics: {
      goldPairs: goldCases.length,
      predictedPairs: records.length,
      tp,
      fp,
      fn: fnCases.length,
      precision,
      recall,
      f1,
      precisionWilson95Lower: wilsonLower(tp, tp + fp),
      recallWilson95Lower: wilsonLower(tp, goldCases.length),
    },
    falseNegativeCases: fnCases,
    records,
  };
  fs.mkdirSync(path.dirname(path.resolve(args.output)), { recursive: true });
  fs.writeFileSync(path.resolve(args.output), `${JSON.stringify(output, null, 2)}\n`);
  console.log(JSON.stringify(output.metrics, null, 2));
}

main();
