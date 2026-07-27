const fs = require('fs');
const path = require('path');

function parseArgs(argv) {
  const args = { full: '', baseline: '', output: '' };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === '--full') args.full = argv[++index] || '';
    else if (arg === '--baseline') args.baseline = argv[++index] || '';
    else if (arg === '--output') args.output = argv[++index] || '';
    else if (arg === '--help' || arg === '-h') {
      console.log([
        'Usage:',
        '  node scripts/compare_taint_reports.js --full <report-dir>',
        '    --baseline <report-dir> --output <result.json>',
        '',
        'Compares project-level predictions, source/sink endpoint pairs, and exact paths.',
      ].join('\n'));
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  if (!args.full || !args.baseline || !args.output) {
    throw new Error('--full, --baseline, and --output are required');
  }
  return args;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, ''));
}

function findReports(root) {
  const reports = new Map();
  const stack = [path.resolve(root)];
  while (stack.length > 0) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory() && entry.name !== 'logs') {
        stack.push(fullPath);
      } else if (entry.isFile() && entry.name.endsWith('-arkprism-report.json')) {
        const report = readJson(fullPath);
        const project = report.projectName || path.basename(path.dirname(fullPath));
        if (reports.has(project)) {
          throw new Error(`Duplicate report for project ${project} under ${root}`);
        }
        reports.set(project, { path: fullPath, report });
      }
    }
  }
  return reports;
}

function manifestSummary(root) {
  const manifestPath = path.join(path.resolve(root), 'run_manifest.json');
  if (!fs.existsSync(manifestPath)) return null;
  const manifest = readJson(manifestPath);
  return {
    path: manifestPath,
    status: manifest.status,
    sdkSha256: manifest.inputs?.sdk?.sha256 || null,
    buildSha256: manifest.inputs?.build?.sha256 || null,
    entrySha256: manifest.inputs?.build?.entrySha256
      || manifest.inputs?.build?.sha256
      || null,
    configHashes: manifest.inputs?.configHashes || {},
    featureFlags: manifest.environment?.analysisFeatureFlags || {},
    arkArgs: manifest.execution?.arkArgs || [],
  };
}

function differingKeys(left, right) {
  const keys = [...new Set([
    ...Object.keys(left || {}),
    ...Object.keys(right || {}),
  ])].sort();
  return keys.filter(key => left?.[key] !== right?.[key]);
}

function normalized(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function endpointKey(flow) {
  return [
    normalized(flow.sourceApi),
    normalized(flow.sourceFile),
    Number(flow.sourceLine || 0),
    normalized(flow.sinkApi),
    normalized(flow.sinkFile),
    Number(flow.sinkLine || 0),
  ].join('|');
}

function exactPathKey(flow) {
  return [
    endpointKey(flow),
    normalized(flow.taintedValue),
    ...(flow.path || []).map(step => [
      normalized(step.statement),
      normalized(step.file),
      Number(step.line || 0),
      normalized(step.method),
    ].join('@')),
  ].join('|');
}

function uniqueBy(flows, keyFunction) {
  return new Map(flows.map(flow => [keyFunction(flow), flow]));
}

function setDifference(left, right) {
  return [...left.keys()].filter(key => !right.has(key));
}

function compareProject(project, fullRecord, baselineRecord) {
  const fullFlows = fullRecord?.report?.taintFlows || [];
  const baselineFlows = baselineRecord?.report?.taintFlows || [];
  const fullEndpoints = uniqueBy(fullFlows, endpointKey);
  const baselineEndpoints = uniqueBy(baselineFlows, endpointKey);
  const fullPaths = uniqueBy(fullFlows, exactPathKey);
  const baselinePaths = uniqueBy(baselineFlows, exactPathKey);
  return {
    project,
    fullFlows: fullFlows.length,
    baselineFlows: baselineFlows.length,
    fullUniqueEndpoints: fullEndpoints.size,
    baselineUniqueEndpoints: baselineEndpoints.size,
    fullUniqueExactPaths: fullPaths.size,
    baselineUniqueExactPaths: baselinePaths.size,
    fullDuplicateExactPaths: fullFlows.length - fullPaths.size,
    baselineDuplicateExactPaths: baselineFlows.length - baselinePaths.size,
    fullPositive: fullFlows.length > 0,
    baselinePositive: baselineFlows.length > 0,
    addedEndpoints: setDifference(fullEndpoints, baselineEndpoints),
    removedEndpoints: setDifference(baselineEndpoints, fullEndpoints),
    addedExactPaths: setDifference(fullPaths, baselinePaths),
    removedExactPaths: setDifference(baselinePaths, fullPaths),
  };
}

function compareDirectories(fullRoot, baselineRoot) {
  const full = findReports(fullRoot);
  const baseline = findReports(baselineRoot);
  const fullManifest = manifestSummary(fullRoot);
  const baselineManifest = manifestSummary(baselineRoot);
  const projects = [...new Set([...full.keys(), ...baseline.keys()])].sort();
  const projectResults = projects.map(project =>
    compareProject(project, full.get(project), baseline.get(project)));
  const sum = key => projectResults.reduce((total, item) => total + item[key], 0);
  const withLength = key => projectResults.filter(item => item[key].length > 0);
  return {
    definition: {
      full: 'Configuration under test.',
      baseline: 'Reference configuration.',
      projectPrediction: 'A project is positive when at least one taint flow is reported.',
      endpoint: 'Normalized source API/location plus sink API/location.',
      exactPath: 'Endpoint plus tainted value and every normalized path step.',
    },
    scope: {
      projects: projects.length,
      fullReports: full.size,
      baselineReports: baseline.size,
      commonReports: projects.filter(project => full.has(project) && baseline.has(project)).length,
      missingFromFull: projects.filter(project => !full.has(project)),
      missingFromBaseline: projects.filter(project => !baseline.has(project)),
    },
    provenance: {
      full: fullManifest,
      baseline: baselineManifest,
      comparableBuild: Boolean(
        fullManifest?.buildSha256
        && fullManifest.buildSha256 === baselineManifest?.buildSha256,
      ),
      comparableSdk: Boolean(
        fullManifest?.sdkSha256
        && fullManifest.sdkSha256 === baselineManifest?.sdkSha256,
      ),
      differingConfigHashes: differingKeys(
        fullManifest?.configHashes,
        baselineManifest?.configHashes,
      ),
    },
    totals: {
      fullFlows: sum('fullFlows'),
      baselineFlows: sum('baselineFlows'),
      fullUniqueEndpoints: sum('fullUniqueEndpoints'),
      baselineUniqueEndpoints: sum('baselineUniqueEndpoints'),
      fullUniqueExactPaths: sum('fullUniqueExactPaths'),
      baselineUniqueExactPaths: sum('baselineUniqueExactPaths'),
      fullDuplicateExactPaths: sum('fullDuplicateExactPaths'),
      baselineDuplicateExactPaths: sum('baselineDuplicateExactPaths'),
      fullPositiveProjects: projectResults.filter(item => item.fullPositive).length,
      baselinePositiveProjects: projectResults.filter(item => item.baselinePositive).length,
      fullOnlyPositiveProjects: projectResults
        .filter(item => item.fullPositive && !item.baselinePositive)
        .map(item => item.project),
      baselineOnlyPositiveProjects: projectResults
        .filter(item => !item.fullPositive && item.baselinePositive)
        .map(item => item.project),
      projectsWithAddedEndpoints: withLength('addedEndpoints').length,
      projectsWithRemovedEndpoints: withLength('removedEndpoints').length,
      addedEndpoints: projectResults.reduce(
        (total, item) => total + item.addedEndpoints.length,
        0,
      ),
      removedEndpoints: projectResults.reduce(
        (total, item) => total + item.removedEndpoints.length,
        0,
      ),
      projectsWithAddedExactPaths: withLength('addedExactPaths').length,
      projectsWithRemovedExactPaths: withLength('removedExactPaths').length,
      addedExactPaths: projectResults.reduce(
        (total, item) => total + item.addedExactPaths.length,
        0,
      ),
      removedExactPaths: projectResults.reduce(
        (total, item) => total + item.removedExactPaths.length,
        0,
      ),
    },
    changedProjects: projectResults.filter(item =>
      item.fullPositive !== item.baselinePositive
      || item.fullDuplicateExactPaths !== item.baselineDuplicateExactPaths
      || item.addedEndpoints.length > 0
      || item.removedEndpoints.length > 0
      || item.addedExactPaths.length > 0
      || item.removedExactPaths.length > 0),
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const result = {
    generatedAt: new Date().toISOString(),
    fullDirectory: path.resolve(args.full),
    baselineDirectory: path.resolve(args.baseline),
    ...compareDirectories(args.full, args.baseline),
  };
  const output = path.resolve(args.output);
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify({
    scope: result.scope,
    totals: result.totals,
  }, null, 2));
}

if (require.main === module) main();

module.exports = {
  compareDirectories,
  compareProject,
  endpointKey,
  exactPathKey,
  setDifference,
  uniqueBy,
};
