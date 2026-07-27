const assert = require('assert');

const { TaintFact } = require('../dist/hapflow/TaintFact');
const { TaintOutcomeEqual } = require('../dist/hapflow/Util');
const { convertOutcome, deduplicateTaintFlows } = require('../dist/hapflowRunner');

function statement(text, file, line, method = 'run') {
  return {
    toString: () => text,
    getOriginPositionInfo: () => ({
      toString: () => `${file}:${line}`,
      getLineNo: () => line,
    }),
    getCfg: () => ({
      getDeclaringMethod: () => ({
        getName: () => method,
        getDeclaringArkFile: () => ({ getFilePath: () => file }),
      }),
    }),
  };
}

function evidence(sourceStmt, sourceKind, apiName) {
  return TaintFact.createSourceEvidence(
    sourceStmt,
    sourceKind,
    sourceKind === 'framework_input' ? 'ArgIn' : 'return',
    `<${apiName}>`,
    {
      module: sourceKind === 'framework_input' ? '@ohos.app.ability' : '@ohos.test',
      namespace: sourceKind === 'framework_input' ? 'UIAbility' : 'test',
      className: '',
      apiName,
      sourceKind,
      ruleOrigin: 'regression-test',
    },
  );
}

const value = { toString: () => '%sensitive' };
const sourceStmt = statement('%0 = privacy.getValue()', 'src/Page.ets', 10);
const errorStmt = statement('instanceinvoke error.<Error.constructor>(%0)', 'src/Page.ets', 15);
const sinkStmt = statement('console.info(error)', 'src/Page.ets', 20);
const privacyFact = new TaintFact(
  value,
  [errorStmt, sinkStmt],
  evidence(sourceStmt, 'privacy_data', 'getValue'),
);

const [privacyFlow] = convertOutcome([privacyFact], 'ifds');
assert.strictEqual(privacyFlow.sourceApi, sourceStmt.toString());
assert.strictEqual(privacyFlow.sourceLine, 10);
assert.strictEqual(privacyFlow.sourceKind, 'privacy_data');
assert.strictEqual(privacyFlow.sourceIdentity.apiName, 'getValue');
assert.strictEqual(privacyFlow.path[0].statement, sourceStmt.toString());
assert.strictEqual(privacyFlow.path[1].statement, errorStmt.toString());

const frameworkStmt = statement('ability.onCreate(want)', 'src/Ability.ets', 5, 'onCreate');
const frameworkFact = new TaintFact(
  value,
  [frameworkStmt, sinkStmt],
  evidence(frameworkStmt, 'framework_input', 'onCreate'),
);
const [frameworkFlow] = convertOutcome([frameworkFact], 'ifds');
assert.strictEqual(frameworkFlow.sourceKind, 'framework_input');
assert.strictEqual(frameworkFlow.sourceIdentity.sourceType, 'ArgIn');

assert.strictEqual(privacyFact.hasSameSource(frameworkFact), false);
assert.strictEqual(TaintOutcomeEqual(privacyFact, frameworkFact), false);
assert.strictEqual(deduplicateTaintFlows([privacyFlow, frameworkFlow]).length, 2);

assert.throws(
  () => convertOutcome([new TaintFact(value, [sinkStmt])], 'ifds'),
  /lacks source evidence/,
);

console.log('Taint source evidence propagation and reporting verified.');
