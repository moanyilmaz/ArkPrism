const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function parseArgs(argv) {
  const args = {
    reports: '',
    batchSummary: '',
    detectorOverlay: '',
    taintOverlay: '',
    deduplicateApis: false,
    requireSingleRun: false,
    allowPackageMetadataDrift: false,
    outputDir: '',
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--reports') args.reports = argv[++i] || '';
    else if (arg === '--batch-summary') args.batchSummary = argv[++i] || '';
    else if (arg === '--detector-overlay') args.detectorOverlay = argv[++i] || '';
    else if (arg === '--taint-overlay') args.taintOverlay = argv[++i] || '';
    else if (arg === '--deduplicate-apis') args.deduplicateApis = true;
    else if (arg === '--require-single-run') args.requireSingleRun = true;
    else if (arg === '--allow-package-metadata-drift') {
      args.allowPackageMetadataDrift = true;
    }
    else if (arg === '--output-dir') args.outputDir = argv[++i] || '';
    else if (arg === '--help' || arg === '-h') {
      console.log([
        'Usage:',
        '  node scripts/summarize_corpus_reports.js --reports <dir>',
        '    --batch-summary <batch_summary.json> --output-dir <dir>',
        '    [--deduplicate-apis] [--require-single-run]',
        '    [--allow-package-metadata-drift]',
        '',
        'Development-only composition:',
        '    [--detector-overlay <dir>] [--taint-overlay <dir>]',
        '    (incompatible with --require-single-run)',
        '',
        'Summarizes detector output, runtime, and evidence distributions.',
        'It does not compute accuracy because the corpus has no independent oracle.',
      ].join('\n'));
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  if (!args.reports || !args.outputDir) {
    throw new Error('--reports and --output-dir are required');
  }
  if (!args.batchSummary) {
    args.batchSummary = path.join(args.reports, 'batch_summary.json');
  }
  if (args.requireSingleRun && (args.detectorOverlay || args.taintOverlay)) {
    throw new Error('--require-single-run cannot be combined with detector or taint overlays');
  }
  return args;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, ''));
}

function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function hashDirectory(root) {
  const resolvedRoot = path.resolve(root);
  const files = [];
  const stack = [resolvedRoot];
  while (stack.length > 0) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(fullPath);
      else if (entry.isFile()) files.push(fullPath);
    }
  }
  files.sort((left, right) => left.localeCompare(right));
  const hash = crypto.createHash('sha256');
  let bytes = 0;
  for (const filePath of files) {
    const relative = path.relative(resolvedRoot, filePath).replace(/\\/g, '/');
    const content = fs.readFileSync(filePath);
    hash.update(relative);
    hash.update('\0');
    hash.update(content);
    hash.update('\0');
    bytes += content.length;
  }
  return { sha256: hash.digest('hex'), files: files.length, bytes };
}

function verifyDirectoryFingerprint(label, manifestEntry, failures) {
  const root = manifestEntry?.path || manifestEntry?.root;
  if (!root || !fs.existsSync(root)) {
    failures.push(`${label} path missing: ${root || '(missing)'}`);
    return null;
  }
  const actual = hashDirectory(root);
  for (const field of ['sha256', 'files', 'bytes']) {
    if (String(actual[field]) !== String(manifestEntry?.[field])) {
      failures.push(`${label} ${field}=${actual[field]}/${manifestEntry?.[field] ?? '(missing)'}`);
    }
  }
  return actual;
}

function verifyFileFingerprint(label, filePath, expectedHash, failures) {
  if (!filePath || !fs.existsSync(filePath)) {
    failures.push(`${label} missing: ${filePath || '(missing)'}`);
    return null;
  }
  const actualHash = sha256File(filePath);
  if (!expectedHash || actualHash !== expectedHash) {
    failures.push(`${label} sha256=${actualHash}/${expectedHash || '(missing)'}`);
  }
  return actualHash;
}

function packageDependencyContract(packagePath, packageLockPath) {
  const packageJson = readJson(packagePath);
  const packageLock = readJson(packageLockPath);
  const lockedRoot = packageLock.packages?.[''];
  if (!lockedRoot) {
    return {
      consistent: false,
      mismatches: ['package-lock.json has no root package entry'],
    };
  }

  const fields = [
    'name',
    'version',
    'license',
    'dependencies',
    'devDependencies',
    'optionalDependencies',
    'peerDependencies',
  ];
  const canonicalJson = value => JSON.stringify(value ?? null, (_key, nestedValue) => {
    if (!nestedValue || Array.isArray(nestedValue) || typeof nestedValue !== 'object') {
      return nestedValue;
    }
    return Object.fromEntries(
      Object.entries(nestedValue).sort(([left], [right]) => left.localeCompare(right)),
    );
  });
  const mismatches = fields.filter(field => (
    canonicalJson(packageJson[field]) !== canonicalJson(lockedRoot[field])
  ));
  return {
    consistent: mismatches.length === 0,
    mismatches,
  };
}

function validateSingleRun(args, reportCount, batch) {
  const reportsDirectory = path.resolve(args.reports);
  const manifestPath = path.join(reportsDirectory, 'run_manifest.json');
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`Single-run manifest is missing: ${manifestPath}`);
  }

  const manifest = readJson(manifestPath);
  const projectCount = Number(manifest.inputs?.projectCount);
  const progress = manifest.progress || {};
  const outputDirectory = manifest.execution?.outputDir
    ? path.resolve(manifest.execution.outputDir)
    : '';
  const failures = [];

  if (manifest.status !== 'complete') failures.push(`status=${manifest.status}`);
  if (!Number.isInteger(projectCount) || projectCount <= 0) {
    failures.push(`invalid projectCount=${manifest.inputs?.projectCount}`);
  }
  if (manifest.execution?.resume === true) failures.push('resume=true');
  if (outputDirectory !== reportsDirectory) {
    failures.push(`outputDir=${outputDirectory || '(missing)'}`);
  }
  if (Number(progress.finished) !== projectCount) {
    failures.push(`finished=${progress.finished}/${projectCount}`);
  }
  if (Number(progress.completed) !== projectCount) {
    failures.push(`completed=${progress.completed}/${projectCount}`);
  }
  if (Number(progress.errors) !== 0) failures.push(`errors=${progress.errors}`);
  if (reportCount !== projectCount) failures.push(`reports=${reportCount}/${projectCount}`);
  if (!Array.isArray(batch)) {
    failures.push('batch summary is not an array');
  } else {
    if (batch.length !== projectCount) failures.push(`batchEntries=${batch.length}/${projectCount}`);
    const batchErrors = batch.filter(item => item.error);
    if (batchErrors.length > 0) failures.push(`batchErrors=${batchErrors.length}`);
  }

  const verifyInputHashes = args.verifyInputHashes !== false;
  let verifiedBuild = null;
  let verifiedSdk = null;
  let verifiedImplementation = null;
  const verifiedConfigHashes = {};
  if (verifyInputHashes) {
    verifiedBuild = verifyDirectoryFingerprint('build', manifest.inputs?.build, failures);
    verifiedSdk = verifyDirectoryFingerprint('SDK', manifest.inputs?.sdk, failures);

    const buildEntry = manifest.inputs?.build?.path
      ? path.join(manifest.inputs.build.path, 'arkprism.js')
      : '';
    if (!buildEntry || !fs.existsSync(buildEntry)) {
      failures.push(`build entry missing: ${buildEntry || '(missing)'}`);
    } else {
      const actualEntryHash = sha256File(buildEntry);
      if (actualEntryHash !== manifest.inputs?.build?.entrySha256) {
        failures.push(
          `build entry sha256=${actualEntryHash}/${manifest.inputs?.build?.entrySha256 ?? '(missing)'}`,
        );
      }
    }

    const configDir = path.resolve(
      args.configDir || path.join(__dirname, '..', 'config'),
    );
    const manifestConfigHashes = manifest.inputs?.configHashes || {};
    for (const [name, expectedHash] of Object.entries(manifestConfigHashes)) {
      const configPath = path.join(configDir, name);
      if (!fs.existsSync(configPath)) {
        failures.push(`configuration missing: ${configPath}`);
        continue;
      }
      const actualHash = sha256File(configPath);
      verifiedConfigHashes[name] = actualHash;
      if (actualHash !== expectedHash) {
        failures.push(`configuration ${name} sha256=${actualHash}/${expectedHash}`);
      }
    }
    if (Object.keys(manifestConfigHashes).length === 0) {
      failures.push('configuration hashes are missing');
    }

    const implementation = manifest.inputs?.implementation;
    if (!implementation) {
      failures.push('implementation fingerprint is missing');
    } else {
      const runnerPath = implementation.runnerPath
        ? path.resolve(implementation.runnerPath)
        : '';
      const repositoryRoot = runnerPath
        ? path.dirname(path.dirname(runnerPath))
        : '';
      const source = verifyDirectoryFingerprint(
        'implementation source',
        implementation.source,
        failures,
      );
      const packageJsonPath = repositoryRoot
        ? path.join(repositoryRoot, 'package.json')
        : '';
      const packageLockPath = repositoryRoot
        ? path.join(repositoryRoot, 'package-lock.json')
        : '';
      const packageJsonActualHash = packageJsonPath && fs.existsSync(packageJsonPath)
        ? sha256File(packageJsonPath)
        : null;
      const packageJsonExactMatch = Boolean(
        packageJsonActualHash
        && packageJsonActualHash === implementation.packageJsonSha256,
      );
      let packageMetadataDriftAccepted = false;
      let dependencyContract = null;
      if (!packageJsonActualHash) {
        failures.push(`implementation package.json missing: ${packageJsonPath || '(missing)'}`);
      } else if (!packageJsonExactMatch) {
        if (!args.allowPackageMetadataDrift) {
          failures.push(
            `implementation package.json sha256=${packageJsonActualHash}`
            + `/${implementation.packageJsonSha256 || '(missing)'}`,
          );
        } else if (!packageLockPath || !fs.existsSync(packageLockPath)) {
          failures.push('package metadata drift cannot be checked without package-lock.json');
        } else {
          dependencyContract = packageDependencyContract(packageJsonPath, packageLockPath);
          if (!dependencyContract.consistent) {
            failures.push(
              `package dependency contract changed: ${dependencyContract.mismatches.join('|')}`,
            );
          } else {
            packageMetadataDriftAccepted = true;
          }
        }
      }

      verifiedImplementation = {
        runnerSha256: verifyFileFingerprint(
          'implementation runner',
          runnerPath,
          implementation.runnerSha256,
          failures,
        ),
        source,
        packageJsonSha256: packageJsonActualHash,
        packageJsonManifestSha256: implementation.packageJsonSha256 || null,
        packageJsonExactMatch,
        packageMetadataDriftAccepted,
        packageDependencyContract: dependencyContract,
        packageLockSha256: implementation.packageLockSha256 === null
          ? null
          : verifyFileFingerprint(
            'implementation package-lock.json',
            packageLockPath,
            implementation.packageLockSha256,
            failures,
          ),
        tsconfigSha256: implementation.tsconfigSha256 === null
          ? null
          : verifyFileFingerprint(
            'implementation tsconfig.json',
            repositoryRoot ? path.join(repositoryRoot, 'tsconfig.json') : '',
            implementation.tsconfigSha256,
            failures,
          ),
      };
    }
  }

  if (failures.length > 0) {
    throw new Error(`Single-run validation failed: ${failures.join(', ')}`);
  }

  return {
    manifestPath,
    manifestSha256: sha256File(manifestPath),
    status: manifest.status,
    projectCount,
    completedAt: manifest.completedAt || null,
    analyzerRevision: manifest.environment?.git?.revision || null,
    trackedFilesDirty: manifest.environment?.git?.trackedFilesDirty ?? null,
    buildSha256: manifest.inputs?.build?.sha256 || null,
    buildEntrySha256: manifest.inputs?.build?.entrySha256 || null,
    sdkRoot: manifest.inputs?.sdk?.root || null,
    sdkSha256: manifest.inputs?.sdk?.sha256 || null,
    configHashes: manifest.inputs?.configHashes || {},
    implementation: manifest.inputs?.implementation || null,
    resume: Boolean(manifest.execution?.resume),
    inputVerification: {
      performed: verifyInputHashes,
      build: verifiedBuild,
      sdk: verifiedSdk,
      implementation: verifiedImplementation,
      configHashes: verifiedConfigHashes,
    },
  };
}

function reportPaths(root) {
  const result = [];
  const stack = [root];
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

function reportsByProject(root) {
  const reports = new Map();
  if (!root) return reports;
  for (const reportPath of reportPaths(root)) {
    const report = readJson(reportPath);
    const projectName = report.projectName || path.basename(path.dirname(reportPath));
    if (reports.has(projectName)) throw new Error(`Duplicate report for ${projectName}`);
    reports.set(projectName, report);
  }
  return reports;
}

function normalizedOccurrencePart(value) {
  return String(value || '').replace(/\\/g, '/').trim().toLowerCase();
}

function apiOccurrenceKey(usage) {
  return JSON.stringify([
    normalizedOccurrencePart(usage.apiPackage),
    normalizedOccurrencePart(usage.namespace),
    normalizedOccurrencePart(usage.method),
    normalizedOccurrencePart(usage.file),
    normalizedOccurrencePart(usage.declaringMethod),
    String(usage.code || '').trim(),
  ]);
}

function detectorEvidenceStrength(usage) {
  switch (usage.matchEvidence) {
    case 'receiver_origin': return 2;
    case 'target_signature': return 3;
    case 'receiver_type': return 4;
    case 'namespace': return 1;
    default: return 5;
  }
}

function detectorRecords(report, deduplicate) {
  const usages = report.privacyApiUsages || [];
  const chains = report.callChains || [];
  if (!deduplicate) return { usages, chains, duplicatesRemoved: 0 };

  const selected = new Map();
  usages.forEach((usage, index) => {
    const key = apiOccurrenceKey(usage);
    const current = selected.get(key);
    if (!current || detectorEvidenceStrength(usage) > detectorEvidenceStrength(current.usage)) {
      selected.set(key, { index, usage });
    }
  });
  const selectedIndexes = new Set([...selected.values()].map(item => item.index));
  return {
    usages: [...selected.values()].map(item => item.usage),
    chains: chains.filter(chain => selectedIndexes.has(Number(chain.apiUsageIndex))),
    duplicatesRemoved: usages.length - selected.size,
  };
}

function increment(map, key, amount = 1) {
  const normalized = String(key || '(unknown)');
  map.set(normalized, (map.get(normalized) || 0) + amount);
}

function sortedEntries(map) {
  return [...map.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([name, count]) => ({ name, count }));
}

function quantiles(values) {
  if (values.length === 0) {
    return {
      count: 0,
      min: 0,
      p25: 0,
      median: 0,
      p75: 0,
      p90: 0,
      p95: 0,
      p99: 0,
      max: 0,
      mean: 0,
      variance: 0,
      standardDeviation: 0,
      coefficientOfVariation: 0,
      zeroRate: 0,
    };
  }
  const sorted = [...values].sort((left, right) => left - right);
  const at = percentile => sorted[
    Math.max(0, Math.min(sorted.length - 1, Math.ceil(sorted.length * percentile) - 1))
  ];
  const sum = sorted.reduce((total, value) => total + value, 0);
  const mean = sum / sorted.length;
  const variance = sorted.reduce(
    (total, value) => total + ((value - mean) ** 2),
    0,
  ) / sorted.length;
  const standardDeviation = Math.sqrt(variance);
  return {
    count: sorted.length,
    min: sorted[0],
    p25: at(0.25),
    median: at(0.50),
    p75: at(0.75),
    p90: at(0.90),
    p95: at(0.95),
    p99: at(0.99),
    max: sorted[sorted.length - 1],
    mean: Number(mean.toFixed(2)),
    variance: Number(variance.toFixed(2)),
    standardDeviation: Number(standardDeviation.toFixed(2)),
    coefficientOfVariation: mean === 0
      ? 0
      : Number((standardDeviation / mean).toFixed(4)),
    zeroRate: ratio(sorted.filter(value => value === 0).length, sorted.length),
  };
}

function ratio(numerator, denominator) {
  return denominator === 0 ? 0 : numerator / denominator;
}

function gini(values) {
  const sorted = values
    .map(value => Math.max(0, Number(value) || 0))
    .sort((left, right) => left - right);
  const total = sorted.reduce((sum, value) => sum + value, 0);
  if (sorted.length === 0 || total === 0) return 0;
  const weighted = sorted.reduce(
    (sum, value, index) => sum + ((index + 1) * value),
    0,
  );
  return ((2 * weighted) / (sorted.length * total))
    - ((sorted.length + 1) / sorted.length);
}

function concentrationStats(values) {
  const normalized = values.map(value => Math.max(0, Number(value) || 0));
  const total = normalized.reduce((sum, value) => sum + value, 0);
  if (total === 0) {
    return { gini: 0, hhi: 0, effectiveProjects: 0 };
  }
  const hhi = normalized.reduce(
    (sum, value) => sum + ((value / total) ** 2),
    0,
  );
  return {
    gini: Number(gini(normalized).toFixed(6)),
    hhi: Number(hhi.toFixed(6)),
    effectiveProjects: Number((1 / hhi).toFixed(2)),
  };
}

function averageRanks(values) {
  const indexed = values
    .map((value, index) => ({ value, index }))
    .sort((left, right) => left.value - right.value || left.index - right.index);
  const ranks = new Array(values.length);
  for (let start = 0; start < indexed.length;) {
    let end = start + 1;
    while (end < indexed.length && indexed[end].value === indexed[start].value) end++;
    const average = ((start + 1) + end) / 2;
    for (let index = start; index < end; index++) {
      ranks[indexed[index].index] = average;
    }
    start = end;
  }
  return ranks;
}

function pearson(left, right) {
  if (left.length !== right.length || left.length < 2) return null;
  const leftMean = left.reduce((sum, value) => sum + value, 0) / left.length;
  const rightMean = right.reduce((sum, value) => sum + value, 0) / right.length;
  let numerator = 0;
  let leftSquared = 0;
  let rightSquared = 0;
  for (let index = 0; index < left.length; index++) {
    const leftDelta = left[index] - leftMean;
    const rightDelta = right[index] - rightMean;
    numerator += leftDelta * rightDelta;
    leftSquared += leftDelta ** 2;
    rightSquared += rightDelta ** 2;
  }
  const denominator = Math.sqrt(leftSquared * rightSquared);
  return denominator === 0 ? null : numerator / denominator;
}

function spearman(left, right) {
  const value = pearson(averageRanks(left), averageRanks(right));
  return value === null ? null : Number(value.toFixed(4));
}

function logLogRegression(left, right) {
  if (left.length !== right.length || left.length < 2) {
    return { observations: 0, slope: null, intercept: null, rSquared: null };
  }
  const x = left.map(value => Math.log1p(Math.max(0, value)));
  const y = right.map(value => Math.log1p(Math.max(0, value)));
  const xMean = x.reduce((sum, value) => sum + value, 0) / x.length;
  const yMean = y.reduce((sum, value) => sum + value, 0) / y.length;
  const covariance = x.reduce(
    (sum, value, index) => sum + ((value - xMean) * (y[index] - yMean)),
    0,
  );
  const xVariance = x.reduce((sum, value) => sum + ((value - xMean) ** 2), 0);
  if (xVariance === 0) {
    return { observations: x.length, slope: null, intercept: null, rSquared: null };
  }
  const slope = covariance / xVariance;
  const intercept = yMean - (slope * xMean);
  const fitted = x.map(value => intercept + (slope * value));
  const residual = y.reduce(
    (sum, value, index) => sum + ((value - fitted[index]) ** 2),
    0,
  );
  const total = y.reduce((sum, value) => sum + ((value - yMean) ** 2), 0);
  return {
    observations: x.length,
    slope: Number(slope.toFixed(4)),
    intercept: Number(intercept.toFixed(4)),
    rSquared: total === 0 ? null : Number((1 - (residual / total)).toFixed(4)),
  };
}

function percent(value) {
  return `${(value * 100).toFixed(2)}%`;
}

function countSinks(report) {
  return (report.callChains || []).reduce(
    (total, chain) => total + (chain.dataSinks || []).length,
    0,
  );
}

function classifyEntry(entry) {
  if (typeof entry === 'string') return 'string-entry';
  return entry?.type || '(unknown)';
}

function classifyDetectorEvidence(usage) {
  if (usage.matchEvidence) return usage.matchEvidence;
  if (usage.category === 'indirect invoke') return '(missing-indirect-evidence)';
  return 'direct-or-property';
}

function isResolvedPath(value) {
  const text = String(value || '').trim().toLowerCase();
  return text.length > 0
    && text !== '[object object]'
    && text !== '(unknown)'
    && text !== 'unknown';
}

function evidenceState(project) {
  return [
    project.apis > 0 ? 'A1' : 'A0',
    project.chains > 0 ? 'C1' : 'C0',
    project.sinks > 0 ? 'S1' : 'S0',
    project.taintFlows > 0 ? 'T1' : 'T0',
  ].join('-');
}

function scaleQuintiles(projects) {
  const sorted = [...projects].sort(
    (left, right) => left.methods - right.methods
      || left.projectName.localeCompare(right.projectName),
  );
  if (sorted.length === 0) return [];
  const labels = ['Q1 (smallest)', 'Q2', 'Q3', 'Q4', 'Q5 (largest)'];
  const bins = labels.map(() => []);
  sorted.forEach((project, index) => {
    const bin = Math.min(labels.length - 1, Math.floor((index * labels.length) / sorted.length));
    bins[bin].push(project);
  });
  return bins.map((projectsInBin, index) => ({
    bin: labels[index],
    projects: projectsInBin.length,
    methods: quantiles(projectsInBin.map(project => project.methods)),
    runtimeMs: quantiles(
      projectsInBin.map(project => project.runtimeMs).filter(value => value > 0),
    ),
    apiPositiveRate: ratio(
      projectsInBin.filter(project => project.apis > 0).length,
      projectsInBin.length,
    ),
    sinkPositiveRate: ratio(
      projectsInBin.filter(project => project.sinks > 0).length,
      projectsInBin.length,
    ),
    taintPositiveRate: ratio(
      projectsInBin.filter(project => project.taintFlows > 0).length,
      projectsInBin.length,
    ),
    apiUsages: projectsInBin.reduce((sum, project) => sum + project.apis, 0),
    taintFlows: projectsInBin.reduce((sum, project) => sum + project.taintFlows, 0),
  }));
}

function strictnessFailuresForReport(taintReport, taintFlows) {
  const taintAnalysis = taintReport.taintAnalysis || {};
  const pointerAnalysis = taintAnalysis.pointerAnalysis || {};
  const ifds = taintAnalysis.ifds || {};
  const uniqueTaintFlows = Number(
    taintAnalysis.uniqueFlows ?? taintFlows,
  );
  const failures = [];
  if (taintAnalysis.status !== 'SUCCESS') {
    failures.push(`status=${taintAnalysis.status || '(missing)'}`);
  }
  if (pointerAnalysis.requested !== true) {
    failures.push(`ptaRequested=${String(pointerAnalysis.requested)}`);
  }
  if (pointerAnalysis.status !== 'SUCCESS') {
    failures.push(`ptaStatus=${pointerAnalysis.status || '(missing)'}`);
  }
  if (ifds.budgetExceeded !== false) {
    failures.push(`budgetExceeded=${String(ifds.budgetExceeded)}`);
  }
  if (ifds.batching !== false) {
    failures.push(`batching=${String(ifds.batching)}`);
  }
  if (Number(ifds.batches) !== 1) {
    failures.push(`batches=${String(ifds.batches)}`);
  }
  if (uniqueTaintFlows !== taintFlows) {
    failures.push(`uniqueFlows=${uniqueTaintFlows}/${taintFlows}`);
  }
  const invalidSourceKinds = (taintReport.taintFlows || []).filter(
    flow => flow.sourceKind !== 'privacy_data' && flow.sourceKind !== 'framework_input',
  ).length;
  if (invalidSourceKinds > 0) {
    failures.push(`invalidSourceKinds=${invalidSourceKinds}`);
  }
  return failures;
}

function summarize(args) {
  const paths = reportPaths(args.reports);
  const detectorOverlay = reportsByProject(args.detectorOverlay);
  const taintOverlay = reportsByProject(args.taintOverlay);
  const batch = fs.existsSync(args.batchSummary) ? readJson(args.batchSummary) : [];
  const singleRunValidation = args.requireSingleRun
    ? validateSingleRun(args, paths.length, batch)
    : null;
  if (!Array.isArray(batch)) {
    throw new Error('Batch summary must be a JSON array');
  }
  const runtimeByProject = new Map(
    batch.map(item => [item.projectName, Number(item.durationMs || 0)]),
  );
  const batchErrors = batch.filter(item => item.error);

  const profilingCategories = new Map();
  const detectorCategories = new Map();
  const apiPackages = new Map();
  const apiMembers = new Map();
  const sinkTypes = new Map();
  const sinkApis = new Map();
  const entryTypes = new Map();
  const detectorEvidence = new Map();
  const flowProvenance = new Map();
  const flowSourceKinds = new Map();
  const linkEvidence = new Map();
  const evidenceStates = new Map();
  const chainLengths = [];
  const taintPathLengths = [];
  let asyncChains = 0;
  let localFallbackChains = 0;
  let permissionBearingUsages = 0;
  let traceEndpoints = 0;
  let unresolvedTraceEndpoints = 0;
  let duplicateApiRecordsRemoved = 0;
  let taintFlowLinks = 0;
  let linkedTaintFlows = 0;
  let invalidTaintFlowLinks = 0;
  const reportStrictnessFailures = [];

  const projects = [];
  for (const reportPath of paths) {
    const report = readJson(reportPath);
    const projectName = report.projectName || path.basename(path.dirname(reportPath));
    const statistics = report.statistics || {};
    const detectorReport = detectorOverlay.get(projectName) || report;
    const taintReport = taintOverlay.get(projectName) || report;
    const detector = detectorRecords(detectorReport, args.deduplicateApis);
    const usages = detector.usages;
    const chains = detector.chains;
    const sinks = chains.reduce(
      (total, chain) => total + (chain.dataSinks || []).length,
      0,
    );
    const taintFlows = Array.isArray(taintReport.taintFlows)
      ? taintReport.taintFlows.length
      : Number(taintReport.statistics?.totalTaintFlows || 0);
    const taintAnalysis = taintReport.taintAnalysis || {};
    const ifds = taintAnalysis.ifds || {};
    const callback = taintAnalysis.callback || {};
    const ifdsRawFlows = Number(ifds.rawFlows || 0);
    const callbackRawFlows = Number(callback.rawFlows || 0);
    const rawTaintFlows = Number(
      taintAnalysis.flowsBeforeDeduplication
        ?? (ifdsRawFlows + callbackRawFlows),
    );
    const uniqueTaintFlows = Number(
      taintAnalysis.uniqueFlows ?? taintFlows,
    );
    const duplicateTaintFlowsRemoved = Number(
      taintAnalysis.duplicatesRemoved
        ?? Math.max(0, rawTaintFlows - uniqueTaintFlows),
    );
    const ifdsEdgesProcessed = Number(ifds.edgesProcessed || 0);
    const malformedCfgEdges = Number(ifds.malformedCfgEdges || 0);

    if (args.requireSingleRun) {
      const failures = strictnessFailuresForReport(taintReport, taintFlows);
      if (failures.length > 0) {
        reportStrictnessFailures.push({
          projectName,
          failures,
        });
      }
    }
    duplicateApiRecordsRemoved += detector.duplicatesRemoved;

    for (const usage of usages) {
      increment(profilingCategories, usage.profilingCategory);
      increment(detectorCategories, usage.category);
      increment(detectorEvidence, classifyDetectorEvidence(usage));
      increment(apiPackages, usage.apiPackage);
      increment(apiMembers, `${usage.namespace || '(unknown)'}.${usage.method || '(unknown)'}`);
      if (usage.permission) permissionBearingUsages++;
    }
    for (const chain of chains) {
      increment(entryTypes, classifyEntry(chain.entryMethod));
      chainLengths.push((chain.chain || []).length);
      if (chain.isAsync) asyncChains++;
      if (classifyEntry(chain.entryMethod) === 'local_fallback') localFallbackChains++;
      for (const sink of chain.dataSinks || []) {
        increment(sinkTypes, sink.sinkType);
        increment(sinkApis, sink.sinkApi);
      }
    }
    for (const flow of taintReport.taintFlows || []) {
      increment(flowProvenance, flow.provenance || '(legacy-unlabeled)');
      increment(flowSourceKinds, flow.sourceKind || '(legacy-unlabeled)');
      taintPathLengths.push((flow.path || []).length);
      for (const endpoint of [flow.sourceFile, flow.sinkFile]) {
        traceEndpoints++;
        if (!isResolvedPath(endpoint)) unresolvedTraceEndpoints++;
      }
      for (const step of flow.path || []) {
        traceEndpoints++;
        if (!isResolvedPath(step.file)) unresolvedTraceEndpoints++;
      }
    }
    const links = Array.isArray(taintReport.taintFlowLinks)
      ? taintReport.taintFlowLinks
      : [];
    const linkedFlowIndexes = new Set();
    const configuredSourceEndpoints = new Set();
    const configuredSinkEndpoints = new Set();
    for (const flow of taintReport.taintFlows || []) {
      configuredSourceEndpoints.add(JSON.stringify([
        normalizedOccurrencePart(flow.sourceApi),
        normalizedOccurrencePart(flow.sourceFile),
        Number(flow.sourceLine),
      ]));
      configuredSinkEndpoints.add(JSON.stringify([
        normalizedOccurrencePart(flow.sinkApi),
        normalizedOccurrencePart(flow.sinkFile),
        Number(flow.sinkLine),
      ]));
    }
    for (const link of links) {
      taintFlowLinks++;
      increment(linkEvidence, link.evidence || '(unknown)');
      const usageIndex = Number(link.apiUsageIndex);
      const flowIndex = Number(link.taintFlowIndex);
      if (!Number.isInteger(usageIndex)
          || !Number.isInteger(flowIndex)
          || usageIndex < 0
          || flowIndex < 0
          || usageIndex >= (taintReport.privacyApiUsages || []).length
          || flowIndex >= (taintReport.taintFlows || []).length) {
        invalidTaintFlowLinks++;
      } else {
        linkedFlowIndexes.add(flowIndex);
      }
    }
    linkedTaintFlows += linkedFlowIndexes.size;

    const project = {
      projectName,
      files: Number(statistics.totalFilesAnalyzed || 0),
      methods: Number(statistics.totalMethodsAnalyzed || 0),
      apis: usages.length,
      chains: chains.length,
      sinks,
      taintFlows,
      privacyDataFlows: (taintReport.taintFlows || []).filter(
        flow => flow.sourceKind === 'privacy_data',
      ).length,
      frameworkInputFlows: (taintReport.taintFlows || []).filter(
        flow => flow.sourceKind === 'framework_input',
      ).length,
      rawTaintFlows,
      ifdsRawFlows,
      callbackRawFlows,
      duplicateTaintFlowsRemoved,
      ifdsEdgesProcessed,
      malformedCfgEdges,
      taintFlowLinks: links.length,
      linkedTaintFlows: linkedFlowIndexes.size,
      configuredSourceEndpoints: configuredSourceEndpoints.size,
      configuredSinkEndpoints: configuredSinkEndpoints.size,
      runtimeMs: runtimeByProject.get(projectName) || 0,
    };
    increment(evidenceStates, evidenceState(project));
    projects.push(project);
  }

  if (args.requireSingleRun && reportStrictnessFailures.length > 0) {
    const preview = reportStrictnessFailures
      .slice(0, 10)
      .map(item => `${item.projectName}[${item.failures.join(',')}]`)
      .join('; ');
    throw new Error(
      `Per-report strictness validation failed for `
      + `${reportStrictnessFailures.length} project(s): ${preview}`,
    );
  }

  if (args.requireSingleRun) {
    const endpointInvariantFailures = projects.filter(project => (
      (project.taintFlows > 0) !== (project.configuredSourceEndpoints > 0)
      || (project.taintFlows > 0) !== (project.configuredSinkEndpoints > 0)
      || project.configuredSourceEndpoints > project.taintFlows
      || project.configuredSinkEndpoints > project.taintFlows
    ));
    if (endpointInvariantFailures.length > 0) {
      throw new Error(
        `Configured-query endpoint invariant failed for `
        + `${endpointInvariantFailures.length} project(s): `
        + endpointInvariantFailures.slice(0, 10).map(project => project.projectName).join(', '),
      );
    }
  }

  const sum = key => projects.reduce((total, project) => total + project[key], 0);
  const positive = key => projects.filter(project => project[key] > 0).length;
  const sortedByApis = [...projects].sort(
    (left, right) => right.apis - left.apis || left.projectName.localeCompare(right.projectName),
  );
  const totalApis = sum('apis');
  const concentration = count => ratio(
    sortedByApis.slice(0, count).reduce((total, project) => total + project.apis, 0),
    totalApis,
  );
  const runtimes = projects.map(project => project.runtimeMs).filter(value => value > 0);
  const timedProjects = projects.filter(project => project.runtimeMs > 0);
  const correlations = {};
  for (const [left, right] of [
    ['files', 'methods'],
    ['methods', 'runtimeMs'],
    ['files', 'runtimeMs'],
    ['methods', 'apis'],
    ['apis', 'sinks'],
    ['apis', 'taintFlows'],
    ['sinks', 'taintFlows'],
  ]) {
    const observations = right === 'runtimeMs' ? timedProjects : projects;
    correlations[`${left}Vs${right[0].toUpperCase()}${right.slice(1)}`] = {
      observations: observations.length,
      spearmanRho: spearman(
        observations.map(project => project[left]),
        observations.map(project => project[right]),
      ),
    };
  }

  return {
    generatedAt: new Date().toISOString(),
    scope: {
      reportsDirectory: path.resolve(args.reports),
      detectorOverlayDirectory: args.detectorOverlay
        ? path.resolve(args.detectorOverlay)
        : null,
      taintOverlayDirectory: args.taintOverlay
        ? path.resolve(args.taintOverlay)
        : null,
      deduplicateApis: args.deduplicateApis,
      duplicateApiRecordsRemoved,
      batchSummary: path.resolve(args.batchSummary),
      reports: projects.length,
      batchEntries: batch.length,
      batchErrors,
      singleRunValidation,
      claimBoundary: 'Descriptive detector output only; no independent corpus oracle is available.',
    },
    definitions: {
      detectorApiUsage: 'Executable usage accepted by sensitive_apis.json and detector evidence policy.',
      detectorLocalSink: 'Sink observation attached by local/callback tracing to a detector usage.',
      configuredMayPath: 'Path produced by the independently configured source/sink query through IFDS or the asynchronous supplement.',
      configuredSourceEndpoint: 'Unique configured-query source endpoint represented by at least one retained path.',
      configuredSinkEndpoint: 'Unique configured-query sink endpoint represented by at least one retained path.',
      privacyDataPath: 'Configured-query path seeded by a typed privacy-data return or callback carrier.',
      frameworkInputPath: 'Configured-query path seeded by an explicitly modeled framework input parameter.',
      endpointLink: 'Conservative source-endpoint join between a detector usage and a configured-query path.',
      setRelation: 'Detector-local sink projects and configured-query-path projects are separate evidence universes; neither is asserted to contain the other.',
    },
    totals: {
      files: sum('files'),
      methods: sum('methods'),
      privacyApiUsages: totalApis,
      callChains: sum('chains'),
      sinks: sum('sinks'),
      taintFlows: sum('taintFlows'),
      configuredSourceEndpoints: sum('configuredSourceEndpoints'),
      configuredSinkEndpoints: sum('configuredSinkEndpoints'),
      privacyDataFlows: sum('privacyDataFlows'),
      frameworkInputFlows: sum('frameworkInputFlows'),
      rawTaintFlows: sum('rawTaintFlows'),
      ifdsRawFlows: sum('ifdsRawFlows'),
      callbackRawFlows: sum('callbackRawFlows'),
      duplicateTaintFlowsRemoved: sum('duplicateTaintFlowsRemoved'),
      ifdsEdgesProcessed: sum('ifdsEdgesProcessed'),
      malformedCfgEdges: sum('malformedCfgEdges'),
      taintFlowLinks,
    },
    projectRates: {
      apiPositive: { count: positive('apis'), rate: ratio(positive('apis'), projects.length) },
      chainPositive: { count: positive('chains'), rate: ratio(positive('chains'), projects.length) },
      sinkPositive: { count: positive('sinks'), rate: ratio(positive('sinks'), projects.length) },
      taintPositive: {
        count: positive('taintFlows'),
        rate: ratio(positive('taintFlows'), projects.length),
      },
      configuredSourceEndpointPositive: {
        count: positive('configuredSourceEndpoints'),
        rate: ratio(positive('configuredSourceEndpoints'), projects.length),
      },
      configuredSinkEndpointPositive: {
        count: positive('configuredSinkEndpoints'),
        rate: ratio(positive('configuredSinkEndpoints'), projects.length),
      },
      privacyDataTaintPositive: {
        count: positive('privacyDataFlows'),
        rate: ratio(positive('privacyDataFlows'), projects.length),
      },
      frameworkInputTaintPositive: {
        count: positive('frameworkInputFlows'),
        rate: ratio(positive('frameworkInputFlows'), projects.length),
      },
    },
    distributions: {
      filesPerProject: quantiles(projects.map(project => project.files)),
      methodsPerProject: quantiles(projects.map(project => project.methods)),
      apisPerProject: quantiles(projects.map(project => project.apis)),
      apisPerPositiveProject: quantiles(projects.filter(project => project.apis > 0).map(project => project.apis)),
      chainsPerProject: quantiles(projects.map(project => project.chains)),
      sinksPerProject: quantiles(projects.map(project => project.sinks)),
      sinksPerPositiveProject: quantiles(projects.filter(project => project.sinks > 0).map(project => project.sinks)),
      taintFlowsPerProject: quantiles(projects.map(project => project.taintFlows)),
      taintFlowsPerPositiveProject: quantiles(projects.filter(project => project.taintFlows > 0).map(project => project.taintFlows)),
      privacyDataFlowsPerPositiveProject: quantiles(projects.filter(project => project.privacyDataFlows > 0).map(project => project.privacyDataFlows)),
      frameworkInputFlowsPerPositiveProject: quantiles(projects.filter(project => project.frameworkInputFlows > 0).map(project => project.frameworkInputFlows)),
      configuredSourceEndpointsPerPositiveProject: quantiles(projects.filter(project => project.configuredSourceEndpoints > 0).map(project => project.configuredSourceEndpoints)),
      configuredSinkEndpointsPerPositiveProject: quantiles(projects.filter(project => project.configuredSinkEndpoints > 0).map(project => project.configuredSinkEndpoints)),
      ifdsEdgesPerProject: quantiles(
        projects.map(project => project.ifdsEdgesProcessed),
      ),
      runtimeMs: quantiles(runtimes),
    },
    concentration: {
      top10ApiShare: concentration(10),
      top50ApiShare: concentration(50),
      top120ApiShare: concentration(120),
      apiUsages: concentrationStats(projects.map(project => project.apis)),
      sinks: concentrationStats(projects.map(project => project.sinks)),
      taintFlows: concentrationStats(projects.map(project => project.taintFlows)),
    },
    overlap: {
      definition: 'Project-level co-occurrence of reported evidence; these states are not pipeline conversion rates or accuracy estimates.',
      states: sortedEntries(evidenceStates),
      conditionalRates: {
        chainGivenApi: ratio(
          projects.filter(project => project.apis > 0 && project.chains > 0).length,
          positive('apis'),
        ),
        sinkGivenApi: ratio(
          projects.filter(project => project.apis > 0 && project.sinks > 0).length,
          positive('apis'),
        ),
        taintGivenApi: ratio(
          projects.filter(project => project.apis > 0 && project.taintFlows > 0).length,
          positive('apis'),
        ),
        taintGivenSink: ratio(
          projects.filter(project => project.sinks > 0 && project.taintFlows > 0).length,
          positive('sinks'),
        ),
      },
    },
    scalability: {
      methodQuintiles: scaleQuintiles(projects),
      correlations,
      logMethodsVsRuntime: logLogRegression(
        timedProjects.map(project => project.methods),
        timedProjects.map(project => project.runtimeMs),
      ),
    },
    traceability: {
      chainLength: quantiles(chainLengths),
      taintPathLength: quantiles(taintPathLengths),
      asyncChains,
      localFallbackChains,
      permissionBearingUsages,
      traceEndpoints,
      unresolvedTraceEndpoints,
      resolvedTraceEndpointRate: ratio(
        traceEndpoints - unresolvedTraceEndpoints,
        traceEndpoints,
      ),
      taintFlowLinks,
      linkedTaintFlows,
      invalidTaintFlowLinks,
      linkedFlowRate: ratio(linkedTaintFlows, sum('taintFlows')),
      strictReportChecks: {
        checked: args.requireSingleRun ? projects.length : 0,
        failures: reportStrictnessFailures,
      },
    },
    evidence: {
      profilingCategories: sortedEntries(profilingCategories),
      detectorCategories: sortedEntries(detectorCategories),
      detectorEvidence: sortedEntries(detectorEvidence),
      flowProvenance: sortedEntries(flowProvenance),
      flowSourceKinds: sortedEntries(flowSourceKinds),
      linkEvidence: sortedEntries(linkEvidence),
      apiPackages: sortedEntries(apiPackages),
      apiMembers: sortedEntries(apiMembers),
      sinkTypes: sortedEntries(sinkTypes),
      sinkApis: sortedEntries(sinkApis),
      entryTypes: sortedEntries(entryTypes),
    },
    topProjects: {
      byApis: sortedByApis.slice(0, 30),
      byTaintFlows: [...projects]
        .sort((left, right) => right.taintFlows - left.taintFlows
          || left.projectName.localeCompare(right.projectName))
        .slice(0, 30),
      byRuntime: [...projects]
        .sort((left, right) => right.runtimeMs - left.runtimeMs
          || left.projectName.localeCompare(right.projectName))
        .slice(0, 30),
    },
    projects,
  };
}

function markdown(summary) {
  const total = summary.totals;
  const rates = summary.projectRates;
  const runtime = summary.distributions.runtimeMs;
  const rows = [
    ['Completed reports', summary.scope.reports, 'Project'],
    ['Analysis errors', summary.scope.batchErrors.length, 'Project'],
    ['Files analyzed', total.files, 'ArkTS/TypeScript file'],
    ['Methods analyzed', total.methods, 'Ark method'],
    ['Privacy API usages', total.privacyApiUsages, 'Reported occurrence'],
    ['Call chains', total.callChains, 'Reported chain'],
    ['Detector-local sinks', total.sinks, 'Local/callback sink observation'],
    ['Configured-query may-paths', total.taintFlows, 'Deduplicated static path'],
    ['Configured source endpoints', total.configuredSourceEndpoints, 'Unique path source endpoint'],
    ['Configured sink endpoints', total.configuredSinkEndpoints, 'Unique path sink endpoint'],
    ['Privacy-data may-paths', total.privacyDataFlows, 'Typed privacy source path'],
    ['Framework-input may-paths', total.frameworkInputFlows, 'Modeled input path'],
    ['Endpoint links', total.taintFlowLinks, 'Detector-to-path join'],
  ];
  const rateRows = [
    ['API-positive', rates.apiPositive.count, percent(rates.apiPositive.rate)],
    ['Chain-positive', rates.chainPositive.count, percent(rates.chainPositive.rate)],
    ['Detector-sink-positive', rates.sinkPositive.count, percent(rates.sinkPositive.rate)],
    ['Configured-path-positive', rates.taintPositive.count, percent(rates.taintPositive.rate)],
    ['Configured-source-endpoint-positive', rates.configuredSourceEndpointPositive.count, percent(rates.configuredSourceEndpointPositive.rate)],
    ['Configured-sink-endpoint-positive', rates.configuredSinkEndpointPositive.count, percent(rates.configuredSinkEndpointPositive.rate)],
    ['Privacy-path-positive', rates.privacyDataTaintPositive.count, percent(rates.privacyDataTaintPositive.rate)],
    ['Framework-input-path-positive', rates.frameworkInputTaintPositive.count, percent(rates.frameworkInputTaintPositive.rate)],
  ];
  const evidenceRows = summary.evidence.profilingCategories
    .slice(0, 20)
    .map(item => `| ${item.name} | ${item.count} |`);
  const sinkRows = summary.evidence.sinkTypes
    .map(item => `| ${item.name} | ${item.count} |`);
  const stateRows = summary.overlap.states
    .map(item => `| ${item.name} | ${item.count} |`);
  const provenanceRows = summary.evidence.flowProvenance
    .map(item => `| ${item.name} | ${item.count} |`);
  const sourceKindRows = summary.evidence.flowSourceKinds
    .map(item => `| ${item.name} | ${item.count} |`);
  const quintileRows = summary.scalability.methodQuintiles.map(item => [
    item.bin,
    item.projects,
    item.methods.median,
    (item.runtimeMs.median / 1000).toFixed(1),
    percent(item.apiPositiveRate),
    percent(item.sinkPositiveRate),
    percent(item.taintPositiveRate),
  ]);
  const correlationRows = Object.entries(summary.scalability.correlations)
    .map(([name, value]) => `| ${name} | ${value.observations} | ${value.spearmanRho ?? 'N/A'} |`);
  const apiConcentration = summary.concentration.apiUsages;

  return [
    '# Large-Corpus Analysis',
    '',
    `Generated: ${summary.generatedAt}`,
    '',
    '> This report describes ArkPrism output. It does not estimate accuracy or recall because the corpus has no independent exhaustive oracle.',
    '',
    '## Completion and evidence',
    '',
    '| Measure | Count | Unit |',
    '|---|---:|---|',
    ...rows.map(row => `| ${row.join(' | ')} |`),
    '',
    '## Project-level prevalence',
    '',
    '| Evidence | Projects | Rate |',
    '|---|---:|---:|',
    ...rateRows.map(row => `| ${row.join(' | ')} |`),
    '',
    '## Runtime',
    '',
    `- Median/project: ${(runtime.median / 1000).toFixed(1)} s`,
    `- P95/project: ${(runtime.p95 / 1000).toFixed(1)} s`,
    `- Maximum/project: ${(runtime.max / 1000).toFixed(1)} s`,
    `- Sum of isolated-process CPU wall times: ${(runtime.mean * runtimeByCount(summary) / 1000).toFixed(1)} s`,
    '',
    '## API concentration',
    '',
    `- Top 10 projects: ${percent(summary.concentration.top10ApiShare)}`,
    `- Top 50 projects: ${percent(summary.concentration.top50ApiShare)}`,
    `- Top 120 projects: ${percent(summary.concentration.top120ApiShare)}`,
    `- API-usage Gini: ${apiConcentration.gini.toFixed(3)}`,
    `- API-usage HHI: ${apiConcentration.hhi.toFixed(4)} (effective projects: ${apiConcentration.effectiveProjects.toFixed(1)})`,
    '',
    '## Project-level evidence overlap',
    '',
    '> A/C/S/T denote detector API, report call-chain, detector-local sink, and configured-query path evidence. Co-occurrence is descriptive and is not an accuracy, containment, or pipeline-conversion estimate.',
    '',
    '| State | Projects |',
    '|---|---:|',
    ...stateRows,
    '',
    `- Chain-positive given API-positive: ${percent(summary.overlap.conditionalRates.chainGivenApi)}`,
    `- Sink-positive given API-positive: ${percent(summary.overlap.conditionalRates.sinkGivenApi)}`,
    `- Configured-path-positive given detector-API-positive: ${percent(summary.overlap.conditionalRates.taintGivenApi)}`,
    `- Configured-path-positive given detector-sink-positive: ${percent(summary.overlap.conditionalRates.taintGivenSink)}`,
    '',
    '## Scale and runtime',
    '',
    '| Method-size bin | Projects | Median methods | Median runtime (s) | API-positive | Sink-positive | Taint-positive |',
    '|---|---:|---:|---:|---:|---:|---:|',
    ...quintileRows.map(row => `| ${row.join(' | ')} |`),
    '',
    '| Variables | N | Spearman rho |',
    '|---|---:|---:|',
    ...correlationRows,
    '',
    `Log(1+methods) vs. log(1+runtime): slope=${summary.scalability.logMethodsVsRuntime.slope ?? 'N/A'}, R2=${summary.scalability.logMethodsVsRuntime.rSquared ?? 'N/A'}.`,
    '',
    '## Solver integrity',
    '',
    `- IFDS edges processed: ${total.ifdsEdgesProcessed}; median/project: ${summary.distributions.ifdsEdgesPerProject.median}; P95: ${summary.distributions.ifdsEdgesPerProject.p95}; maximum: ${summary.distributions.ifdsEdgesPerProject.max}`,
    `- Raw IFDS paths: ${total.ifdsRawFlows}`,
    `- Raw asynchronous-supplement paths: ${total.callbackRawFlows}`,
    `- Paths before exact deduplication: ${total.rawTaintFlows}`,
    `- Unique configured-query paths: ${total.taintFlows}`,
    `- Exact duplicates removed: ${total.duplicateTaintFlowsRemoved}`,
    `- Malformed CFG edges skipped: ${total.malformedCfgEdges}`,
    `- Strict per-report checks: ${summary.traceability.strictReportChecks.checked}; failures: ${summary.traceability.strictReportChecks.failures.length}`,
    '',
    '| Path provenance | Unique paths |',
    '|---|---:|',
    ...provenanceRows,
    '',
    '| Source kind | Unique paths |',
    '|---|---:|',
    ...sourceKindRows,
    '',
    '## Evidence traceability',
    '',
    `- Median call-chain edges: ${summary.traceability.chainLength.median}; P95: ${summary.traceability.chainLength.p95}`,
    `- Median taint-path statements: ${summary.traceability.taintPathLength.median}; P95: ${summary.traceability.taintPathLength.p95}`,
    `- Async call chains: ${summary.traceability.asyncChains}`,
    `- Local-fallback call chains: ${summary.traceability.localFallbackChains}`,
    `- Permission-bearing API usages: ${summary.traceability.permissionBearingUsages}`,
    `- Resolved trace endpoints: ${percent(summary.traceability.resolvedTraceEndpointRate)} (${summary.traceability.traceEndpoints - summary.traceability.unresolvedTraceEndpoints}/${summary.traceability.traceEndpoints})`,
    `- Detector-to-path endpoint links: ${summary.traceability.taintFlowLinks}; linked configured-query paths: ${summary.traceability.linkedTaintFlows}/${total.taintFlows}; invalid links: ${summary.traceability.invalidTaintFlowLinks}`,
    '',
    '## Profiling categories',
    '',
    '| Category | API usages |',
    '|---|---:|',
    ...evidenceRows,
    '',
    '## Sink types',
    '',
    '| Sink type | Observations |',
    '|---|---:|',
    ...sinkRows,
    '',
  ].join('\n');
}

function runtimeByCount(summary) {
  return summary.projects.filter(project => project.runtimeMs > 0).length;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const summary = summarize(args);
  const outputDir = path.resolve(args.outputDir);
  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(
    path.join(outputDir, 'large_corpus_summary.json'),
    `${JSON.stringify(summary, null, 2)}\n`,
  );
  const report = markdown(summary);
  fs.writeFileSync(path.join(outputDir, 'large_corpus_summary.md'), `${report}\n`);
  console.log(report);
}

if (require.main === module) main();

module.exports = {
  averageRanks,
  concentrationStats,
  evidenceState,
  gini,
  hashDirectory,
  logLogRegression,
  packageDependencyContract,
  pearson,
  quantiles,
  scaleQuintiles,
  sha256File,
  spearman,
  strictnessFailuresForReport,
  validateSingleRun,
};
