'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const {
  resolveAnalysisPath,
  stripWindowsExtendedPathPrefix,
  toDisplayPath,
  toFileSystemPath,
} = require('../dist/pathUtils');

const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'arkprism-long-path-'));
const projectRoot = path.join(temporaryRoot, 'LongPathProject');

function buildDeepDirectory(root, minimumFileLength, fileName) {
  let current = root;
  let index = 0;
  while (path.join(current, fileName).length < minimumFileLength) {
    current = path.join(current, `nested_source_segment_${String(index).padStart(3, '0')}`);
    index += 1;
  }
  return current;
}

try {
  const sourceDirectory = buildDeepDirectory(projectRoot, 1100, 'LongPathCase.ets');
  const sourcePath = path.join(sourceDirectory, 'LongPathCase.ets');
  const outputRoot = buildDeepDirectory(
    path.join(temporaryRoot, 'output'),
    1050,
    'LongPathProject-arkprism-report.json'
  );

  fs.mkdirSync(toFileSystemPath(sourceDirectory), { recursive: true });
  fs.writeFileSync(
    toFileSystemPath(sourcePath),
    [
      'export class LongPathCase {',
      '  read(): string {',
      "    return 'ok';",
      '  }',
      '}',
      '',
    ].join('\n'),
    'utf8'
  );

  assert.ok(sourcePath.length >= 1100, `fixture path is too short: ${sourcePath.length}`);
  assert.strictEqual(fs.readFileSync(toFileSystemPath(sourcePath), 'utf8').includes('LongPathCase'), true);

  const resolved = resolveAnalysisPath(projectRoot);
  assert.strictEqual(resolved.displayPath, path.resolve(projectRoot));
  assert.strictEqual(toDisplayPath(resolved.fileSystemPath), path.resolve(projectRoot));
  assert.strictEqual(
    stripWindowsExtendedPathPrefix(resolved.fileSystemPath),
    path.resolve(projectRoot)
  );
  if (process.platform === 'win32') {
    assert.ok(resolved.fileSystemPath.startsWith('\\\\?\\'));
  }

  const result = spawnSync(process.execPath, [
    path.join('dist', 'arkprism.js'),
    projectRoot,
    '--no-taint',
    '--no-dot',
    '--output-dir', outputRoot,
  ], {
    cwd: path.resolve('.'),
    encoding: 'utf8',
    env: process.env,
  });

  assert.strictEqual(
    result.status,
    0,
    `long-path analysis failed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`
  );

  const reportPath = path.join(
    outputRoot,
    'LongPathProject',
    'LongPathProject-arkprism-report.json'
  );
  assert.ok(reportPath.length >= 1050, `report path is too short: ${reportPath.length}`);
  assert.ok(fs.existsSync(toFileSystemPath(reportPath)), 'long-path report was not created');

  const report = JSON.parse(fs.readFileSync(toFileSystemPath(reportPath), 'utf8'));
  assert.strictEqual(report.projectDirectory, path.resolve(projectRoot));
  assert.ok(!report.projectDirectory.startsWith('\\\\?\\'));
  assert.strictEqual(report.statistics.totalFilesAnalyzed, 1);
  console.log(`Verified path lengths: source=${sourcePath.length}, report=${reportPath.length}.`);
} finally {
  fs.rmSync(toFileSystemPath(temporaryRoot), { recursive: true, force: true });
}

console.log('Extended-length source discovery, parsing, and report output verified.');
