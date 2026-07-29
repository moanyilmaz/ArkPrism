const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  compareRuns,
  flowEndpointKey,
  normalizeProjectPath,
} = require('../scripts/compare_corpus_runs');

assert.strictEqual(
  normalizeProjectPath('Sample', 'E:\\dataset\\Sample\\entry\\Main.ets'),
  'entry/main.ets',
);

const sampleFlow = {
  provenance: 'async_supplement',
  sourceKind: 'privacy_data',
  sourceIdentity: {
    module: '@ohos.identifier.oaid',
    apiName: 'getOAID',
    methodSignature: 'identifier.getOAID()',
  },
  sourceApi: 'getOAID()',
  sourceFile: 'E:\\dataset\\Sample\\entry\\Main.ets',
  sourceLine: 2,
  sinkApi: 'console.info(value)',
  sinkFile: 'E:\\dataset\\Sample\\entry\\Main.ets',
  sinkLine: 4,
  path: [{
    statement: 'getOAID()',
    file: 'E:\\dataset\\Sample\\entry\\Main.ets',
    line: 2,
    method: 'run',
  }, {
    statement: 'console.info(value)',
    file: 'E:\\dataset\\Sample\\entry\\Main.ets',
    line: 4,
    method: 'run',
  }],
};
assert.strictEqual(
  flowEndpointKey('Sample', sampleFlow),
  flowEndpointKey('Sample', {
    ...sampleFlow,
    sourceFile: 'C:\\other\\Sample\\entry\\Main.ets',
    sinkFile: 'C:\\other\\Sample\\entry\\Main.ets',
  }),
);

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'arkprism-run-compare-'));
const baseline = path.join(root, 'baseline');
const candidate = path.join(root, 'candidate');
for (const directory of [baseline, candidate]) {
  fs.mkdirSync(path.join(directory, 'Sample'), { recursive: true });
  fs.writeFileSync(
    path.join(directory, 'run_manifest.json'),
    `${JSON.stringify({
      status: 'complete',
      completedAt: '2026-07-29T00:00:00.000Z',
      environment: { git: { revision: 'revision', trackedFilesDirty: false } },
      inputs: {
        projectCount: 1,
        sdk: { sha256: 'sdk' },
        build: { sha256: 'build' },
      },
    }, null, 2)}\n`,
  );
  fs.writeFileSync(
    path.join(directory, 'batch_summary.json'),
    `${JSON.stringify([{ projectName: 'Sample', durationMs: 1000 }], null, 2)}\n`,
  );
}
fs.writeFileSync(
  path.join(baseline, 'Sample', 'Sample-arkprism-report.json'),
  `${JSON.stringify({
    projectName: 'Sample',
    taintAnalysis: { ifds: { edgesProcessed: 10 } },
    taintFlows: [sampleFlow],
  }, null, 2)}\n`,
);
fs.writeFileSync(
  path.join(candidate, 'Sample', 'Sample-arkprism-report.json'),
  `${JSON.stringify({
    projectName: 'Sample',
    taintAnalysis: { ifds: { edgesProcessed: 12 } },
    taintFlows: [{
      ...sampleFlow,
      provenance: 'ifds',
      analysisDerivations: ['promise_then'],
      carrierState: 'callback_payload',
    }],
  }, null, 2)}\n`,
);

const comparison = compareRuns(baseline, candidate);
assert.strictEqual(comparison.overlap.endpointSetPreserved, true);
assert.strictEqual(comparison.overlap.exactPathSetPreserved, true);
assert.deepStrictEqual(
  comparison.transitions.provenance,
  { 'async_supplement -> ifds': 1 },
);
assert.deepStrictEqual(
  comparison.candidate.derivations,
  { promise_then: 1 },
);

fs.rmSync(root, { recursive: true, force: true });
console.log('Corpus run comparison verified.');
