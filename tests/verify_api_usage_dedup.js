const { deduplicatePrivacyApiResults } = require('../dist/apiDetector');

function usage(overrides = {}) {
  return {
    category: 'indirect invoke',
    apiPackage: '@kit.MediaKit',
    namespace: 'AVMetadataExtractor',
    method: 'fetchMetadata',
    args: [],
    code: 'instanceinvoke extractor.<...fetchMetadata()>()',
    file: 'Index.ets',
    declaringMethod: 'Example.main()',
    matchEvidence: 'namespace',
    ...overrides,
  };
}

const results = deduplicatePrivacyApiResults([
  usage(),
  usage({ matchEvidence: 'receiver_type' }),
  usage({ namespace: 'avmetadataextractor' }),
  usage({ code: 'instanceinvoke other.<...fetchMetadata()>()' }),
  usage({ namespace: 'OtherExtractor' }),
]);

if (results.length !== 3) {
  throw new Error(`Expected 3 unique API occurrences, got ${results.length}`);
}

const canonical = results.find(result =>
  result.namespace === 'AVMetadataExtractor'
  && result.code.includes('extractor.<'),
);
if (!canonical || canonical.matchEvidence !== 'receiver_type') {
  throw new Error('Expected the strongest receiver evidence to be retained');
}

console.log('privacy API occurrence deduplication: passed');
