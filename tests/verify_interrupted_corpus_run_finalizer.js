const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  finalizeInterruptedRun,
} = require('../scripts/finalize_interrupted_corpus_run');

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function createManifest({
  dataset,
  repository,
  outputDir,
  includedProjects,
  projectCount,
  status,
  progress,
}) {
  return {
    status,
    inputs: {
      dataset,
      datasetProjectCount: 3,
      projectCount,
      includedProjects,
      excludedProjects: [],
      sdk: { root: 'sdk', sha256: 'sdk-hash' },
      configHashes: { 'sensitive_apis.json': 'config-hash' },
      implementation: {
        runnerPath: path.join(repository, 'scripts', 'run.js'),
        runnerSha256: 'runner-hash',
        source: { path: 'src', sha256: 'source-hash', files: 1, bytes: 1 },
        packageJsonSha256: 'package-hash',
        packageLockSha256: 'lock-hash',
        tsconfigSha256: 'tsconfig-hash',
      },
      build: {
        path: 'dist',
        sha256: 'build-hash',
        entrySha256: 'entry-hash',
        files: 1,
        bytes: 1,
      },
    },
    environment: {
      analysisFeatureFlags: {
        disableIrRecovery: false,
        disableReceiverRefinement: false,
        disableLifecycleBounds: false,
      },
    },
    execution: {
      outputDir,
      engine: 'compiled',
      concurrency: 1,
      timeoutMs: 1000,
      nodeOptions: '--max-old-space-size=1024',
      resume: false,
      arkArgs: ['--ifds-max-edges', '100'],
      maxAttempts: 2,
      retryDelayMs: 10,
    },
    progress,
  };
}

function createFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'arkprism-recovery-'));
  const dataset = path.join(root, 'dataset');
  const repository = path.join(root, 'repo');
  const primary = path.join(root, 'primary');
  const tail = path.join(root, 'tail');
  for (const project of ['A', 'B', 'C']) {
    fs.mkdirSync(path.join(dataset, project), { recursive: true });
  }
  fs.mkdirSync(path.join(repository, 'scripts'), { recursive: true });
  writeJson(path.join(repository, 'package.json'), {
    name: 'fixture',
    version: '1.0.0',
    license: 'MIT',
    scripts: { test: 'node test.js' },
    dependencies: { x: '1.0.0' },
  });
  writeJson(path.join(repository, 'package-lock.json'), {
    packages: {
      '': {
        name: 'fixture',
        version: '1.0.0',
        license: 'MIT',
        dependencies: { x: '1.0.0' },
      },
    },
  });

  for (const project of ['A', 'B']) {
    writeJson(
      path.join(primary, project, `${project}-arkprism-report.json`),
      { projectName: project },
    );
  }
  writeJson(
    path.join(tail, 'C', 'C-arkprism-report.json'),
    { projectName: 'C' },
  );
  fs.mkdirSync(path.join(tail, 'logs'), { recursive: true });
  fs.writeFileSync(path.join(tail, 'logs', '0001-C.log'), 'complete\n');

  const primaryManifest = createManifest({
    dataset,
    repository,
    outputDir: primary,
    includedProjects: [],
    projectCount: 3,
    status: 'running',
    progress: { finished: 2, completed: 2, errors: 0 },
  });
  const tailManifest = createManifest({
    dataset,
    repository,
    outputDir: tail,
    includedProjects: ['C'],
    projectCount: 1,
    status: 'complete',
    progress: { finished: 1, completed: 1, errors: 0 },
  });
  writeJson(path.join(primary, 'run_manifest.json'), primaryManifest);
  writeJson(path.join(primary, 'batch_summary.json'), [
    { projectName: 'A' },
    { projectName: 'B' },
  ]);
  writeJson(path.join(tail, 'run_manifest.json'), tailManifest);
  writeJson(path.join(tail, 'batch_summary.json'), [{
    projectName: 'C',
    logPath: path.join(tail, 'logs', '0001-C.log'),
  }]);
  return {
    root,
    primary,
    tail,
  };
}

const fixture = createFixture();
try {
  const recovery = finalizeInterruptedRun(fixture.primary, fixture.tail);
  assert.strictEqual(recovery.status, 'complete');
  assert.deepStrictEqual(
    recovery.recoveredProjects.map(item => item.projectName),
    ['C'],
  );
  const manifest = JSON.parse(
    fs.readFileSync(path.join(fixture.primary, 'run_manifest.json'), 'utf8'),
  );
  assert.strictEqual(manifest.status, 'complete');
  assert.deepStrictEqual(
    manifest.progress,
    { finished: 3, completed: 3, errors: 0 },
  );
  assert.strictEqual(manifest.execution.resume, false);
  assert.strictEqual(manifest.execution.interruptionRecovery, true);
  assert(fs.existsSync(path.join(
    fixture.primary,
    'C',
    'C-arkprism-report.json',
  )));
  const batch = JSON.parse(
    fs.readFileSync(path.join(fixture.primary, 'batch_summary.json'), 'utf8'),
  );
  assert.deepStrictEqual(batch.map(item => item.projectName), ['A', 'B', 'C']);
  assert.strictEqual(batch[2].recoveredFromInterruption, true);
  assert.strictEqual(
    finalizeInterruptedRun(fixture.primary, fixture.tail).status,
    'complete',
  );
} finally {
  fs.rmSync(fixture.root, { recursive: true, force: true });
}

const mismatchFixture = createFixture();
try {
  const tailManifestPath = path.join(mismatchFixture.tail, 'run_manifest.json');
  const tailManifest = JSON.parse(fs.readFileSync(tailManifestPath, 'utf8'));
  tailManifest.inputs.build.sha256 = 'different-build';
  writeJson(tailManifestPath, tailManifest);
  assert.throws(
    () => finalizeInterruptedRun(mismatchFixture.primary, mismatchFixture.tail),
    /compiled build mismatch/,
  );
} finally {
  fs.rmSync(mismatchFixture.root, { recursive: true, force: true });
}

console.log('Interrupted corpus-run finalizer verified.');
