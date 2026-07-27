const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  concentrationStats,
  evidenceState,
  gini,
  hashDirectory,
  logLogRegression,
  quantiles,
  scaleQuintiles,
  sha256File,
  spearman,
  strictnessFailuresForReport,
  validateSingleRun,
} = require('../scripts/summarize_corpus_reports');

assert.strictEqual(gini([0, 0, 0]), 0);
assert(Math.abs(gini([0, 0, 10]) - (2 / 3)) < 1e-9);

const concentration = concentrationStats([5, 5, 0, 0]);
assert.strictEqual(concentration.hhi, 0.5);
assert.strictEqual(concentration.effectiveProjects, 2);

const distribution = quantiles([0, 1, 2, 3, 4]);
assert.strictEqual(distribution.count, 5);
assert.strictEqual(distribution.median, 2);
assert.strictEqual(distribution.p99, 4);
assert.strictEqual(distribution.zeroRate, 0.2);

assert.strictEqual(spearman([1, 2, 3, 4], [10, 20, 30, 40]), 1);
assert.strictEqual(spearman([1, 2, 3, 4], [40, 30, 20, 10]), -1);

const regression = logLogRegression([1, 3, 7], [1, 3, 7]);
assert(Math.abs(regression.slope - 1) < 1e-4);
assert(Math.abs(regression.rSquared - 1) < 1e-4);

assert.strictEqual(evidenceState({
  apis: 1,
  chains: 1,
  sinks: 0,
  taintFlows: 2,
}), 'A1-C1-S0-T1');

const quintiles = scaleQuintiles(
  Array.from({ length: 10 }, (_, index) => ({
    projectName: `p${index}`,
    methods: index + 1,
    runtimeMs: (index + 1) * 100,
    apis: index % 2,
    sinks: 0,
    taintFlows: 0,
  })),
);
assert.deepStrictEqual(quintiles.map(item => item.projects), [2, 2, 2, 2, 2]);
assert.strictEqual(quintiles[0].methods.max, 2);
assert.strictEqual(quintiles[4].methods.min, 9);

const strictReport = {
  taintAnalysis: {
    status: 'SUCCESS',
    pointerAnalysis: {
      requested: true,
      status: 'SUCCESS',
    },
    ifds: {
      budgetExceeded: false,
      batching: false,
      batches: 1,
    },
    uniqueFlows: 2,
  },
};
assert.deepStrictEqual(
  strictnessFailuresForReport(strictReport, 2),
  [],
);
strictReport.taintAnalysis.ifds.batching = true;
assert.deepStrictEqual(
  strictnessFailuresForReport(strictReport, 2),
  ['batching=true'],
);
strictReport.taintAnalysis.ifds.batching = false;
strictReport.taintAnalysis.uniqueFlows = 1;
assert.deepStrictEqual(
  strictnessFailuresForReport(strictReport, 2),
  ['uniqueFlows=1/2'],
);

const runDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'arkprism-summary-'));
const sdkDirectory = path.join(runDirectory, 'sdk');
const buildDirectory = path.join(runDirectory, 'dist');
const configDirectory = path.join(runDirectory, 'config');
const sourceDirectory = path.join(runDirectory, 'src');
const scriptsDirectory = path.join(runDirectory, 'scripts');
fs.mkdirSync(sdkDirectory);
fs.mkdirSync(buildDirectory);
fs.mkdirSync(configDirectory);
fs.mkdirSync(sourceDirectory);
fs.mkdirSync(scriptsDirectory);
fs.writeFileSync(path.join(sdkDirectory, 'sdk.ets'), 'export const sdk = 20;\n');
fs.writeFileSync(path.join(buildDirectory, 'arkprism.js'), 'console.log("test");\n');
fs.writeFileSync(path.join(configDirectory, 'sensitive_apis.json'), '{}\n');
fs.writeFileSync(path.join(sourceDirectory, 'arkprism.ts'), 'export const test = true;\n');
fs.writeFileSync(path.join(scriptsDirectory, 'run.js'), 'console.log("run");\n');
fs.writeFileSync(
  path.join(runDirectory, 'package.json'),
  `${JSON.stringify({
    name: 'arkprism-test',
    version: '1.0.0',
    license: 'MIT',
    scripts: { test: 'node test.js' },
    dependencies: { example: '1.0.0' },
    devDependencies: { test: '1.0.0' },
  }, null, 2)}\n`,
);
fs.writeFileSync(
  path.join(runDirectory, 'package-lock.json'),
  `${JSON.stringify({
    packages: {
      '': {
        name: 'arkprism-test',
        version: '1.0.0',
        license: 'MIT',
        dependencies: { example: '1.0.0' },
        devDependencies: { test: '1.0.0' },
      },
    },
  }, null, 2)}\n`,
);
fs.writeFileSync(path.join(runDirectory, 'tsconfig.json'), '{}\n');
const sdkFingerprint = hashDirectory(sdkDirectory);
const buildFingerprint = hashDirectory(buildDirectory);
const sourceFingerprint = hashDirectory(sourceDirectory);
const manifest = {
  status: 'complete',
  completedAt: '2026-07-24T00:00:00.000Z',
  environment: {
    git: {
      revision: 'revision',
      trackedFilesDirty: false,
    },
  },
  inputs: {
    projectCount: 2,
    sdk: { root: sdkDirectory, ...sdkFingerprint },
    configHashes: {
      'sensitive_apis.json': sha256File(
        path.join(configDirectory, 'sensitive_apis.json'),
      ),
    },
    implementation: {
      runnerPath: path.join(scriptsDirectory, 'run.js'),
      runnerSha256: sha256File(path.join(scriptsDirectory, 'run.js')),
      source: {
        path: sourceDirectory,
        ...sourceFingerprint,
      },
      packageJsonSha256: sha256File(path.join(runDirectory, 'package.json')),
      packageLockSha256: sha256File(path.join(runDirectory, 'package-lock.json')),
      tsconfigSha256: sha256File(path.join(runDirectory, 'tsconfig.json')),
    },
    build: {
      path: buildDirectory,
      ...buildFingerprint,
      entrySha256: sha256File(path.join(buildDirectory, 'arkprism.js')),
    },
  },
  execution: {
    outputDir: runDirectory,
    resume: false,
  },
  progress: {
    finished: 2,
    completed: 2,
    errors: 0,
  },
};
fs.writeFileSync(
  path.join(runDirectory, 'run_manifest.json'),
  `${JSON.stringify(manifest, null, 2)}\n`,
);
const validated = validateSingleRun(
  { reports: runDirectory, configDir: configDirectory },
  2,
  [{ projectName: 'A' }, { projectName: 'B' }],
);
assert.strictEqual(validated.projectCount, 2);
assert.strictEqual(validated.buildSha256, buildFingerprint.sha256);
assert.strictEqual(validated.resume, false);
assert.strictEqual(validated.inputVerification.performed, true);
assert.strictEqual(
  validated.inputVerification.sdk.sha256,
  sdkFingerprint.sha256,
);
assert.strictEqual(
  validated.inputVerification.implementation.source.sha256,
  sourceFingerprint.sha256,
);

const recoveryProofPath = path.join(runDirectory, 'recovery-proof.json');
fs.writeFileSync(recoveryProofPath, '{"proof":true}\n');
manifest.execution.interruptionRecovery = true;
manifest.interruptionRecovery = {
  schemaVersion: 1,
  status: 'complete',
  primaryStatusBefore: 'running',
  recoveredAt: '2026-07-24T00:00:00.000Z',
  recoveredProjects: [{
    projectName: 'B',
    report: 'B/B-arkprism-report.json',
    reportSha256: 'report-hash',
  }],
  proofFiles: Array.from({ length: 4 }, (_, index) => ({
    path: 'recovery-proof.json',
    sha256: sha256File(recoveryProofPath),
    index,
  })),
};
fs.mkdirSync(path.join(runDirectory, 'B'));
fs.writeFileSync(
  path.join(runDirectory, 'B', 'B-arkprism-report.json'),
  '{"projectName":"B"}\n',
);
manifest.interruptionRecovery.recoveredProjects[0].reportSha256 = sha256File(
  path.join(runDirectory, 'B', 'B-arkprism-report.json'),
);
fs.writeFileSync(
  path.join(runDirectory, 'run_manifest.json'),
  `${JSON.stringify(manifest, null, 2)}\n`,
);
const recoveryValidated = validateSingleRun(
  { reports: runDirectory, configDir: configDirectory },
  2,
  [
    { projectName: 'A' },
    { projectName: 'B', recoveredFromInterruption: true },
  ],
);
assert.deepStrictEqual(
  recoveryValidated.interruptionRecovery.recoveredProjects,
  ['B'],
);
delete manifest.execution.interruptionRecovery;
delete manifest.interruptionRecovery;
fs.rmSync(path.join(runDirectory, 'B'), { recursive: true, force: true });
fs.rmSync(recoveryProofPath);
fs.writeFileSync(
  path.join(runDirectory, 'run_manifest.json'),
  `${JSON.stringify(manifest, null, 2)}\n`,
);

const changedPackage = readJsonForTest(path.join(runDirectory, 'package.json'));
changedPackage.scripts.audit = 'node audit.js';
fs.writeFileSync(
  path.join(runDirectory, 'package.json'),
  `${JSON.stringify(changedPackage, null, 2)}\n`,
);
assert.throws(
  () => validateSingleRun(
    { reports: runDirectory, configDir: configDirectory },
    2,
    [{ projectName: 'A' }, { projectName: 'B' }],
  ),
  /implementation package\.json sha256=/,
);
const metadataDriftValidation = validateSingleRun(
  {
    reports: runDirectory,
    configDir: configDirectory,
    allowPackageMetadataDrift: true,
  },
  2,
  [{ projectName: 'A' }, { projectName: 'B' }],
);
assert.strictEqual(
  metadataDriftValidation.inputVerification.implementation
    .packageMetadataDriftAccepted,
  true,
);
assert.strictEqual(
  metadataDriftValidation.inputVerification.implementation
    .packageDependencyContract.consistent,
  true,
);

changedPackage.dependencies.example = '2.0.0';
fs.writeFileSync(
  path.join(runDirectory, 'package.json'),
  `${JSON.stringify(changedPackage, null, 2)}\n`,
);
assert.throws(
  () => validateSingleRun(
    {
      reports: runDirectory,
      configDir: configDirectory,
      allowPackageMetadataDrift: true,
    },
    2,
    [{ projectName: 'A' }, { projectName: 'B' }],
  ),
  /package dependency contract changed: dependencies/,
);
changedPackage.dependencies.example = '1.0.0';
delete changedPackage.scripts.audit;
fs.writeFileSync(
  path.join(runDirectory, 'package.json'),
  `${JSON.stringify(changedPackage, null, 2)}\n`,
);

fs.writeFileSync(path.join(scriptsDirectory, 'run.js'), 'console.log("changed");\n');
assert.throws(
  () => validateSingleRun(
    { reports: runDirectory, configDir: configDirectory },
    2,
    [{ projectName: 'A' }, { projectName: 'B' }],
  ),
  /implementation runner sha256=/,
);
fs.writeFileSync(path.join(scriptsDirectory, 'run.js'), 'console.log("run");\n');

fs.writeFileSync(path.join(configDirectory, 'sensitive_apis.json'), '{"changed":true}\n');
assert.throws(
  () => validateSingleRun(
    { reports: runDirectory, configDir: configDirectory },
    2,
    [{ projectName: 'A' }, { projectName: 'B' }],
  ),
  /configuration sensitive_apis\.json sha256=/,
);
fs.writeFileSync(path.join(configDirectory, 'sensitive_apis.json'), '{}\n');

manifest.status = 'running';
fs.writeFileSync(
  path.join(runDirectory, 'run_manifest.json'),
  `${JSON.stringify(manifest, null, 2)}\n`,
);
assert.throws(
  () => validateSingleRun(
    { reports: runDirectory, configDir: configDirectory },
    2,
    [{ projectName: 'A' }, { projectName: 'B' }],
  ),
  /status=running/,
);
fs.rmSync(runDirectory, { recursive: true, force: true });

console.log('Corpus summary statistics verified.');

function readJsonForTest(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}
