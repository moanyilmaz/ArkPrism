const fs = require('fs');
const path = require('path');

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

function packageCompatible(observed, configured) {
  return observed === configured || (PACKAGE_ALIASES[observed] || []).includes(configured);
}

function loadRules(file) {
  const groups = JSON.parse(fs.readFileSync(file, 'utf8'));
  return groups.flatMap(group => (group.privacyApis || []).map(api => ({
    package: group.systemPackage,
    namespace: api.namespace,
    method: api.method,
  })));
}

function canonicalApi(usage, rules) {
  const matches = rules.filter(rule =>
    packageCompatible(usage.apiPackage, rule.package) &&
    normalizedNamespace(usage.namespace) === normalizedNamespace(rule.namespace) &&
    normalizedMethod(usage.method) === normalizedMethod(rule.method),
  );
  if (matches.length === 0) return null;
  const unique = new Map(matches.map(rule => [
    [rule.package, normalizedNamespace(rule.namespace), normalizedMethod(rule.method)].join('|'),
    rule,
  ]));
  if (unique.size !== 1) return { ambiguous: [...unique.values()] };
  return [...unique.values()][0];
}

function occurrenceKey(record) {
  return [
    record.project,
    String(record.file || '').replace(/\\/g, '/').toLowerCase(),
    Number(record.line || 0),
    Number(record.column || 0),
    record.api.package,
    normalizedNamespace(record.api.namespace),
    normalizedMethod(record.api.configuredMethod || record.api.method),
  ].join('|');
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

function main() {
  const args = parseArgs(process.argv.slice(2));
  const gold = JSON.parse(fs.readFileSync(args.gold, 'utf8'));
  const rules = loadRules(args.rules);
  const goldBuckets = new Map();
  for (const annotation of gold.annotations) {
    const key = occurrenceKey(annotation);
    goldBuckets.set(key, (goldBuckets.get(key) || []).concat(annotation));
  }

  const detected = [];
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
    const key = occurrenceKey(record);
    detectedBuckets.set(key, (detectedBuckets.get(key) || []).concat(record));
  }
  const tp = [];
  const fp = [];
  const fn = [];
  const allKeys = new Set([...goldBuckets.keys(), ...detectedBuckets.keys()]);
  for (const key of allKeys) {
    const expected = goldBuckets.get(key) || [];
    const observed = detectedBuckets.get(key) || [];
    const paired = Math.min(expected.length, observed.length);
    for (let index = 0; index < paired; index++) tp.push({ gold: expected[index], detected: observed[index] });
    fp.push(...observed.slice(paired));
    fn.push(...expected.slice(paired));
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
    runManifest: path.join(args.reports, 'run_manifest.json'),
    projects: gold.projectCount,
    goldOccurrences: gold.occurrenceCount,
    detectedOccurrences: detected.length,
    occurrence: metric(tp.length, fp.length, fn.length),
    projectClassification,
    rejectedNavigationCandidates: gold.rejectedCandidateCount,
    evidence,
    unresolvedConfiguredIdentities: unresolved,
    ambiguousConfiguredIdentities: ambiguous,
    falsePositives: fp,
    falseNegatives: fn,
  };
  fs.mkdirSync(args.output, { recursive: true });
  fs.writeFileSync(
    path.join(args.output, 'source_first_evaluation.json'),
    `${JSON.stringify(result, null, 2)}\n`,
    'utf8',
  );
  const percent = value => value == null ? 'N/A' : `${(value * 100).toFixed(2)}%`;
  const lines = [
    '# ArkSourceFirst60 Evaluation',
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
    '## Evidence Stratification',
    '',
    '| Evidence | Gold | TP | FN | Recall |',
    '|---|---:|---:|---:|---:|',
    ...Object.entries(evidence).sort().map(([name, value]) =>
      `| ${name} | ${value.gold} | ${value.tp} | ${value.fn} | ${percent(value.recall)} |`,
    ),
  ];
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
