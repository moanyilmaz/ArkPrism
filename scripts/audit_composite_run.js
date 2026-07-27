const fs = require('fs');
const path = require('path');
const { quantiles } = require('./summarize_corpus_reports');

function parseArgs(argv) {
  const args = {
    base: '',
    baseBatch: '',
    taintOverlay: '',
    taintOverlayBatch: '',
    sdkPath: '',
    output: '',
  };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === '--base') args.base = argv[++index] || '';
    else if (arg === '--base-batch') args.baseBatch = argv[++index] || '';
    else if (arg === '--taint-overlay') args.taintOverlay = argv[++index] || '';
    else if (arg === '--taint-overlay-batch') args.taintOverlayBatch = argv[++index] || '';
    else if (arg === '--sdk-path') args.sdkPath = argv[++index] || '';
    else if (arg === '--output') args.output = argv[++index] || '';
    else throw new Error(`Unknown argument: ${arg}`);
  }
  for (const required of [
    'base',
    'baseBatch',
    'taintOverlay',
    'taintOverlayBatch',
    'sdkPath',
    'output',
  ]) {
    if (!args[required]) throw new Error(`--${required} is required`);
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
        reports.set(report.projectName || path.basename(path.dirname(fullPath)), report);
      }
    }
  }
  return reports;
}

function batchMap(filePath) {
  return new Map(readJson(filePath).map(item => [item.projectName, item]));
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const base = reportMap(args.base);
  const overlay = reportMap(args.taintOverlay);
  const baseBatch = batchMap(args.baseBatch);
  const overlayBatch = batchMap(args.taintOverlayBatch);
  const expectedSdk = path.resolve(args.sdkPath).replace(/\\/g, '\\');

  const edges = [];
  const malformed = [];
  const rejectedContainerEdges = [];
  const failures = [];
  let success = 0;
  let budgetExceeded = 0;
  let batchingEnabled = 0;
  let callbackEnabled = 0;
  let pointerCompleteLogs = 0;
  let pointerFailureLogs = 0;
  let sdkLoadLogs = 0;
  let flowsBeforeDeduplication = 0;
  let uniqueFlows = 0;
  let duplicatesRemoved = 0;
  let projectsWithFlowDuplicates = 0;
  let projectsWithMalformedEdges = 0;

  for (const [project, baseReport] of [...base.entries()].sort()) {
    const report = overlay.get(project) || baseReport;
    const batch = overlayBatch.get(project) || baseBatch.get(project);
    const taint = report.taintAnalysis || {};
    const ifds = taint.ifds || {};
    const pointer = taint.pointerAnalysis;
    const issues = [];

    if (taint.status === 'SUCCESS') success++;
    else issues.push(`taint status ${taint.status || '(missing)'}`);
    if (ifds.budgetExceeded) budgetExceeded++;
    if (ifds.batching || Number(ifds.batches || 1) !== 1) batchingEnabled++;
    if (taint.callback?.enabled) callbackEnabled++;
    edges.push(Number(ifds.edgesProcessed || 0));
    malformed.push(Number(ifds.malformedCfgEdges || 0));
    if (Number(ifds.malformedCfgEdges || 0) > 0) projectsWithMalformedEdges++;

    flowsBeforeDeduplication += Number(
      taint.flowsBeforeDeduplication
      ?? (report.taintFlows || []).length,
    );
    uniqueFlows += Number(taint.uniqueFlows ?? (report.taintFlows || []).length);
    duplicatesRemoved += Number(taint.duplicatesRemoved || 0);
    if (Number(taint.duplicatesRemoved || 0) > 0) projectsWithFlowDuplicates++;
    if (pointer) {
      rejectedContainerEdges.push(Number(pointer.rejectedContainerFieldEdges || 0));
      if (pointer.status !== 'SUCCESS') issues.push(`pointer status ${pointer.status}`);
    }

    if (!batch?.logPath || !fs.existsSync(batch.logPath)) {
      issues.push('missing retained log');
    } else {
      const log = fs.readFileSync(batch.logPath, 'utf8');
      if (log.includes('[HAPFLOW] Pointer analysis complete.')) pointerCompleteLogs++;
      else issues.push('missing pointer completion evidence');
      if (/Pointer analysis failed|continuing without/i.test(log)) {
        pointerFailureLogs++;
        issues.push('pointer failure/fallback evidence');
      }
      if (log.includes(`[HAPFLOW] Loading SDK files from: ${expectedSdk}`)) sdkLoadLogs++;
      else issues.push('SDK path mismatch');
    }
    if (issues.length > 0) failures.push({ project, issues });
  }

  const result = {
    generatedAt: new Date().toISOString(),
    composition: {
      baseDirectory: path.resolve(args.base),
      taintOverlayDirectory: path.resolve(args.taintOverlay),
      baseProjects: base.size,
      replacedProjects: overlay.size,
      sdkPath: path.resolve(args.sdkPath),
    },
    validation: {
      retainedProjects: base.size,
      success,
      failures,
      pointerCompleteLogs,
      pointerFailureLogs,
      sdkLoadLogs,
      budgetExceeded,
      batchingEnabled,
      callbackEnabled,
    },
    ifds: {
      edgesProcessed: quantiles(edges),
      malformedCfgEdges: quantiles(malformed),
      projectsWithMalformedEdges,
      flowDeduplication: {
        flowsBeforeDeduplication,
        uniqueFlows,
        duplicatesRemoved,
        projectsWithDuplicatesRemoved: projectsWithFlowDuplicates,
      },
    },
    pointerAnalysis: {
      metadataAvailableProjects: rejectedContainerEdges.length,
      rejectedContainerFieldEdges: quantiles(rejectedContainerEdges),
      totalRejectedContainerFieldEdges: rejectedContainerEdges.reduce(
        (sum, value) => sum + value,
        0,
      ),
    },
  };

  const outputPath = path.resolve(args.output);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify({
    validation: result.validation,
    ifds: result.ifds,
    pointerAnalysis: result.pointerAnalysis,
  }, null, 2));
}

main();
