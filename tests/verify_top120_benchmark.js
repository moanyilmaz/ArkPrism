'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { evaluate } = require('../scripts/evaluate_top120_benchmark');
const { buildRunnerArgs } = require('../scripts/run_top120_benchmark');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'arkprism-top120-'));
const reportsRoot = path.join(root, 'reports');
fs.mkdirSync(reportsRoot);

const projects = Array.from({ length: 120 }, (_, index) => ({
  sampleId: `T120-S${String(index + 1).padStart(3, '0')}`,
  projectName: `project-${index + 1}`,
}));
const annotations = [];
for (let projectIndex = 0; projectIndex < projects.length; projectIndex += 1) {
  const keyCount = projectIndex < 66 ? 6 : 5;
  const project = projects[projectIndex];
  const usages = [];
  for (let keyIndex = 0; keyIndex < keyCount; keyIndex += 1) {
    const member = `method${keyIndex}`;
    annotations.push({
      annotationId: `K${annotations.length + 1}`,
      sampleId: project.sampleId,
      projectName: project.projectName,
      api: {
        key: `test|${member}`,
        package: '@ohos.test',
        namespace: 'test',
        member,
      },
      sourceEvidence: [{ file: 'Index.ets', line: keyIndex + 1, column: 1 }],
      reviewDecision: { evidenceKinds: ['namespace.method'] },
    });
    usages.push({
      apiPackage: '@ohos.test',
      namespace: 'test',
      method: member,
      file: 'Index.ets',
      line: keyIndex + 1,
      column: 1,
    });
  }
  const projectDir = path.join(reportsRoot, project.projectName);
  fs.mkdirSync(projectDir);
  fs.writeFileSync(
    path.join(projectDir, `${project.projectName}-arkprism-report.json`),
    `${JSON.stringify({ projectName: project.projectName, privacyApiUsages: usages })}\n`,
  );
}
assert.strictEqual(annotations.length, 666);

const benchmarkPath = path.join(root, 'annotations.json');
const rulesPath = path.join(root, 'rules.json');
fs.writeFileSync(benchmarkPath, `${JSON.stringify({
  benchmark: {
    name: 'fixture',
    version: '1',
    annotationUnit: 'reported_project_api_key',
    scope: 'output_selected_precision_audit',
  },
  projects,
  annotations,
})}\n`);
fs.writeFileSync(rulesPath, `${JSON.stringify([{
  systemPackage: '@ohos.test',
  privacyApis: Array.from({ length: 7 }, (_, index) => ({
    namespace: 'test',
    method: `method${index}`,
  })),
}])}\n`);
fs.writeFileSync(path.join(reportsRoot, 'run_manifest.json'), `${JSON.stringify({
  status: 'complete',
  completedAt: '2026-07-27T00:00:00.000Z',
  inputs: {
    projectCount: 120,
    includedProjects: projects.map(project => project.projectName),
    build: {},
    implementation: {},
    sdk: {},
    configHashes: {},
  },
  execution: { arkArgs: ['--no-taint'] },
  progress: { completed: 120, errors: 0 },
})}\n`);

const complete = evaluate({ benchmarkPath, reportsRoot, rulesPath });
assert.strictEqual(complete.metrics.recoveredConfirmedKeys, 666);
assert.strictEqual(complete.metrics.missingConfirmedKeys, 0);
assert.strictEqual(complete.metrics.unreviewedOutputKeys, 0);
assert.strictEqual(complete.metrics.reviewedOutputPrecision, 1);
assert.strictEqual(complete.metrics.projectsWithCompleteGoldRecovery, 120);

const firstReportPath = path.join(reportsRoot, 'project-1', 'project-1-arkprism-report.json');
const firstReport = JSON.parse(fs.readFileSync(firstReportPath, 'utf8'));
firstReport.privacyApiUsages.push({
  apiPackage: '@ohos.test',
  namespace: 'test',
  method: 'method6',
  file: 'Index.ets',
  line: 99,
  column: 1,
});
fs.writeFileSync(firstReportPath, `${JSON.stringify(firstReport)}\n`);
const withUnreviewed = evaluate({ benchmarkPath, reportsRoot, rulesPath });
assert.strictEqual(withUnreviewed.metrics.unreviewedOutputKeys, 1);
assert.strictEqual(withUnreviewed.metrics.reviewedOutputPrecisionDefined, false);
assert.strictEqual(withUnreviewed.metrics.reviewedOutputPrecision, null);

const runnerArgs = buildRunnerArgs({
  dataset: 'dataset',
  outputDir: 'output',
  sdkPath: 'sdk',
  concurrency: 2,
  timeoutMs: 1000,
  nodeOptions: '--max-old-space-size=8192',
  noDot: false,
}, projects.map(project => project.projectName));
assert(runnerArgs.includes('--no-taint'));
assert.strictEqual(runnerArgs.filter(token => token === '--include-project').length, 120);

fs.rmSync(root, { recursive: true, force: true });
console.log('Top-120 benchmark evaluator and runner verified.');
