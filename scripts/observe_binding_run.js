// Observe the normal CLI without replacing source matching or propagation.
const fs = require('fs');
const path = require('path');
const buildRoot = path.resolve(process.env.ARKPRISM_BUILD_ROOT || path.join(__dirname, '..'));
const { TaintAnalysisChecker } = require(path.join(buildRoot, 'dist/hapflow/TaintAnalysis'));
const util = require(path.join(buildRoot, 'dist/hapflow/Util'));
const bindings = new Map();
const decisions = new Map();
const originalCreate = TaintAnalysisChecker.prototype.createSourceFact;
const originalMatch = util.callSource;

util.callSource = function(value, ...args) {
  const result = originalMatch.call(this, value, ...args);
  if (value.getMethodSignature) {
    const record = {
      expression: value.toString(),
      signature: value.getMethodSignature().toString(),
      receiverType: value.getBase?.()?.getType().toString(),
      rule: result?.rule || null,
      type: result?.sourceType || null
    };
    decisions.set(JSON.stringify(record), record);
  }
  return result;
};

TaintAnalysisChecker.prototype.createSourceFact = function(value, stmt, source) {
  const fact = originalCreate.call(this, value, stmt, source);
  const record = {
    file: stmt.getCfg().getDeclaringMethod().getDeclaringArkFile().getFilePath(),
    line: stmt.getOriginPositionInfo().getLineNo(),
    statement: stmt.toString(),
    value: value.toString(),
    type: source.sourceType,
    parameter: source.sourceIndex,
    callbackArgument: source.callbackIndex,
    rule: source.rule,
    carrierState: fact.getCarrierState?.()
  };
  bindings.set(JSON.stringify(record), record);
  return fact;
};

process.on('exit', () => {
  const output = process.env.ARKPRISM_BINDING_OBSERVATIONS;
  if (!output) return;
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, JSON.stringify({ bindings: [...bindings.values()], decisions: [...decisions.values()] }, null, 2));
});
require(path.join(buildRoot, 'dist/arkprism'));
