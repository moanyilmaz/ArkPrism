const assert = require('assert');

const { auditReport } = require('../scripts/audit_evidence_universes');

const result = auditReport({
  projectName: 'fixture',
  privacyApiUsages: [{ method: 'source', file: 'a.ets', line: 1 }],
  callChains: [{ dataSinks: [{ sinkType: 'log' }] }],
  taintFlows: [{
    provenance: 'ifds',
    sourceKind: 'framework_input',
    sourceIdentity: { apiName: 'onCreate' },
    sourceApi: 'invoke onCreate(want)',
    sourceFile: 'b.ets',
    sourceLine: -1,
    sinkApi: 'invoke hilog.info(want)',
    sinkFile: 'b.ets',
    sinkLine: 2,
    path: [
      { statement: 'invoke onCreate(want)', file: 'b.ets', line: -1 },
      { statement: 'invoke hilog.info(want)', file: 'b.ets', line: 2 },
    ],
  }],
  taintFlowLinks: [],
}, true);

assert.strictEqual(result.detectorApiUsages, 1);
assert.strictEqual(result.detectorLocalSinks, 1);
assert.strictEqual(result.ifdsQueryFlows, 1);
assert.strictEqual(result.configuredSourceEndpoints, 1);
assert.strictEqual(result.configuredSinkEndpoints, 1);
assert.strictEqual(result.linkedFlows, 0);
assert.deepStrictEqual(result.errors, []);

console.log('Evidence-universe audit verified.');
