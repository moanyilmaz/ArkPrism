const assert = require('assert');
const { computeImmediateDominators } = require('../dist/callChainTracer');

class TestBlock {
  constructor(name) {
    this.name = name;
    this.successors = [];
    this.predecessors = [];
  }

  connect(target) {
    this.successors.push(target);
    target.predecessors.push(this);
    return this;
  }

  getSuccessors() {
    return this.successors;
  }

  getPredecessors() {
    return this.predecessors;
  }
}

const start = new TestBlock('start');
const left = new TestBlock('left');
const right = new TestBlock('right');
const join = new TestBlock('join');
const exit = new TestBlock('exit');
const unreachable = new TestBlock('unreachable');

start.connect(left);
start.connect(right);
left.connect(join);
right.connect(join);
join.connect(left);
join.connect(exit);

// Deliberately avoid reverse-postorder input. The implementation must derive
// its own stable traversal order from the CFG.
const blocks = [join, exit, right, start, unreachable, left];
const cfg = { getStartingBlock: () => start };
const idoms = computeImmediateDominators(cfg, blocks);

assert.strictEqual(idoms.get(start), start);
assert.strictEqual(idoms.get(left), start);
assert.strictEqual(idoms.get(right), start);
assert.strictEqual(idoms.get(join), start);
assert.strictEqual(idoms.get(exit), join);
assert.strictEqual(idoms.has(unreachable), false);

console.log('Call-chain dominator computation verified.');
