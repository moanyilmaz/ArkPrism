const assert = require('assert');

const { TaintFact } = require('../dist/hapflow/TaintFact');
const { propagateFact } = require('../dist/hapflow/Util');
const { convertOutcome, deduplicateTaintFlows } = require('../dist/hapflowRunner');

function statement(text, line) {
  return {
    toString: () => text,
    getOriginPositionInfo: () => ({ getLineNo: () => line }),
    getCfg: () => ({
      getDeclaringMethod: () => ({
        getName: () => 'execute',
        getDeclaringArkFile: () => ({ getFilePath: () => 'src/EntryAbility.ets' }),
      }),
    }),
  };
}

const sourceStmt = statement('%0 = identifier.getOAID()', 10);
const thenStmt = statement('%0.then(%AM0$execute)', 10);
const sinkStmt = statement('console.info(value)', 11);
const evidence = TaintFact.createSourceEvidence(
  sourceStmt,
  'privacy_data',
  'return',
  '<identifier.getOAID()>',
  {
    module: '@kit.AdsKit',
    namespace: 'identifier',
    className: '',
    apiName: 'getOAID',
    sourceKind: 'privacy_data',
    ruleOrigin: 'regression-test',
  },
);

const promise = { toString: () => '%0' };
const callbackParam = { toString: () => 'value' };
const sourceFact = new TaintFact(promise, [sourceStmt], evidence);
const propagated = new Set();
const continuationFact = propagateFact(callbackParam, thenStmt, propagated, sourceFact);
assert(continuationFact);
continuationFact.addDerivation('promise_then');
continuationFact.addPath(sinkStmt);

assert.deepStrictEqual(continuationFact.getDerivations(), ['promise_then']);
const [ifdsFlow] = convertOutcome([continuationFact], 'ifds');
assert.deepStrictEqual(ifdsFlow.analysisDerivations, ['promise_then']);

const [supplementFlow] = convertOutcome([continuationFact], 'async_supplement');
const [merged] = deduplicateTaintFlows([ifdsFlow, supplementFlow]);
assert.strictEqual(merged.provenance, 'both');
assert.deepStrictEqual(merged.analysisDerivations, ['promise_then']);

console.log('Promise continuation provenance propagation verified.');
