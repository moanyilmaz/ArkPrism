const assert = require('assert');
const { DataflowSolver } = require('../dist/hapflow/DataflowSolver');
const { TaintFact } = require('../dist/hapflow/TaintFact');

class IncomingTestSolver extends DataflowSolver {
  record(start, call) {
    this.recordIncoming(start, call);
  }

  lookup(start) {
    return this.getCallEdgePoints({ edgeStart: start });
  }

  key(edge) {
    return this.edgeKey(edge);
  }
}

const problem = {
  createZeroValue: () => ({ value: 'zero' }),
  factEqual: (left, right) => left.group === right.group,
  getEntryMethod: () => ({})
};
const solver = new IncomingTestSolver(problem, {});
const node = {};
const fact1 = { group: 'same' };
const fact2 = { group: 'same' };
const start1 = { node, fact: fact1 };
const start2 = { node, fact: fact2 };
const call1 = { node: {}, fact: {} };
const call2 = { node: {}, fact: {} };

solver.record(start1, call1);
solver.record(start2, call2);

// Simulate later ArkIR refinement changing semantic equality. The exact path
// edge must retain its incoming set even when the old canonical fact changes.
fact1.group = 'refined';
const incoming = solver.lookup(start2);

assert.strictEqual(incoming.size, 2);
assert.ok(incoming.has(call1));
assert.ok(incoming.has(call2));

const stmt1 = {};
const stmt2 = {};
const value = {};
const source1 = TaintFact.createSourceEvidence(
  stmt1, 'privacy_data', 'return', '<source.one>',
  { sourceKind: 'privacy_data', apiName: 'one' },
);
const source2 = TaintFact.createSourceEvidence(
  stmt2, 'privacy_data', 'return', '<source.two>',
  { sourceKind: 'privacy_data', apiName: 'two' },
);
const node1 = {};
const node2 = {};
const edge1 = {
  edgeStart: { node: node1, fact: new TaintFact(value, [], source1) },
  edgeEnd: { node: node2, fact: new TaintFact(value, [], source1) },
};
const edge2 = {
  edgeStart: { node: node1, fact: new TaintFact(value, [], source2) },
  edgeEnd: { node: node2, fact: new TaintFact(value, [], source2) },
};
assert.notStrictEqual(solver.key(edge1), solver.key(edge2));

console.log('IFDS incoming and source identities verified.');
