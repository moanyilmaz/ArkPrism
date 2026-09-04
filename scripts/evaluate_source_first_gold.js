const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { normalizeSensitiveApiCatalog } = require('../dist/sensitiveApiCatalog');

const PACKAGE_ALIASES = require('../config/package_aliases.json');

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    if (!key.startsWith('--') || !argv[index + 1]) throw new Error(`Invalid argument: ${key}`);
    args[key.slice(2)] = path.resolve(argv[index + 1]);
  }
  for (const required of ['gold', 'reports', 'rules', 'output']) {
    if (!args[required]) throw new Error(`--${required} is required`);
  }
  return args;
}

function normalized(value) {
  return String(value || '').replace(/\s+/g, '').toLowerCase();
}

function normalizedNamespace(value) {
  const result = normalized(value);
  if (result === 'devicemanager') return 'distributeddevicemanager';
  if (result === 'geolocation') return 'geolocationmanager';
  return result;
}

function normalizedMethod(value) {
  return normalized(value).replace(/\(\)$/, '');
}

function normalizedMember(value) {
  return normalized(value).replace(/\(.*/, '').split('.').filter(Boolean).pop() || '';
}

function packageAliases(packageName) {
  const key = Object.keys(PACKAGE_ALIASES).find(item =>
    item.toLowerCase() === String(packageName || '').toLowerCase(),
  );
  return key ? PACKAGE_ALIASES[key] : [];
}

function packageCompatible(observed, configured) {
  const left = String(observed || '').toLowerCase();
  const right = String(configured || '').toLowerCase();
  return left === right || packageAliases(observed).some(alias => alias.toLowerCase() === right) ||
    packageAliases(configured).some(alias => alias.toLowerCase() === left);
}

function loadRules(file) {
  const groups = normalizeSensitiveApiCatalog(JSON.parse(fs.readFileSync(file, 'utf8')));
  return groups.flatMap(group => (group.privacyApis || []).map(api => ({
    package: group.systemPackage,
    namespace: api.namespace,
    method: api.method,
  })));
}

function canonicalApi(usage, rules) {
  let matches = rules.filter(rule =>
    packageCompatible(usage.apiPackage, rule.package) &&
    normalizedNamespace(usage.namespace) === normalizedNamespace(rule.namespace) &&
    normalizedMethod(usage.method) === normalizedMethod(rule.method),
  );
  if (matches.length === 0) return null;
  const exactPackageMatches = matches.filter(rule =>
    String(rule.package).toLowerCase() === String(usage.apiPackage || '').toLowerCase(),
  );
  if (exactPackageMatches.length > 0) matches = exactPackageMatches;
  const unique = new Map(matches.map(rule => [
    [rule.package, normalizedNamespace(rule.namespace), normalizedMethod(rule.method)].join('|'),
    rule,
  ]));
  if (unique.size !== 1) return { ambiguous: [...unique.values()] };
  return [...unique.values()][0];
}

function occurrenceBaseKey(record) {
  return [
    record.project,
    String(record.file || '').replace(/\\/g, '/').toLowerCase(),
    Number(record.line || 0),
    record.api.package,
    normalizedNamespace(record.api.namespace),
    normalizedMethod(record.api.configuredMethod || record.api.method),
  ].join('|');
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function wilson(successes, total, z = 1.959963984540054) {
  if (total === 0) return { estimate: null, lower: null, upper: null };
  const p = successes / total;
  const denominator = 1 + z * z / total;
  const center = (p + z * z / (2 * total)) / denominator;
  const margin = z * Math.sqrt((p * (1 - p) + z * z / (4 * total)) / total) / denominator;
  return { estimate: p, lower: Math.max(0, center - margin), upper: Math.min(1, center + margin) };
}

function metric(tp, fp, fn) {
  const precision = tp + fp ? tp / (tp + fp) : null;
  const recall = tp + fn ? tp / (tp + fn) : null;
  return {
    tp, fp, fn,
    precision,
    recall,
    f1: precision == null || recall == null || precision + recall === 0
      ? null
      : 2 * precision * recall / (precision + recall),
    precisionWilson95: wilson(tp, tp + fp),
    recallWilson95: wilson(tp, tp + fn),
  };
}

function setMetric(expectedValues, observedValues) {
  const expected = new Set(expectedValues);
  const observed = new Set(observedValues);
  let tp = 0;
  for (const value of expected) if (observed.has(value)) tp++;
  return metric(tp, [...observed].filter(value => !expected.has(value)).length,
    [...expected].filter(value => !observed.has(value)).length);
}

function stratify(gold, detected, tpPairs, fp, fn, goldKey, detectedKey) {
  const result = {};
  const ensure = key => {
    const name = String(key || 'Unspecified');
    if (!result[name]) result[name] = { gold: 0, detected: 0, tp: 0, fp: 0, fn: 0 };
    return result[name];
  };
  for (const item of gold) ensure(goldKey(item)).gold++;
  for (const item of detected) ensure(detectedKey(item)).detected++;
  for (const pair of tpPairs) ensure(goldKey(pair.gold)).tp++;
  for (const item of fp) ensure(detectedKey(item)).fp++;
  for (const item of fn) ensure(goldKey(item)).fn++;
  for (const value of Object.values(result)) {
    Object.assign(value, metric(value.tp, value.fp, value.fn));
  }
  return Object.fromEntries(Object.entries(result).sort((left, right) =>
    right[1].gold - left[1].gold || left[0].localeCompare(right[0]),
  ));
}

function apiIdentity(api) {
  return [
    api.package,
    normalizedNamespace(api.namespace),
    normalizedMethod(api.configuredMethod || api.method),
  ].join('|');
}

function siteIdentity(record) {
  return [
    record.project,
    String(record.file || '').replace(/\\/g, '/').toLowerCase(),
    Number(record.line || 0),
    Number(record.column || 0),
    normalizedMember(record.api.configuredMethod || record.api.method),
  ].join('|');
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const gold = JSON.parse(fs.readFileSync(args.gold, 'utf8'));
  const rules = loadRules(args.rules);
  const goldBuckets = new Map();
  for (const annotation of gold.annotations) {
    const key = occurrenceBaseKey(annotation);
    goldBuckets.set(key, (goldBuckets.get(key) || []).concat(annotation));
  }

  const detected = [];
  let reportSdk = null;
  const reportProjects = new Set();
  const unresolved = [];
  const ambiguous = [];
  for (const project of gold.projects) {
    const reportFile = path.join(
      args.reports,
      project.project,
      `${project.project}-arkprism-report.json`,
    );
    if (!fs.existsSync(reportFile)) throw new Error(`Missing report: ${reportFile}`);
    reportProjects.add(project.project);
    const report = JSON.parse(fs.readFileSync(reportFile, 'utf8'));
    if (!reportSdk && report.sdk) reportSdk = report.sdk;
    for (const usage of report.privacyApiUsages || []) {
      const canonical = canonicalApi(usage, rules);
      const record = {
        project: project.project,
        file: usage.file,
        line: usage.line,
        column: usage.column,
        api: canonical && !canonical.ambiguous ? {
          package: canonical.package,
          namespace: canonical.namespace,
          configuredMethod: canonical.method,
        } : {
          package: usage.apiPackage,
          namespace: usage.namespace,
          configuredMethod: usage.method,
        },
        reportUsage: usage,
      };
      if (!canonical) unresolved.push(record);
      else if (canonical.ambiguous) ambiguous.push({ ...record, candidates: canonical.ambiguous });
      detected.push(record);
    }
  }

  const detectedBuckets = new Map();
  for (const record of detected) {
    const key = occurrenceBaseKey(record);
    detectedBuckets.set(key, (detectedBuckets.get(key) || []).concat(record));
  }
  const tp = [];
  const fp = [];
  const fn = [];
  const allKeys = new Set([...goldBuckets.keys(), ...detectedBuckets.keys()]);
  for (const key of allKeys) {
    const expected = [...(goldBuckets.get(key) || [])];
    const observed = [...(detectedBuckets.get(key) || [])];
    for (let observedIndex = observed.length - 1; observedIndex >= 0; observedIndex--) {
      const actual = observed[observedIndex];
      const actualColumn = Number(actual.column || 0);
      let expectedIndex = actualColumn > 0
        ? expected.findIndex(item => Number(item.column || 0) === actualColumn)
        : -1;
      if (expectedIndex < 0 && actualColumn === 0 && expected.length === 1) expectedIndex = 0;
      if (expectedIndex < 0) continue;
      tp.push({ gold: expected.splice(expectedIndex, 1)[0], detected: actual });
      observed.splice(observedIndex, 1);
    }
    fp.push(...observed);
    fn.push(...expected);
  }

  const evidence = {};
  for (const annotation of gold.annotations) {
    if (!evidence[annotation.evidenceKind]) evidence[annotation.evidenceKind] = { gold: 0, tp: 0, fn: 0 };
    evidence[annotation.evidenceKind].gold += 1;
  }
  for (const pair of tp) evidence[pair.gold.evidenceKind].tp += 1;
  for (const annotation of fn) evidence[annotation.evidenceKind].fn += 1;
  for (const value of Object.values(evidence)) {
    value.recall = value.gold ? value.tp / value.gold : null;
  }

  let projectTp = 0;
  let projectTn = 0;
  let projectFp = 0;
  let projectFn = 0;
  for (const project of gold.projects) {
    const expected = project.goldOccurrences > 0;
    const observed = detected.some(record => record.project === project.project);
    if (expected && observed) projectTp++;
    else if (!expected && !observed) projectTn++;
    else if (!expected && observed) projectFp++;
    else projectFn++;
  }
  const projectTotal = projectTp + projectTn + projectFp + projectFn;
  const projectClassification = {
    tp: projectTp,
    tn: projectTn,
    fp: projectFp,
    fn: projectFn,
    accuracy: (projectTp + projectTn) / projectTotal,
    accuracyWilson95: wilson(projectTp + projectTn, projectTotal),
    sensitivity: projectTp / (projectTp + projectFn),
    specificity: projectTn / (projectTn + projectFp),
  };

  const result = {
    schemaVersion: 1,
    benchmark: gold.benchmark,
    runManifest: path.posix.join(path.basename(args.reports), 'run_manifest.json'),
    projects: gold.projectCount,
    goldOccurrences: gold.occurrenceCount,
    detectedOccurrences: detected.length,
    occurrence: metric(tp.length, fp.length, fn.length),
    sourceCandidateClassification: (() => {
      const matchedSites = new Set(tp.map(pair => siteIdentity(pair.gold)));
      const missedSites = new Set(fn.map(siteIdentity).filter(site => !matchedSites.has(site)));
      const extraSites = new Set(fp.map(siteIdentity));
      const site = metric(matchedSites.size, extraSites.size, missedSites.size);
      const tn = gold.rejectedCandidateCount - extraSites.size;
      const total = site.tp + site.fp + site.fn + tn;
      return {
        ...site,
        tn,
        accuracy: total ? (site.tp + tn) / total : null,
        specificity: tn + site.fp ? tn / (tn + site.fp) : null,
      };
    })(),
    projectApiKey: setMetric(
      gold.annotations.map(item => `${item.project}|${apiIdentity(item.api)}`),
      detected.map(item => `${item.project}|${apiIdentity(item.api)}`),
    ),
    uniqueApiIdentity: setMetric(
      gold.annotations.map(item => apiIdentity(item.api)),
      detected.map(item => apiIdentity(item.api)),
    ),
    projectClassification,
    rejectedNavigationCandidates: gold.rejectedCandidateCount,
    evidence,
    byAccessKind: stratify(
      gold.annotations,
      detected,
      tp,
      fp,
      fn,
      item => item.accessKind,
      item => item.reportUsage.category === 'privacy constants' ? 'property' : 'call',
    ),
    byDataType: stratify(
      gold.annotations,
      detected,
      tp,
      fp,
      fn,
      item => item.dataType,
      item => item.reportUsage.dataType,
    ),
    byPackage: stratify(
      gold.annotations,
      detected,
      tp,
      fp,
      fn,
      item => item.api.package,
      item => item.api.package,
    ),
    unresolvedConfiguredIdentities: unresolved,
    ambiguousConfiguredIdentities: ambiguous,
    falsePositives: fp,
    falseNegatives: fn,
  };
  const runManifestFile = path.join(args.reports, 'run_manifest.json');
  if (fs.existsSync(runManifestFile)) {
    const runManifest = JSON.parse(fs.readFileSync(runManifestFile, 'utf8'));
    const sdkInput = runManifest.inputs?.sdk || {};
    result.runIntegrity = {
      status: runManifest.status,
      completed: runManifest.progress?.completed,
      errors: runManifest.progress?.errors,
      sdk: {
        sha256: sdkInput.sha256,
        files: sdkInput.files,
        bytes: sdkInput.bytes,
        apiVersion: reportSdk?.apiVersion,
        version: reportSdk?.version,
      },
      catalogSha256: runManifest.inputs?.configHashes?.['sensitive_apis.json'],
      expectedCatalogSha256: sha256(fs.readFileSync(args.rules)),
      implementationSourceSha256: runManifest.inputs?.implementation?.source?.sha256,
      compiledBuildSha256: runManifest.inputs?.build?.sha256,
      taintDisabled: (runManifest.execution?.arkArgs || []).includes('--no-taint'),
    };
  }
  fs.mkdirSync(args.output, { recursive: true });
  fs.writeFileSync(
    path.join(args.output, 'source_first_evaluation.json'),
    `${JSON.stringify(result, null, 2)}\n`,
    'utf8',
  );
  const percent = value => value == null ? 'N/A' : `${(value * 100).toFixed(2)}%`;
  const metricRow = (name, value) =>
    `| ${name} | ${value.tp} | ${value.fp} | ${value.fn} | ` +
    `${percent(value.precision)} | ${percent(value.recall)} | ${percent(value.f1)} |`;
  const strataRows = strata => Object.entries(strata).map(([name, value]) =>
    `| ${name} | ${value.gold} | ${value.detected} | ${value.tp} | ${value.fp} | ` +
    `${value.fn} | ${percent(value.precision)} | ${percent(value.recall)} |`,
  );
  const lines = [
    `# ${gold.benchmark} Evaluation`,
    '',
    `- Projects: ${result.projects}`,
    `- Gold occurrences: ${result.goldOccurrences}`,
    `- Detected occurrences: ${result.detectedOccurrences}`,
    `- Occurrence TP/FP/FN: ${result.occurrence.tp}/${result.occurrence.fp}/${result.occurrence.fn}`,
    `- Occurrence precision: ${percent(result.occurrence.precision)}`,
    `- Occurrence recall: ${percent(result.occurrence.recall)}`,
    `- Occurrence F1: ${percent(result.occurrence.f1)}`,
    `- Precision Wilson 95% CI: [${percent(result.occurrence.precisionWilson95.lower)}, ${percent(result.occurrence.precisionWilson95.upper)}]`,
    `- Recall Wilson 95% CI: [${percent(result.occurrence.recallWilson95.lower)}, ${percent(result.occurrence.recallWilson95.upper)}]`,
    `- Project TP/TN/FP/FN: ${projectTp}/${projectTn}/${projectFp}/${projectFn}`,
    `- Project accuracy: ${percent(projectClassification.accuracy)}`,
    `- Project sensitivity/specificity: ${percent(projectClassification.sensitivity)}/${percent(projectClassification.specificity)}`,
    '',
    'The gold set covers executable `.ets`/`.ts` code under each project\'s declared build-module roots. ' +
    'Metrics below are observations on this fixed benchmark, not a universal guarantee for unseen projects.',
    '',
    '## Evaluation Levels',
    '',
    '| Level | TP | FP | FN | Precision | Recall | F1 |',
    '|---|---:|---:|---:|---:|---:|---:|',
    metricRow('API occurrences', result.occurrence),
    metricRow('Project-API keys', result.projectApiKey),
    metricRow('Unique API identities', result.uniqueApiIdentity),
    '',
    '## Source Candidate Classification',
    '',
    `- Accepted source sites: ${gold.acceptedCandidateCount}`,
    `- Rejected same-name candidates: ${gold.rejectedCandidateCount}`,
    `- TP/TN/FP/FN: ${result.sourceCandidateClassification.tp}/` +
      `${result.sourceCandidateClassification.tn}/${result.sourceCandidateClassification.fp}/` +
      `${result.sourceCandidateClassification.fn}`,
    `- Accuracy: ${percent(result.sourceCandidateClassification.accuracy)}`,
    `- Specificity: ${percent(result.sourceCandidateClassification.specificity)}`,
    '',
    '## Evidence Stratification',
    '',
    '| Evidence | Gold | TP | FN | Recall |',
    '|---|---:|---:|---:|---:|',
    ...Object.entries(evidence).sort().map(([name, value]) =>
      `| ${name} | ${value.gold} | ${value.tp} | ${value.fn} | ${percent(value.recall)} |`,
    ),
    '',
    '## Access Kind',
    '',
    '| Access | Gold | Detected | TP | FP | FN | Precision | Recall |',
    '|---|---:|---:|---:|---:|---:|---:|---:|',
    ...strataRows(result.byAccessKind),
    '',
    '## PAC Data Type',
    '',
    '| Data type | Gold | Detected | TP | FP | FN | Precision | Recall |',
    '|---|---:|---:|---:|---:|---:|---:|---:|',
    ...strataRows(result.byDataType),
    '',
    '## API Package',
    '',
    '| Package | Gold | Detected | TP | FP | FN | Precision | Recall |',
    '|---|---:|---:|---:|---:|---:|---:|---:|',
    ...strataRows(result.byPackage),
  ];
  if (result.runIntegrity) {
    lines.push(
      '',
      '## Run Integrity',
      '',
      `- Run status: ${result.runIntegrity.status}`,
      `- Completed/errors: ${result.runIntegrity.completed}/${result.runIntegrity.errors}`,
      `- SDK API/version: ${result.runIntegrity.sdk?.apiVersion}/${result.runIntegrity.sdk?.version}`,
      `- SDK SHA-256: ${result.runIntegrity.sdk?.sha256}`,
      `- Catalog SHA-256: ${result.runIntegrity.catalogSha256}`,
      `- Implementation source SHA-256: ${result.runIntegrity.implementationSourceSha256}`,
      `- Compiled build SHA-256: ${result.runIntegrity.compiledBuildSha256}`,
      `- Detector-only mode: ${result.runIntegrity.taintDisabled}`,
    );
  }
  fs.writeFileSync(path.join(args.output, 'source_first_evaluation.md'), `${lines.join('\n')}\n`, 'utf8');
  console.log(JSON.stringify({
    output: args.output,
    tp: tp.length,
    fp: fp.length,
    fn: fn.length,
    projectTp,
    projectTn,
    projectFp,
    projectFn,
  }));
}

main();
