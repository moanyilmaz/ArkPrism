'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const PACKAGE_ALIASES = Object.fromEntries(
  Object.entries(require('../config/package_aliases.json')).map(([name, aliases]) => [
    name.toLowerCase(),
    aliases.map(alias => alias.toLowerCase()),
  ]),
);

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 2) {
    const token = argv[index];
    const value = argv[index + 1];
    if (!token?.startsWith('--') || !value) throw new Error(`Invalid argument: ${token}`);
    args[token.slice(2)] = path.resolve(value);
  }
  for (const required of ['benchmark', 'reports', 'rules', 'output']) {
    if (!args[required]) throw new Error(`--${required} is required`);
  }
  return args;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, ''));
}

function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function normalizeNamespace(value) {
  const normalized = String(value || '').replace(/\s+/g, '').toLowerCase();
  if (normalized === 'devicemanager') return 'distributeddevicemanager';
  if (normalized === 'geolocation') return 'geolocationmanager';
  return normalized;
}

function normalizeMember(value) {
  const parts = String(value || '')
    .replace(/\(\)\s*$/, '')
    .replace(/\s*\(.*/, '')
    .split('.')
    .filter(Boolean);
  return (parts.pop() || '').trim().toLowerCase();
}

function apiKey(namespace, member) {
  return `${normalizeNamespace(namespace)}|${normalizeMember(member)}`;
}

function projectApiKey(projectName, key) {
  return `${projectName}\u0000${key}`;
}

function packageCompatible(observedPackage, configuredPackage) {
  const observed = String(observedPackage || '').trim().toLowerCase();
  const configured = String(configuredPackage || '').trim().toLowerCase();
  return observed === configured || (PACKAGE_ALIASES[observed] || []).includes(configured);
}

function loadRules(filePath) {
  const rules = [];
  for (const group of readJson(filePath)) {
    for (const entry of group.privacyApis || []) {
      rules.push({
        package: group.systemPackage,
        namespace: entry.namespace,
        member: entry.method,
        key: apiKey(entry.namespace, entry.method),
        category: entry.profilingCategory || null,
        permission: entry.permission || null,
      });
    }
  }
  return rules;
}

function canonicalReportedKey(usage, rules) {
  const observedKey = apiKey(usage.namespace, usage.method);
  const matches = rules.filter(rule => (
    rule.key === observedKey && packageCompatible(usage.apiPackage, rule.package)
  ));
  if (matches.length === 0) return { key: observedKey, configured: false, matches: [] };
  return { key: observedKey, configured: true, matches };
}

function reportFiles(root) {
  const files = [];
  const pending = [path.resolve(root)];
  while (pending.length > 0) {
    const current = pending.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const target = path.join(current, entry.name);
      if (entry.isDirectory() && entry.name !== 'logs') pending.push(target);
      else if (entry.isFile() && entry.name.endsWith('-arkprism-report.json')) files.push(target);
    }
  }
  return files.sort((left, right) => left.localeCompare(right));
}

function wilson(successes, total, z = 1.959963984540054) {
  if (total === 0) return { estimate: null, lower: null, upper: null };
  const p = successes / total;
  const z2 = z * z;
  const denominator = 1 + z2 / total;
  const center = (p + z2 / (2 * total)) / denominator;
  const half = z * Math.sqrt((p * (1 - p) + z2 / (4 * total)) / total) / denominator;
  return {
    estimate: p,
    lower: Math.max(0, center - half),
    upper: Math.min(1, center + half),
  };
}

function countBy(items, valueOf) {
  const counts = new Map();
  for (const item of items) {
    const key = valueOf(item);
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return Object.fromEntries([...counts.entries()].sort(([left], [right]) => (
    String(left).localeCompare(String(right))
  )));
}

function validateRunManifest(reportsRoot, benchmarkProjects) {
  const manifestPath = path.join(reportsRoot, 'run_manifest.json');
  if (!fs.existsSync(manifestPath)) throw new Error(`Missing run manifest: ${manifestPath}`);
  const manifest = readJson(manifestPath);
  const failures = [];
  const included = [...(manifest.inputs?.includedProjects || [])].sort();
  const expected = [...benchmarkProjects].sort();
  if (manifest.status !== 'complete') failures.push(`status=${manifest.status}`);
  if (Number(manifest.inputs?.projectCount) !== expected.length) {
    failures.push(`projectCount=${manifest.inputs?.projectCount}/${expected.length}`);
  }
  if (Number(manifest.progress?.completed) !== expected.length) {
    failures.push(`completed=${manifest.progress?.completed}/${expected.length}`);
  }
  if (Number(manifest.progress?.errors) !== 0) failures.push(`errors=${manifest.progress?.errors}`);
  if (!manifest.execution?.arkArgs?.includes('--no-taint')) failures.push('missing --no-taint');
  if (JSON.stringify(included) !== JSON.stringify(expected)) failures.push('included project set differs');
  if (failures.length > 0) {
    throw new Error(`Top-120 run validation failed: ${failures.join(', ')}`);
  }
  return {
    path: manifestPath,
    sha256: sha256File(manifestPath),
    status: manifest.status,
    projectCount: manifest.inputs.projectCount,
    completedAt: manifest.completedAt,
    build: manifest.inputs.build,
    implementation: manifest.inputs.implementation,
    sdk: manifest.inputs.sdk,
    configHashes: manifest.inputs.configHashes,
    arkArgs: manifest.execution.arkArgs,
  };
}

function evaluate({ benchmarkPath, reportsRoot, rulesPath }) {
  const benchmark = readJson(benchmarkPath);
  const rules = loadRules(rulesPath);
  const benchmarkProjects = benchmark.projects.map(project => project.projectName);
  if (benchmarkProjects.length !== 120 || new Set(benchmarkProjects).size !== 120) {
    throw new Error(`Benchmark must contain 120 unique projects, found ${benchmarkProjects.length}`);
  }
  if ((benchmark.annotations || []).length !== 666) {
    throw new Error(`Benchmark must contain 666 annotations, found ${benchmark.annotations?.length}`);
  }
  const benchmarkProjectSet = new Set(benchmarkProjects);
  const run = validateRunManifest(reportsRoot, benchmarkProjects);

  const reports = new Map();
  for (const reportFile of reportFiles(reportsRoot)) {
    const report = readJson(reportFile);
    if (!benchmarkProjectSet.has(report.projectName)) continue;
    if (reports.has(report.projectName)) throw new Error(`Duplicate report: ${report.projectName}`);
    reports.set(report.projectName, { report, reportFile, sha256: sha256File(reportFile) });
  }
  const missingReports = benchmarkProjects.filter(project => !reports.has(project));
  if (missingReports.length > 0) throw new Error(`Missing reports: ${missingReports.join(', ')}`);

  const goldByProjectKey = new Map();
  for (const annotation of benchmark.annotations) {
    const normalizedKey = apiKey(annotation.api.namespace, annotation.api.member);
    const key = projectApiKey(annotation.projectName, normalizedKey);
    if (goldByProjectKey.has(key)) throw new Error(`Duplicate benchmark key: ${key}`);
    goldByProjectKey.set(key, { ...annotation, normalizedKey });
  }

  const outputByProjectKey = new Map();
  const unresolvedOutputOccurrences = [];
  let outputOccurrences = 0;
  for (const projectName of benchmarkProjects) {
    const { report, reportFile } = reports.get(projectName);
    for (const usage of report.privacyApiUsages || []) {
      outputOccurrences += 1;
      const canonical = canonicalReportedKey(usage, rules);
      const key = projectApiKey(projectName, canonical.key);
      if (!outputByProjectKey.has(key)) {
        outputByProjectKey.set(key, {
          projectName,
          apiKey: canonical.key,
          configured: canonical.configured,
          occurrences: [],
        });
      }
      outputByProjectKey.get(key).occurrences.push({
        file: usage.file || null,
        line: Number(usage.line || 0),
        column: Number(usage.column || 0),
        package: usage.apiPackage || null,
        namespace: usage.namespace || null,
        member: usage.method || null,
        report: path.relative(reportsRoot, reportFile).replace(/\\/g, '/'),
      });
      if (!canonical.configured) {
        unresolvedOutputOccurrences.push({ projectName, usage });
      }
    }
  }

  const recovered = [];
  const missing = [];
  const unreviewed = [];
  for (const [key, annotation] of goldByProjectKey) {
    if (outputByProjectKey.has(key)) recovered.push(annotation);
    else missing.push(annotation);
  }
  for (const [key, output] of outputByProjectKey) {
    if (!goldByProjectKey.has(key)) unreviewed.push(output);
  }

  const projectResults = benchmark.projects.map(project => {
    const gold = benchmark.annotations.filter(item => item.projectName === project.projectName);
    const recoveredCount = gold.filter(item => outputByProjectKey.has(projectApiKey(
      project.projectName,
      apiKey(item.api.namespace, item.api.member),
    ))).length;
    const unreviewedCount = unreviewed.filter(item => item.projectName === project.projectName).length;
    return {
      sampleId: project.sampleId,
      projectName: project.projectName,
      goldKeys: gold.length,
      recoveredGoldKeys: recoveredCount,
      missingGoldKeys: gold.length - recoveredCount,
      unreviewedOutputKeys: unreviewedCount,
      completeGoldRecovery: recoveredCount === gold.length,
      outputReportSha256: reports.get(project.projectName).sha256,
    };
  });

  const evidenceKinds = {};
  for (const annotation of benchmark.annotations) {
    for (const kind of annotation.reviewDecision?.evidenceKinds || ['unspecified']) {
      if (!evidenceKinds[kind]) evidenceKinds[kind] = { gold: 0, recovered: 0, missing: 0 };
      evidenceKinds[kind].gold += 1;
      const key = projectApiKey(annotation.projectName, apiKey(annotation.api.namespace, annotation.api.member));
      if (outputByProjectKey.has(key)) evidenceKinds[kind].recovered += 1;
      else evidenceKinds[kind].missing += 1;
    }
  }
  for (const value of Object.values(evidenceKinds)) {
    value.coverage = value.gold ? value.recovered / value.gold : null;
  }

  const reviewedOutputPrecisionDefined = unreviewed.length === 0;
  const reviewedOutputPrecision = reviewedOutputPrecisionDefined
    ? recovered.length / outputByProjectKey.size
    : null;
  const result = {
    schemaVersion: 1,
    benchmark: {
      name: benchmark.benchmark.name,
      version: benchmark.benchmark.version,
      annotationUnit: benchmark.benchmark.annotationUnit,
      scope: benchmark.benchmark.scope,
      path: benchmarkPath,
      sha256: sha256File(benchmarkPath),
      projects: benchmarkProjects.length,
      confirmedProjectApiKeys: goldByProjectKey.size,
      sourceEvidenceLocations: benchmark.annotations.reduce(
        (sum, annotation) => sum + (annotation.sourceEvidence || []).length,
        0,
      ),
    },
    run,
    output: {
      reports: reports.size,
      privacyApiOccurrences: outputOccurrences,
      uniqueProjectApiKeys: outputByProjectKey.size,
      unresolvedConfiguredOccurrences: unresolvedOutputOccurrences.length,
    },
    metrics: {
      recoveredConfirmedKeys: recovered.length,
      missingConfirmedKeys: missing.length,
      confirmedKeyCoverage: recovered.length / goldByProjectKey.size,
      confirmedKeyCoverageWilson95: wilson(recovered.length, goldByProjectKey.size),
      unreviewedOutputKeys: unreviewed.length,
      reviewedOutputPrecisionDefined,
      reviewedOutputPrecision,
      reviewedOutputPrecisionWilson95: reviewedOutputPrecisionDefined
        ? wilson(recovered.length, outputByProjectKey.size)
        : null,
      projectsWithCompleteGoldRecovery: projectResults.filter(item => item.completeGoldRecovery).length,
      completeProjectCoverage: projectResults.filter(item => item.completeGoldRecovery).length
        / projectResults.length,
      occurrencePrecisionDefined: false,
      corpusRecallDefined: false,
    },
    stratification: {
      evidenceKinds,
      recoveredByNamespace: countBy(recovered, item => normalizeNamespace(item.api.namespace)),
      missingByNamespace: countBy(missing, item => normalizeNamespace(item.api.namespace)),
    },
    projectResults,
    missingConfirmedKeys: missing.map(item => ({
      annotationId: item.annotationId,
      sampleId: item.sampleId,
      projectName: item.projectName,
      api: item.api,
      sourceEvidence: item.sourceEvidence,
    })),
    unreviewedOutputKeys: unreviewed,
    unresolvedOutputOccurrences,
    metricContract: {
      confirmedKeyCoverage: 'Fraction of the 666 manually confirmed project-API keys reproduced by this run.',
      reviewedOutputPrecision: 'Defined only when every project-API key emitted by this run is present in the manually reviewed key set.',
      occurrencePrecision: 'Undefined because the Top-120 audit canonicalizes repeated report rows to project-API keys.',
      corpusRecall: 'Undefined because benchmark projects and candidates were selected from an earlier ArkPrism output.',
    },
  };
  return result;
}

function percent(value) {
  return value == null ? 'N/A' : `${(100 * value).toFixed(2)}%`;
}

function markdown(result) {
  const metric = result.metrics;
  const evidenceRows = Object.entries(result.stratification.evidenceKinds)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([kind, value]) => (
      `| ${kind} | ${value.gold} | ${value.recovered} | ${value.missing} | ${percent(value.coverage)} |`
    ));
  return [
    '# ArkPrism Top-120 Benchmark Evaluation',
    '',
    `- Benchmark SHA-256: \`${result.benchmark.sha256}\``,
    `- Run-manifest SHA-256: \`${result.run.sha256}\``,
    `- Projects/reports: ${result.benchmark.projects}/${result.output.reports}`,
    `- Confirmed project-API keys: ${result.benchmark.confirmedProjectApiKeys}`,
    `- Recovered confirmed keys: ${metric.recoveredConfirmedKeys}`,
    `- Missing confirmed keys: ${metric.missingConfirmedKeys}`,
    `- Confirmed-key coverage: ${percent(metric.confirmedKeyCoverage)}`,
    `- Unreviewed output keys: ${metric.unreviewedOutputKeys}`,
    `- Reviewed-output precision: ${percent(metric.reviewedOutputPrecision)}`,
    `- Projects with complete gold-key recovery: ${metric.projectsWithCompleteGoldRecovery}/${result.benchmark.projects}`,
    `- Detector output occurrences: ${result.output.privacyApiOccurrences}`,
    '',
    '> Metric scope: this output-selected benchmark supports manually confirmed project-API-key precision and key-reproduction coverage. It does not define occurrence-level precision or corpus recall.',
    '',
    '## Evidence-kind recovery',
    '',
    '| Evidence kind | Gold keys | Recovered | Missing | Coverage |',
    '|---|---:|---:|---:|---:|',
    ...evidenceRows,
    '',
    '## Machine-readable details',
    '',
    'See `top120_evaluation.json` for project-level results, missing confirmed keys, unreviewed output keys, report hashes, build/SDK/rule fingerprints, and metric definitions.',
    '',
  ].join('\n');
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const result = evaluate({
    benchmarkPath: args.benchmark,
    reportsRoot: args.reports,
    rulesPath: args.rules,
  });
  fs.mkdirSync(args.output, { recursive: true });
  fs.writeFileSync(
    path.join(args.output, 'top120_evaluation.json'),
    `${JSON.stringify(result, null, 2)}\n`,
  );
  fs.writeFileSync(path.join(args.output, 'top120_evaluation.md'), markdown(result));
  console.log(JSON.stringify({
    output: args.output,
    recoveredConfirmedKeys: result.metrics.recoveredConfirmedKeys,
    missingConfirmedKeys: result.metrics.missingConfirmedKeys,
    unreviewedOutputKeys: result.metrics.unreviewedOutputKeys,
    confirmedKeyCoverage: result.metrics.confirmedKeyCoverage,
    reviewedOutputPrecision: result.metrics.reviewedOutputPrecision,
  }));
}

if (require.main === module) main();

module.exports = {
  apiKey,
  canonicalReportedKey,
  evaluate,
  normalizeMember,
  normalizeNamespace,
  wilson,
};
