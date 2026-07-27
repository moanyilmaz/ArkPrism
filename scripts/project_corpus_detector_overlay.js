const fs = require('fs');
const path = require('path');

function parseArgs(argv) {
  const args = { base: '', overlay: '', taintOverlay: '', output: '' };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === '--base') args.base = argv[++index] || '';
    else if (arg === '--overlay') args.overlay = argv[++index] || '';
    else if (arg === '--taint-overlay') args.taintOverlay = argv[++index] || '';
    else if (arg === '--output') args.output = argv[++index] || '';
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!args.base || !args.overlay || !args.output) {
    throw new Error('--base, --overlay, and --output are required');
  }
  return args;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, ''));
}

function reportMap(root) {
  const reports = new Map();
  const stack = [path.resolve(root)];
  while (stack.length > 0) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory() && entry.name !== 'logs') stack.push(fullPath);
      else if (entry.isFile() && entry.name.endsWith('-arkprism-report.json')) {
        const report = readJson(fullPath);
        const project = report.projectName || path.basename(path.dirname(fullPath));
        if (reports.has(project)) throw new Error(`Duplicate report for ${project}`);
        reports.set(project, { path: fullPath, report });
      }
    }
  }
  return reports;
}

function normalized(value) {
  return String(value || '').replace(/\\/g, '/').trim().toLowerCase();
}

function occurrenceKey(usage) {
  return JSON.stringify([
    normalized(usage.apiPackage),
    normalized(usage.namespace),
    normalized(usage.method),
    normalized(usage.file),
    normalized(usage.declaringMethod),
    String(usage.code || '').trim(),
  ]);
}

function evidenceStrength(usage) {
  switch (usage.matchEvidence) {
    case 'receiver_origin': return 2;
    case 'target_signature': return 3;
    case 'receiver_type': return 4;
    case 'namespace': return 1;
    default: return 5;
  }
}

function canonicalUsageIndexes(report) {
  const selected = new Map();
  (report.privacyApiUsages || []).forEach((usage, index) => {
    const key = occurrenceKey(usage);
    const current = selected.get(key);
    if (!current || evidenceStrength(usage) > evidenceStrength(current.usage)) {
      selected.set(key, { index, usage });
    }
  });
  return selected;
}

function summarizeReport(report) {
  const selected = canonicalUsageIndexes(report);
  const selectedIndexes = new Set([...selected.values()].map(item => item.index));
  const chains = (report.callChains || []).filter(chain =>
    selectedIndexes.has(Number(chain.apiUsageIndex)),
  );
  const sinks = chains.reduce(
    (total, chain) => total + (chain.dataSinks || []).length,
    0,
  );
  return {
    rawApis: (report.privacyApiUsages || []).length,
    apis: selected.size,
    duplicateApisRemoved: (report.privacyApiUsages || []).length - selected.size,
    rawChains: (report.callChains || []).length,
    chains: chains.length,
    sinks,
    apiPositive: selected.size > 0,
    chainPositive: chains.length > 0,
    sinkPositive: sinks > 0,
    usageKeys: new Set(selected.keys()),
  };
}

function emptyAggregate() {
  return {
    projects: 0,
    rawApis: 0,
    apis: 0,
    duplicateApisRemoved: 0,
    rawChains: 0,
    chains: 0,
    sinks: 0,
    apiPositive: 0,
    chainPositive: 0,
    sinkPositive: 0,
  };
}

function addSummary(aggregate, summary) {
  aggregate.projects++;
  for (const field of [
    'rawApis',
    'apis',
    'duplicateApisRemoved',
    'rawChains',
    'chains',
    'sinks',
  ]) {
    aggregate[field] += summary[field];
  }
  aggregate.apiPositive += Number(summary.apiPositive);
  aggregate.chainPositive += Number(summary.chainPositive);
  aggregate.sinkPositive += Number(summary.sinkPositive);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const base = reportMap(args.base);
  const overlay = reportMap(args.overlay);
  const taintOverlay = args.taintOverlay ? reportMap(args.taintOverlay) : new Map();
  const missing = [...new Set([...overlay.keys(), ...taintOverlay.keys()])]
    .filter(project => !base.has(project));
  if (missing.length > 0) {
    throw new Error(`Overlay projects absent from base: ${missing.join(', ')}`);
  }

  const baseAggregate = emptyAggregate();
  const projectedAggregate = emptyAggregate();
  const projectChanges = [];
  let taintFlows = 0;
  let taintPositive = 0;

  for (const [project, baseItem] of [...base.entries()].sort()) {
    const baseSummary = summarizeReport(baseItem.report);
    const projectedSummary = overlay.has(project)
      ? summarizeReport(overlay.get(project).report)
      : baseSummary;
    addSummary(baseAggregate, baseSummary);
    addSummary(projectedAggregate, projectedSummary);

    const taintReport = taintOverlay.get(project)?.report || baseItem.report;
    const projectTaintFlows = Array.isArray(taintReport.taintFlows)
      ? taintReport.taintFlows.length
      : Number(taintReport.statistics?.totalTaintFlows || 0);
    taintFlows += projectTaintFlows;
    taintPositive += Number(projectTaintFlows > 0);

    if (overlay.has(project)) {
      const added = [...projectedSummary.usageKeys]
        .filter(key => !baseSummary.usageKeys.has(key)).length;
      const removed = [...baseSummary.usageKeys]
        .filter(key => !projectedSummary.usageKeys.has(key)).length;
      projectChanges.push({
        project,
        base: {
          apis: baseSummary.apis,
          chains: baseSummary.chains,
          sinks: baseSummary.sinks,
        },
        projected: {
          apis: projectedSummary.apis,
          chains: projectedSummary.chains,
          sinks: projectedSummary.sinks,
        },
        added,
        removed,
      });
    }
  }

  const result = {
    generatedAt: new Date().toISOString(),
    definition: {
      apiOccurrence:
        'Case-insensitive package, namespace, method, file, and declaring method plus exact IR statement.',
      base:
        'Complete full-analysis reports; duplicate detector records are canonicalized before aggregation.',
      overlay:
        'Detector, call-chain, and sink results from the targeted regression replace matching base projects.',
      taint:
        'IFDS results are retained from the complete base run because the detector-only overlay does not execute taint analysis.',
    },
    baseDirectory: path.resolve(args.base),
    overlayDirectory: path.resolve(args.overlay),
    taintOverlayDirectory: args.taintOverlay
      ? path.resolve(args.taintOverlay)
      : null,
    overlayProjects: overlay.size,
    taintOverlayProjects: taintOverlay.size,
    base: baseAggregate,
    projected: {
      ...projectedAggregate,
      taintFlows,
      taintPositive,
    },
    delta: {
      apis: projectedAggregate.apis - baseAggregate.apis,
      chains: projectedAggregate.chains - baseAggregate.chains,
      sinks: projectedAggregate.sinks - baseAggregate.sinks,
      apiPositive: projectedAggregate.apiPositive - baseAggregate.apiPositive,
      chainPositive: projectedAggregate.chainPositive - baseAggregate.chainPositive,
      sinkPositive: projectedAggregate.sinkPositive - baseAggregate.sinkPositive,
    },
    overlayValidation: {
      added: projectChanges.reduce((sum, item) => sum + item.added, 0),
      removed: projectChanges.reduce((sum, item) => sum + item.removed, 0),
      projectsChanged: projectChanges.filter(item =>
        item.added > 0
        || item.removed > 0
        || item.base.sinks !== item.projected.sinks,
      ).length,
    },
    projectChanges,
  };

  const outputPath = path.resolve(args.output);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify({
    base: result.base,
    projected: result.projected,
    delta: result.delta,
    overlayValidation: result.overlayValidation,
  }, null, 2));
}

main();
