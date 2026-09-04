'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { normalizeSensitiveApiCatalog } = require('../dist/sensitiveApiCatalog');

const repoRoot = path.resolve(__dirname, '..');
const sdkPath = process.env.OPENHARMONY_SDK_PATH;
if (!sdkPath || !fs.existsSync(sdkPath)) {
  throw new Error('OPENHARMONY_SDK_PATH must point to a real OpenHarmony ets SDK');
}

const sensorRules = normalizeSensitiveApiCatalog(require('../config/sensitive_apis.json'))
  .flatMap(group => group.systemPackage === '@kit.SensorServiceKit' ? group.privacyApis : [])
  .filter(api => api.method.startsWith("on('SensorId."));
const expectedDynamicMethods = new Set(sensorRules.map(api => api.method));
assert.strictEqual(expectedDynamicMethods.size, 17);

const source = [
  "import { sensor } from '@kit.SensorServiceKit';",
  '',
  'export class SensorCases {',
  '  staticEnum(): void {',
  '    sensor.on(sensor.SensorId.ACCELEROMETER, (_data: sensor.AccelerometerResponse) => {});',
  '  }',
  '  numericConstant(): void {',
  '    sensor.on(5, (_data: sensor.LightResponse) => {});',
  '  }',
  '  dynamicEvent(id: sensor.SensorId): void {',
  '    sensor.on(id, (_data: sensor.Response) => {});',
  '  }',
  '  unsupportedEvent(): void {',
  "    sensor.on('sensorStatusChange', (_data: sensor.Sensor) => {});",
  '  }',
  '}',
  '',
].join('\n');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'arkprism-sensor-events-'));
const projectName = 'sensor-events';
const projectRoot = path.join(root, projectName);
const sourceRoot = path.join(projectRoot, 'entry', 'src', 'main', 'ets');
const outputRoot = path.join(root, 'output');

try {
  fs.mkdirSync(sourceRoot, { recursive: true });
  fs.writeFileSync(path.join(sourceRoot, 'SensorCases.ets'), source, 'utf8');
  const child = spawnSync(process.execPath, [
    'dist/arkprism.js',
    projectRoot,
    '--output-dir',
    outputRoot,
    '--sdkPath',
    sdkPath,
    '--no-taint',
    '--no-dot',
  ], {
    cwd: repoRoot,
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
    maxBuffer: 16 * 1024 * 1024,
  });
  if (child.status !== 0) {
    process.stderr.write(child.stdout || '');
    process.stderr.write(child.stderr || '');
    throw new Error(`ArkPrism exited with status ${child.status}`);
  }

  const report = JSON.parse(fs.readFileSync(path.join(
    outputRoot,
    projectName,
    `${projectName}-arkprism-report.json`,
  ), 'utf8'));
  const methodsAtLine = line => new Set(report.privacyApiUsages
    .filter(usage => usage.line === line)
    .map(usage => usage.method));

  assert.deepStrictEqual(
    methodsAtLine(5),
    new Set(["on('SensorId.ACCELEROMETER')"]),
  );
  assert.deepStrictEqual(
    methodsAtLine(8),
    new Set(["on('SensorId.AMBIENT_LIGHT')"]),
  );
  assert.deepStrictEqual(methodsAtLine(11), expectedDynamicMethods);
  assert.deepStrictEqual(methodsAtLine(14), new Set());
  console.log('Sensor event resolution verified: enum, numeric, dynamic, and rejected events.');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
