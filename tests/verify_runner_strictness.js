const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  parseArgs,
  summarizeReport
} = require('../scripts/run_argus_batch_isolated');

const args = parseArgs([
  '--dataset', 'dataset',
  '--output-dir', 'out',
  '--sdkPath', 'sdk',
  '--include-project', 'selected',
  '--exclude-project', 'first',
  '--exclude-project', 'second'
]);
assert.deepStrictEqual(args.includeProjects, ['selected']);
assert.deepStrictEqual(args.excludeProjects, ['first', 'second']);

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'arkprism-runner-'));
const reportPath = path.join(tempDir, 'report.json');
const baseReport = {
  privacyApiUsages: [],
  callChains: [],
  permissionUsages: [],
  statistics: {}
};

try {
  fs.writeFileSync(reportPath, JSON.stringify({
    ...baseReport,
    taintAnalysis: {
      status: 'PARTIAL_SUCCESS',
      pointerAnalysis: { requested: true, status: 'SUCCESS' }
    }
  }));
  assert.throws(
    () => summarizeReport('partial', reportPath, 1, { requireCompleteTaint: true }),
    /TAINT_PARTIAL_SUCCESS/
  );

  fs.writeFileSync(reportPath, JSON.stringify({
    ...baseReport,
    taintFlows: [{ sourceKind: 'privacy_data', provenance: 'ifds', path: [] }],
    taintAnalysis: {
      status: 'SUCCESS',
      pointerAnalysis: { requested: true, status: 'SUCCESS' }
    }
  }));
  assert.throws(
    () => summarizeReport('invalid-source', reportPath, 1, { requireCompleteTaint: true }),
    /SOURCE_IDENTITY_INVALID/
  );

  fs.writeFileSync(reportPath, JSON.stringify({
    ...baseReport,
    taintFlows: [{
      sourceKind: 'framework_input',
      provenance: 'ifds',
      sourceApi: 'ability.onCreate(want)',
      sourceIdentity: {
        apiName: 'onCreate',
        sourceType: 'ArgIn',
        methodSignature: '<UIAbility.onCreate>'
      },
      path: [{ statement: 'ability.onCreate(want)' }]
    }],
    taintAnalysis: {
      status: 'SUCCESS',
      pointerAnalysis: { requested: true, status: 'SUCCESS' }
    }
  }));
  const summary = summarizeReport('complete', reportPath, 1, { requireCompleteTaint: true });
  assert.strictEqual(summary.projectName, 'complete');
  assert.ok(!Object.hasOwn(summary, 'requireCompleteTaint'));
} finally {
  fs.rmSync(tempDir, { recursive: true, force: true });
}

console.log('Isolated runner exclusion and strict taint validation verified.');
