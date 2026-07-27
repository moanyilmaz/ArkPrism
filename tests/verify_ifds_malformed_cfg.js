const assert = require('assert');
const { DataflowSolver } = require('../dist/hapflow/DataflowSolver');

class CfgTestSolver extends DataflowSolver {
  mapBlock(block) {
    this.buildStmtMapInBlock(block);
  }

  children(stmt) {
    return this.getChildren(stmt);
  }
}

const problem = {
  createZeroValue: () => ({}),
  factEqual: (left, right) => left === right
};
const solver = new CfgTestSolver(problem, {});
const sourceStmt = {};
const targetStmt = {};
const emptyBlock = {
  getStmts: () => [],
  getExceptionalSuccessorBlocks: () => []
};
const validBlock = {
  getStmts: () => [targetStmt],
  getExceptionalSuccessorBlocks: () => []
};
const sourceBlock = {
  getStmts: () => [sourceStmt],
  getSuccessors: () => [undefined, emptyBlock, validBlock],
  getExceptionalSuccessorBlocks: () => []
};

solver.mapBlock(sourceBlock);

assert.deepStrictEqual(solver.children(sourceStmt), [targetStmt]);
assert.strictEqual(solver.getStats().malformedCfgEdges, 2);

console.log('IFDS malformed CFG successor handling verified.');
