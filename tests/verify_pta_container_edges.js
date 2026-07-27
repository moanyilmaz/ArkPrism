const assert = require('assert');
const { Local, PointerAnalysisConfig } = require('../dist/arkanalyzer');
const { Pag } = require('../dist/arkanalyzer/callgraph/pointerAnalysis/Pag');

PointerAnalysisConfig.create(2, './out');
const pag = new Pag();
const local = new Local('notAHeapContainer');
const baseNode = pag.addPagNode(0, local);

assert.doesNotThrow(() => {
  const fieldNode = pag.getOrClonePagContainerFieldNode(baseNode.getID(), undefined, local);
  assert.strictEqual(fieldNode, undefined);
});
assert.strictEqual(pag.getRejectedContainerFieldEdges(), 1);

console.log('PTA invalid container-field edge accounting verified.');
