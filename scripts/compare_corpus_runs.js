const fs = require('fs');
const path = require('path');

function parseArgs(argv) {
  const args = {
    baseline: '',
    candidate: '',
    outputDir: '',
  };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === '--baseline') args.baseline = argv[++index] || '';
    else if (arg === '--candidate') args.candidate = argv[++index] || '';
    else if (arg === '--output-dir') args.outputDir = argv[++index] || '';
    else if (arg === '--help' || arg === '-h') {
      console.log([
        'Usage:',
        '  node scripts/compare_corpus_runs.js --baseline <reports-dir>',
        '    --candidate <reports-dir> --output-dir <dir>',
        '',
        'Compares complete corpus runs at endpoint and exact-path levels.',
      ].join('\n'));
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  if (!args.baseline || !args.candidate || !args.outputDir) {
    throw new Error('--baseline, --candidate, and --output-dir are required');
  }
  return args;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, ''));
}

function reportPaths(root) {
  const result = [];
  const stack = [path.resolve(root)];
  while (stack.length > 0) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory() && entry.name !== 'logs') stack.push(fullPath);
      else if (entry.isFile() && entry.name.endsWith('-arkprism-report.json')) {
        result.push(fullPath);
      }
    }
  }
  return result.sort();
}

function normalizeText(value) {
  return String(value || '').replace(/\\/g, '/').trim().toLowerCase();
}

function normalizeProjectPath(projectName, filePath) {
  const normalized = normalizeText(filePath);
  const project = normalizeText(projectName);
  if (!project) return normalized;
  const segments = normalized.split('/');
  const projectIndex = segments.lastIndexOf(project);
  if (projectIndex >= 0) return segments.slice(projectIndex + 1).join('/');
  return normalized.replace(/^[a-z]:\//, '');
}

function sourceIdentityKey(identity) {
  return [
    identity?.module,
    identity?.namespace,
    identity?.className,
    identity?.apiName,
    identity?.sourceType,
    identity?.sourceIndex,
    identity?.callbackIndex,
    identity?.methodSignature,
  ].map(normalizeText);
}

function flowEndpointKey(projectName, flow) {
  return JSON.stringify([
    normalizeText(projectName),
    normalizeText(flow.sourceKind),
    sourceIdentityKey(flow.sourceIdentity),
    normalizeText(flow.sourceApi),
    normalizeProjectPath(projectName, flow.sourceFile),
    Number(flow.sourceLine),
    normalizeText(flow.sinkApi),
    normalizeProjectPath(projectName, flow.sinkFile),
    Number(flow.sinkLine),
  ]);
}

function flowPathKey(projectName, flow) {
  return JSON.stringify([
    flowEndpointKey(projectName, flow),
    (flow.path || []).map(step => [
      normalizeText(step.statement),
      normalizeProjectPath(projectName, step.file),
      Number(step.line),
      normalizeText(step.method),
    ]),
  ]);
}

function sortedUnique(values) {
  return [...new Set(values.map(value => String(value || '').trim()).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right));
}

function increment(object, key, amount = 1) {
  const normalized = key || '(unknown)';
  object[normalized] = (object[normalized] || 0) + amount;
}

function sortedObject(object) {
  return Object.fromEntries(
    Object.entries(object)
      .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0])),
  );
}

function loadRun(root) {
  const resolvedRoot = path.resolve(root);
  const manifest = readJson(path.join(resolvedRoot, 'run_manifest.json'));
  const paths = reportPaths(resolvedRoot);
  const expectedProjects = Number(manifest.inputs?.projectCount);
  if (manifest.status !== 'complete') {
    throw new Error(`${resolvedRoot}: manifest status is ${manifest.status}`);
  }
  if (paths.length !== expectedProjects) {
    throw new Error(`${resolvedRoot}: reports=${paths.length}/${expectedProjects}`);
  }

  const batchPath = path.join(resolvedRoot, 'batch_summary.json');
  const batch = fs.existsSync(batchPath) ? readJson(batchPath) : [];
  const endpointRecords = new Map();
  const exactPathKeys = new Set();
  const provenance = {};
  const derivations = {};
  const carrierStates = {};
  let flows = 0;
  let ifdsEdges = 0;

  for (const reportPath of paths) {
    const report = readJson(reportPath);
    const projectName = report.projectName || path.basename(path.dirname(reportPath));
    ifdsEdges += Number(report.taintAnalysis?.ifds?.edgesProcessed || 0);
    for (const flow of report.taintFlows || []) {
      flows++;
      const endpointKey = flowEndpointKey(projectName, flow);
      const endpoint = endpointRecords.get(endpointKey) || {
        projectName,
        provenance: new Set(),
        derivations: new Set(),
      };
      endpoint.provenance.add(flow.provenance || '(legacy-unlabeled)');
      for (const derivation of sortedUnique(flow.analysisDerivations || [])) {
        endpoint.derivations.add(derivation);
        increment(derivations, derivation);
      }
      endpointRecords.set(endpointKey, endpoint);
      exactPathKeys.add(flowPathKey(projectName, flow));
      increment(provenance, flow.provenance || '(legacy-unlabeled)');
      increment(carrierStates, flow.carrierState || '(legacy-untyped)');
    }
  }

  const durations = batch
    .map(item => Number(item.durationMs || 0))
    .filter(value => value > 0);
  return {
    root: resolvedRoot,
    manifest: {
      revision: manifest.environment?.git?.revision || null,
      trackedFilesDirty: manifest.environment?.git?.trackedFilesDirty ?? null,
      completedAt: manifest.completedAt || null,
      projects: expectedProjects,
      sdkSha256: manifest.inputs?.sdk?.sha256 || null,
      buildSha256: manifest.inputs?.build?.sha256 || null,
    },
    totals: {
      flows,
      endpoints: endpointRecords.size,
      exactPaths: exactPathKeys.size,
      ifdsEdges,
      runtimeMs: durations.reduce((total, value) => total + value, 0),
    },
    provenance: sortedObject(provenance),
    derivations: sortedObject(derivations),
    carrierStates: sortedObject(carrierStates),
    endpointRecords,
    exactPathKeys,
  };
}

function setDifference(left, right) {
  return [...left].filter(value => !right.has(value)).sort();
}

function compareRuns(baselineRoot, candidateRoot) {
  const baseline = loadRun(baselineRoot);
  const candidate = loadRun(candidateRoot);
  const baselineEndpoints = new Set(baseline.endpointRecords.keys());
  const candidateEndpoints = new Set(candidate.endpointRecords.keys());
  const matchedEndpoints = [...baselineEndpoints]
    .filter(key => candidateEndpoints.has(key))
    .sort();
  const provenanceTransitions = {};
  const derivationTransitions = {};

  for (const key of matchedEndpoints) {
    const before = baseline.endpointRecords.get(key);
    const after = candidate.endpointRecords.get(key);
    increment(
      provenanceTransitions,
      `${sortedUnique([...before.provenance]).join('+') || '(none)'} -> `
        + `${sortedUnique([...after.provenance]).join('+') || '(none)'}`,
    );
    increment(
      derivationTransitions,
      `${sortedUnique([...before.derivations]).join('+') || '(none)'} -> `
        + `${sortedUnique([...after.derivations]).join('+') || '(none)'}`,
    );
  }

  const baselineOnlyEndpoints = setDifference(baselineEndpoints, candidateEndpoints);
  const candidateOnlyEndpoints = setDifference(candidateEndpoints, baselineEndpoints);
  const baselineOnlyPaths = setDifference(baseline.exactPathKeys, candidate.exactPathKeys);
  const candidateOnlyPaths = setDifference(candidate.exactPathKeys, baseline.exactPathKeys);

  return {
    generatedAt: new Date().toISOString(),
    definitions: {
      endpoint: 'Project, source identity/location, source statement, sink location, and sink statement.',
      exactPath: 'Endpoint plus normalized statement, source file, line, and method sequence.',
      transition: 'Set-valued provenance or derivation labels on matched endpoints.',
    },
    baseline: {
      root: baseline.root,
      manifest: baseline.manifest,
      totals: baseline.totals,
      provenance: baseline.provenance,
      derivations: baseline.derivations,
      carrierStates: baseline.carrierStates,
    },
    candidate: {
      root: candidate.root,
      manifest: candidate.manifest,
      totals: candidate.totals,
      provenance: candidate.provenance,
      derivations: candidate.derivations,
      carrierStates: candidate.carrierStates,
    },
    overlap: {
      matchedEndpoints: matchedEndpoints.length,
      baselineOnlyEndpoints: baselineOnlyEndpoints.length,
      candidateOnlyEndpoints: candidateOnlyEndpoints.length,
      endpointSetPreserved: baselineOnlyEndpoints.length === 0
        && candidateOnlyEndpoints.length === 0,
      exactMatchedPaths: baseline.exactPathKeys.size - baselineOnlyPaths.length,
      baselineOnlyPaths: baselineOnlyPaths.length,
      candidateOnlyPaths: candidateOnlyPaths.length,
      exactPathSetPreserved: baselineOnlyPaths.length === 0
        && candidateOnlyPaths.length === 0,
    },
    transitions: {
      provenance: sortedObject(provenanceTransitions),
      derivations: sortedObject(derivationTransitions),
    },
    changedEndpointExamples: {
      baselineOnly: baselineOnlyEndpoints.slice(0, 20),
      candidateOnly: candidateOnlyEndpoints.slice(0, 20),
    },
  };
}

function markdown(comparison) {
  const baseline = comparison.baseline;
  const candidate = comparison.candidate;
  const overlap = comparison.overlap;
  const provenanceRows = Object.entries(comparison.transitions.provenance)
    .map(([transition, count]) => `| ${transition} | ${count} |`);
  const derivationRows = Object.entries(comparison.transitions.derivations)
    .map(([transition, count]) => `| ${transition} | ${count} |`);
  return [
    '# Corpus Solver Migration',
    '',
    '| Measure | Baseline | Candidate | Delta |',
    '|---|---:|---:|---:|',
    `| Unique paths | ${baseline.totals.flows} | ${candidate.totals.flows} | ${candidate.totals.flows - baseline.totals.flows} |`,
    `| Unique endpoints | ${baseline.totals.endpoints} | ${candidate.totals.endpoints} | ${candidate.totals.endpoints - baseline.totals.endpoints} |`,
    `| Exact path keys | ${baseline.totals.exactPaths} | ${candidate.totals.exactPaths} | ${candidate.totals.exactPaths - baseline.totals.exactPaths} |`,
    `| IFDS edges | ${baseline.totals.ifdsEdges} | ${candidate.totals.ifdsEdges} | ${candidate.totals.ifdsEdges - baseline.totals.ifdsEdges} |`,
    `| Isolated runtime (s) | ${(baseline.totals.runtimeMs / 1000).toFixed(1)} | ${(candidate.totals.runtimeMs / 1000).toFixed(1)} | ${((candidate.totals.runtimeMs - baseline.totals.runtimeMs) / 1000).toFixed(1)} |`,
    '',
    `Endpoint set preserved: **${overlap.endpointSetPreserved}** `
      + `(${overlap.matchedEndpoints} matched, ${overlap.baselineOnlyEndpoints} removed, `
      + `${overlap.candidateOnlyEndpoints} added).`,
    '',
    `Exact path set preserved: **${overlap.exactPathSetPreserved}** `
      + `(${overlap.exactMatchedPaths} matched, ${overlap.baselineOnlyPaths} removed, `
      + `${overlap.candidateOnlyPaths} added).`,
    '',
    '## Provenance transitions',
    '',
    '| Transition | Endpoints |',
    '|---|---:|',
    ...provenanceRows,
    '',
    '## Transfer-derivation transitions',
    '',
    '| Transition | Endpoints |',
    '|---|---:|',
    ...derivationRows,
    '',
  ].join('\n');
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const comparison = compareRuns(args.baseline, args.candidate);
  const outputDir = path.resolve(args.outputDir);
  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(
    path.join(outputDir, 'corpus_solver_migration.json'),
    `${JSON.stringify(comparison, null, 2)}\n`,
  );
  const report = markdown(comparison);
  fs.writeFileSync(path.join(outputDir, 'corpus_solver_migration.md'), `${report}\n`);
  console.log(report);
}

if (require.main === module) main();

module.exports = {
  compareRuns,
  flowEndpointKey,
  flowPathKey,
  normalizeProjectPath,
};
