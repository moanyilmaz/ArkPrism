#!/usr/bin/env node

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const artifactPath = path.resolve(
  __dirname,
  '..',
  'docs',
  'experiment_hapbench_20260727_v22_final',
  'endpoint_pair_audit.json',
);
const artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));
const evaluatorSource = fs.readFileSync(
  path.resolve(__dirname, '..', 'scripts', 'audit_hapbench_endpoint_pairs.js'),
  'utf8',
);

assert.strictEqual(artifact.schemaVersion, 1);
assert.strictEqual(artifact.unit, 'unique source-sink endpoint pair');
assert.ok(!evaluatorSource.includes('precisionWilson95Lower'));
assert.ok(!evaluatorSource.includes('recallWilson95Lower'));
assert.deepStrictEqual(
  {
    goldPairs: artifact.metrics.goldPairs,
    predictedPairs: artifact.metrics.predictedPairs,
    tp: artifact.metrics.tp,
    fp: artifact.metrics.fp,
    fn: artifact.metrics.fn,
  },
  { goldPairs: 53, predictedPairs: 51, tp: 50, fp: 1, fn: 3 },
);

const rejected = artifact.records.filter((record) => !record.accepted);
assert.strictEqual(rejected.length, 1);
assert.strictEqual(rejected[0].caseId, 'General_Language_Features__VirtualDispatch1');
assert.strictEqual(rejected[0].sinkLine, 14);
assert.ok(rejected[0].evidence.includes('empty constant'));

const acceptedCases = new Set(
  artifact.records.filter((record) => record.accepted).map((record) => record.caseId),
);
for (const caseId of artifact.falseNegativeCases) {
  assert.ok(!acceptedCases.has(caseId));
}

console.log('HapBench endpoint-pair audit artifact verified.');
