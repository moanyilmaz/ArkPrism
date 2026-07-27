const assert = require('assert');
const {
  rates,
  representatives,
} = require('../scripts/recompute_redundancy_sensitivity');

const projects = [
  { projectName: 'A', apis: 1, chains: 1, sinks: 1, taintFlows: 1 },
  { projectName: 'B', apis: 1, chains: 1, sinks: 0, taintFlows: 0 },
  { projectName: 'C', apis: 0, chains: 0, sinks: 0, taintFlows: 1 },
];

assert.deepStrictEqual(rates(projects), {
  projects: 3,
  withApi: 2,
  withChain: 2,
  withSink: 1,
  withTaint: 2,
  apiRate: 2 / 3,
  chainRate: 2 / 3,
  sinkRate: 1 / 3,
  taintRate: 2 / 3,
});

const projected = representatives(projects, [
  { projects: ['B', 'A'] },
]);
assert.deepStrictEqual(
  projected.map((project) => project.projectName).sort(),
  ['A', 'C'],
);

console.log('Redundancy-sensitivity regression passed.');
