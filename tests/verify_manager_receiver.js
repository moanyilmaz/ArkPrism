const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const repoRoot = path.resolve(__dirname, '..');
const sdkPath = process.env.OPENHARMONY_SDK_PATH;
if (!sdkPath || !fs.existsSync(sdkPath)) {
  throw new Error('OPENHARMONY_SDK_PATH must point to a real OpenHarmony ets SDK');
}

const cases = [
  {
    fixture: 'manager_receiver',
    expected: [
      'AVMetadataExtractor.fetchAlbumCover|receiver_type',
      'AVMetadataExtractor.fetchMetadata|receiver_type',
    ],
  },
  {
    fixture: 'generic_manager_receiver',
    expected: [
      "UserAuthInstance.on('result')|receiver_type",
      'UserAuthInstance.start|receiver_type',
    ],
  },
  {
    fixture: 'factory_chain_receiver',
    expected: [],
  },
  {
    fixture: 'helper_factory_chain_receiver',
    expected: [],
  },
  {
    fixture: 'factory_inferred_receiver',
    expected: [
      'AVImageGenerator.fetchFrameByTime|receiver_origin',
      'AVMetadataExtractor.fetchAlbumCover|receiver_origin',
      'AVMetadataExtractor.fetchMetadata|receiver_origin',
    ],
  },
  {
    fixture: 'receiver_collision',
    expected: [],
  },
  {
    fixture: 'sdk_receiver_origins',
    expected: [],
  },
  {
    fixture: 'api_identity_resolution',
    expected: [
      'UserAuthInstance.on(\'result\')|receiver_type',
      'deviceInfo.serial|undefined',
      'identifier.getOAID|undefined',
    ],
    expectedSourceLocations: [
      { method: 'serial', fragment: '.serial' },
    ],
  },
];

const outputRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'arkprism-manager-receiver-'));
try {
  for (const testCase of cases) {
    const fixture = path.join(repoRoot, 'tests', 'fixtures', testCase.fixture);
    const child = spawnSync(process.execPath, [
      'dist/arkprism.js',
      fixture,
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
    });
    if (child.status !== 0) {
      process.stderr.write(child.stdout || '');
      process.stderr.write(child.stderr || '');
      throw new Error(`ArkPrism exited with status ${child.status}`);
    }

    const reportPath = path.join(
      outputRoot,
      testCase.fixture,
      `${testCase.fixture}-arkprism-report.json`,
    );
    const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
    if (!report.sdk || !report.sdk.apiVersion || !report.sdk.version) {
      throw new Error(`${testCase.fixture}: report is missing SDK provenance`);
    }
    for (const usage of report.privacyApiUsages || []) {
      if (!usage.dataType || !usage.label || !usage.catalogApiSignature) {
        throw new Error(
          `${testCase.fixture}: ${usage.namespace}.${usage.method} is missing PAC catalog metadata`,
        );
      }
    }
    const actual = (report.privacyApiUsages || [])
      .map(usage => `${usage.namespace}.${usage.method}|${usage.matchEvidence}`)
      .sort();
    if (JSON.stringify(actual) !== JSON.stringify(testCase.expected)) {
      throw new Error(
        `${testCase.fixture}: unexpected detections:\n${actual.join('\n')}`,
      );
    }
    for (const expectedLocation of testCase.expectedSourceLocations || []) {
      const usage = (report.privacyApiUsages || []).find(item =>
        item.method === expectedLocation.method,
      );
      const sourceFile = path.join(fixture, usage.file);
      const expectedLine = fs.readFileSync(sourceFile, 'utf8')
        .split(/\r?\n/)
        .findIndex(line => line.includes(expectedLocation.fragment)) + 1;
      if (usage.line !== expectedLine || usage.locationEvidence !== 'source_ast') {
        throw new Error(
          `${testCase.fixture}: ${expectedLocation.method} location ` +
          `${usage.line}/${usage.locationEvidence}, expected ${expectedLine}/source_ast`,
        );
      }
    }
    console.log(`${testCase.fixture}: ${actual.length} expected detections`);
  }
} finally {
  fs.rmSync(outputRoot, { recursive: true, force: true });
}
