'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { packageSources } = require('../scripts/package_top120_sources');
const { verifySources } = require('../scripts/verify_top120_source_package');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'arkprism-top120-source-'));
const dataset = path.join(root, 'dataset');
const output = path.join(root, 'output');
fs.mkdirSync(dataset);
const projects = [];
const annotations = [];
for (let index = 0; index < 120; index += 1) {
  const projectName = `project-${index}`;
  projects.push({ projectName });
  const sourceDir = path.join(dataset, projectName, 'entry', 'src', 'main', 'ets');
  fs.mkdirSync(sourceDir, { recursive: true });
  fs.writeFileSync(path.join(sourceDir, 'Index.ets'), `export const value = ${index};\n`);
  fs.writeFileSync(path.join(dataset, projectName, 'module.json5'), '{}\n');
  fs.writeFileSync(path.join(dataset, projectName, 'asset.bin'), Buffer.from([0, 1, 2, 3]));
  const dependencyDir = path.join(dataset, projectName, 'node_modules', 'ignored');
  fs.mkdirSync(dependencyDir, { recursive: true });
  fs.writeFileSync(path.join(dependencyDir, 'ignored.ts'), 'ignored\n');
  annotations.push({
    annotationId: `K${index}`,
    projectName,
    sourceEvidence: [{ file: 'entry/src/main/ets/Index.ets' }],
  });
}
const benchmarkPath = path.join(root, 'annotations.json');
fs.writeFileSync(benchmarkPath, `${JSON.stringify({ projects, annotations })}\n`);
const manifest = packageSources({ benchmarkPath, datasetRoot: dataset, outputRoot: output });
assert.strictEqual(manifest.totals.projects, 120);
assert.strictEqual(manifest.totals.files, 360);
assert(fs.existsSync(path.join(output, 'project-0', 'entry', 'src', 'main', 'ets', 'Index.ets')));
assert(fs.existsSync(path.join(output, 'project-0', 'asset.bin')));
assert(!fs.existsSync(path.join(output, 'project-0', 'node_modules')));
assert(fs.existsSync(path.join(output, 'source_manifest.json')));
const verification = verifySources(output);
assert.strictEqual(verification.passed, true);
assert.strictEqual(verification.checks.verifiedProjects, 120);
fs.writeFileSync(path.join(output, 'project-0', 'asset.bin'), Buffer.from([4, 5, 6]));
const changedVerification = verifySources(output);
assert.strictEqual(changedVerification.passed, false);
assert(changedVerification.failures.some(failure => failure.startsWith('project-0: fingerprint')));
fs.rmSync(root, { recursive: true, force: true });
console.log('Top-120 source packager verified.');
