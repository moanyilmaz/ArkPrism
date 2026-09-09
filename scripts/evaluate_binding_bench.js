const fs = require('fs');
const path = require('path');
const aliases = require('../config/package_aliases.json');

function bindingCorrect(expected, bindings) {
  if (expected === undefined) return null;
  if (expected === null) return bindings.length === 0;
  return bindings.length > 0 && bindings.every(b =>
    b.rule.apiName === expected.api
    && (b.rule.module === expected.module || (aliases[b.rule.module] || []).includes(expected.module))
    && b.type === expected.type && b.value === expected.carrier);
}

function evaluate(run) {
  const cases = new Map(run.cases.map(c => [c.id, c]));
  const rows = run.results.map(r => ({
    id: r.id, expected: r.expected, predicted: r.predicted,
    executionFailure: !!r.error || r.metadata?.ifds?.budgetExceeded === true,
    flowCorrect: r.flowCorrect,
    bindingCorrect: !r.error && bindingCorrect(cases.get(r.id).binding, r.bindings || []),
    catalogUnresolved: r.metadata?.catalogBindings?.unresolved || r.metadata?.ifds?.catalogBindings?.unresolved || []
  }));
  return {
    convention: 'Compare canonical API identity using the existing package-alias registry; parameter names refer to the fixed source fixture.',
    summary: {
      cases: rows.length, executionFailures: rows.filter(r => r.executionFailure).length,
      tp: rows.filter(r => r.expected && r.predicted).length,
      fn: rows.filter(r => r.expected && r.predicted === false).length,
      tn: rows.filter(r => !r.expected && r.predicted === false).length,
      fp: rows.filter(r => !r.expected && r.predicted).length,
      bindingCases: rows.filter(r => r.bindingCorrect !== null).length,
      correctBindings: rows.filter(r => r.bindingCorrect).length
    }, rows
  };
}

if (require.main === module) {
  for (const dir of process.argv.slice(2)) {
    const output = evaluate(JSON.parse(fs.readFileSync(path.join(dir, 'results.json'), 'utf8')));
    fs.writeFileSync(path.join(dir, 'evaluation.json'), JSON.stringify(output, null, 2));
    console.log(dir, output.summary);
  }
}
module.exports = { bindingCorrect, evaluate };
