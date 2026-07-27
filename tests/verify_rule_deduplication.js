'use strict';

const assert = require('assert');
const {
  deduplicateDetector,
  deduplicateFlat,
  semanticSet,
  equalSets,
} = require('../scripts/deduplicate_rule_sets');

const detector = [
  {
    systemPackage: '@kit.TestKit',
    privacyApis: [
      { namespace: 'n', method: 'm', directCall: true },
      { method: 'm', directCall: true, namespace: 'n', class: '' },
      { namespace: 'n', method: 'p', directCall: null },
    ],
  },
];
const detectorResult = deduplicateDetector(detector);
assert.strictEqual(detectorResult[0].privacyApis.length, 2);
assert.ok(
  equalSets(
    semanticSet('detector', detector),
    semanticSet('detector', detectorResult)
  )
);

const flat = [{ a: 1, b: 2 }, { b: 2, a: 1 }, { a: 2 }];
const flatResult = deduplicateFlat(flat);
assert.strictEqual(flatResult.length, 2);
assert.ok(equalSets(semanticSet('flat', flat), semanticSet('flat', flatResult)));
console.log('Rule-set deduplication verified.');
