const assert = require('assert');
const childProcess = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = path.resolve(__dirname, '..');
const { sourceScope } = require(path.join(root, 'scripts', 'evaluate_semantic_path_audit.js'));
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'arkprism-path-audit-'));

assert.strictEqual(sourceScope({ sourceFile: 'entry/src/main/ets/Page.ets' }), 'production');
assert.strictEqual(sourceScope({ sourceFile: 'entry/src/ohosTest/ets/Test.ets' }), 'test');
assert.strictEqual(sourceScope({ sourceFile: 'entry/build/default/cache/Page.ts' }), 'generated');

try {
  const queuePath = path.join(temporary, 'queue.json');
  const decisionsPath = path.join(temporary, 'decisions.json');
  const output = path.join(temporary, 'result');
  const dataset = path.join(temporary, 'dataset');
  const reports = path.join(temporary, 'reports');
  fs.mkdirSync(dataset);
  fs.mkdirSync(reports);
  const runManifestPath = path.join(reports, 'run_manifest.json');
  fs.writeFileSync(runManifestPath, '{"status":"complete"}\n');
  const records = [];
  for (const [id, project, sourceKind, provenance, sinkFamily, pathLengthBin] of [
    ['a', 'P1', 'privacy_data', 'ifds', 'logging', 'short_1_3'],
    ['b', 'P2', 'framework_input', 'ifds', 'ui', 'medium_4_7'],
  ]) {
    const projectRoot = path.join(dataset, project);
    fs.mkdirSync(projectRoot);
    const sourceFile = path.join(projectRoot, 'source.ets');
    const sinkFile = path.join(projectRoot, 'sink.ets');
    const reportFile = path.join(reports, `${project}-arkprism-report.json`);
    fs.writeFileSync(sourceFile, 'source();\n');
    fs.writeFileSync(sinkFile, 'sink(value);\n');
    fs.writeFileSync(reportFile, `${JSON.stringify({ project })}\n`);
    records.push({
      id,
      project,
      sourceKind,
      provenance,
      sinkFamily,
      pathLengthBin,
      sourceFile: 'source.ets',
      sourceFileSha256: crypto.createHash('sha256').update(fs.readFileSync(sourceFile)).digest('hex'),
      sourceLine: 1,
      sinkFile: 'sink.ets',
      sinkFileSha256: crypto.createHash('sha256').update(fs.readFileSync(sinkFile)).digest('hex'),
      sinkLine: 1,
      report: path.basename(reportFile),
      reportSha256: crypto.createHash('sha256').update(fs.readFileSync(reportFile)).digest('hex'),
    });
  }
  const queue = {
    schemaVersion: 2,
    datasetDirectory: dataset,
    reportsDirectory: reports,
    runManifestSha256: crypto.createHash('sha256')
      .update(fs.readFileSync(runManifestPath)).digest('hex'),
    sample: { paths: 2 },
    records,
  };
  const queueBytes = Buffer.from(`${JSON.stringify(queue, null, 2)}\n`);
  fs.writeFileSync(queuePath, queueBytes);
  const common = {
    sinkIdentityCorrect: true,
    explicitDataDependence: true,
    reachabilityConsistent: true,
    provenanceCorrect: true,
  };
  fs.writeFileSync(decisionsPath, JSON.stringify({
    schemaVersion: 1,
    role: 'manual-semantic-path-decisions',
    reviewQueueSha256: crypto.createHash('sha256').update(queueBytes).digest('hex'),
    decisions: [
      { id: 'a', sourceIdentityCorrect: true, ...common, fullPathCorrect: true, evidence: 'Source value reaches the logged argument.' },
      { id: 'b', sourceIdentityCorrect: false, ...common, fullPathCorrect: false, evidence: 'The reported source owner is incompatible.' },
    ],
  }, null, 2));

  childProcess.execFileSync(process.execPath, [
    path.join(root, 'scripts', 'evaluate_semantic_path_audit.js'),
    '--queue', queuePath,
    '--decisions', decisionsPath,
    '--output', output,
  ], { cwd: root, stdio: 'pipe' });
  const result = JSON.parse(fs.readFileSync(path.join(output, 'semantic_path_audit.json')));
  assert.strictEqual(result.metrics.sourceIdentityCorrect.successes, 1);
  assert.strictEqual(result.metrics.fullPathCorrect.successes, 1);
  assert.strictEqual(result.fullPathBreakdown.sourceKind.privacy_data.successes, 1);
  assert.strictEqual(result.fullPathBreakdown.sourceKind.framework_input.successes, 0);
  assert.strictEqual(result.rejected.length, 1);
  assert.deepStrictEqual(result.artifactVerification, {
    filesVerified: 4,
    reportsVerified: 2,
    runManifestVerified: true,
  });

  fs.writeFileSync(path.join(dataset, 'P1', 'source.ets'), 'changed();\n');
  const drifted = childProcess.spawnSync(process.execPath, [
    path.join(root, 'scripts', 'evaluate_semantic_path_audit.js'),
    '--queue', queuePath,
    '--decisions', decisionsPath,
    '--output', path.join(temporary, 'drifted'),
  ], { cwd: root, encoding: 'utf8' });
  assert.notStrictEqual(drifted.status, 0);
  assert.match(drifted.stderr, /source file hash mismatch/);
  console.log('Semantic path audit evaluator verified.');
} finally {
  fs.rmSync(temporary, { recursive: true, force: true });
}
