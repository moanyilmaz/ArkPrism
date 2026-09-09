'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const repoRoot = path.resolve(__dirname, '..');
const sdkPath = process.env.OPENHARMONY_SDK_PATH;
if (!sdkPath || !fs.existsSync(sdkPath)) {
  throw new Error('OPENHARMONY_SDK_PATH must point to a real OpenHarmony ets SDK');
}

const projectName = 'health_store_overloads';
const projectRoot = path.join(repoRoot, 'tests', 'fixtures', projectName);
const sourceRoot = path.join(projectRoot, 'entry', 'src', 'main', 'ets');
const outputRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'arkprism-health-store-'));
const expected = [
  ['HmsHealthStore.ets', '  healthStore.readData(request);', '@hms.health.store'],
  ['HmsHealthStore.ets', '  const result = healthStore.readData(request);', '@hms.health.store'],
  ['HmsHealthStore.ets', '  healthStore.readData(request, (data) => console.info(String(data)));', '@hms.health.store'],
  ['KitHealthStore.ets', '  health.readData(request);', '@kit.HealthServiceKit'],
].map(([file, source, apiPackage]) => {
  const lines = fs.readFileSync(path.join(sourceRoot, file), 'utf8').split(/\r?\n/);
  const line = lines.indexOf(source) + 1;
  assert.ok(line > 0, `Missing expected source: ${file}: ${source}`);
  return [file, line, apiPackage, 'healthStore.readData'].join('|');
}).sort();

try {
  const child = spawnSync(process.execPath, [
    'dist/arkprism.js', projectRoot,
    '--output-dir', outputRoot,
    '--sdkPath', sdkPath,
    '--no-taint', '--no-dot',
  ], {
    cwd: repoRoot,
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
    maxBuffer: 16 * 1024 * 1024,
  });
  if (child.error) throw child.error;
  if (child.status !== 0) {
    process.stderr.write(child.stdout || '');
    process.stderr.write(child.stderr || '');
    throw new Error(`ArkPrism exited with status ${child.status}`);
  }
  const report = JSON.parse(fs.readFileSync(path.join(
    outputRoot, projectName, `${projectName}-arkprism-report.json`,
  ), 'utf8'));
  const usages = report.privacyApiUsages || [];
  const actual = usages.map(usage => [
    path.basename(usage.file), usage.line, usage.apiPackage, usage.catalogApiSignature,
  ].join('|')).sort();
  assert.deepStrictEqual(actual, expected,
    'Detect only the four package-qualified calls with supported arities');
  for (const usage of usages) {
    assert.strictEqual(usage.dataType, 'Fitness and health information');
    assert.strictEqual(usage.label, 'Fitness information');
    assert.strictEqual(usage.locationEvidence, 'source_ast');
    if (usage.apiPackage === '@hms.health.store') {
      assert.ok(usage.description.includes(usage.args.length === 1 ? 'Promise' : 'callback'),
        'Report description must correspond to the uniquely matched overload');
    }
  }
  assert.ok(report.sdk?.apiVersion && report.sdk?.version, 'Missing SDK provenance');
  console.log('HealthStore overloads verified: four calls, no unrelated or invalid-arity detections.');
} finally {
  fs.rmSync(outputRoot, { recursive: true, force: true });
}
