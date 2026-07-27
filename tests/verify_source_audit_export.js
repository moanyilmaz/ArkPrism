'use strict';

const assert = require('assert');
const { exportAnnotations, validate } = require('../scripts/export_source_audit_annotations');

const source = {
  samples: Array.from({ length: 120 }, (_, index) => ({
    sampleId: `S${index + 1}`,
    rankByDetectedApiUsages: index + 1,
    projectName: `P${index + 1}`,
    sourcePath: `C:\\dataset\\P${index + 1}`,
    apiUsageAnnotations: index === 0 ? 1414 : 1,
    manualGoldApiMethods: index === 0 ? 547 : 1,
  })),
  annotations: [],
};

for (let index = 0; index < 1533; index += 1) {
  const projectIndex = index < 1414 ? 0 : index - 1413;
  const keyIndex = index < 666 ? index : index % 666;
  source.annotations.push({
    annotationId: `A${index + 1}`,
    sampleId: `S${projectIndex + 1}`,
    projectName: keyIndex < 547 ? 'P1' : `P${keyIndex - 545}`,
    api: {
      key: `ns|member${keyIndex}`,
      package: '@kit.TestKit',
      namespace: 'ns',
      methodOrProperty: `member${keyIndex}`,
    },
    sourceEvidence: {
      file: 'entry/src/main/ets/Test.ets',
      line: index + 1,
      column: 1,
      matchedText: `ns.member${keyIndex}`,
      snippet: `ns.member${keyIndex}();`,
    },
    manualAnnotation: {
      evidenceKind: 'namespace.method',
      reason: 'Executable configured API use.',
    },
    toolEvidence: {
      detectorCategory: 'direct invoke stmt',
    },
  });
}

const output = exportAnnotations(source);
validate(output);
assert.strictEqual(output.benchmark.recallDefined, false);
assert.strictEqual(output.benchmark.occurrencePrecisionDefined, false);
assert.strictEqual(output.projects.length, 120);
assert.strictEqual(output.annotations.length, 666);
assert.strictEqual(output.benchmark.confirmedProjectApiKeys, 666);
assert.ok(!Object.prototype.hasOwnProperty.call(output.benchmark, 'falseNegativeApiMethods'));
assert.ok(!Object.prototype.hasOwnProperty.call(output.annotations[0], 'toolEvidence'));
assert.ok(Array.isArray(output.annotations[0].sourceEvidence));
console.log('Source-audit export verified.');
