'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (!argv[i].startsWith('--')) {
      throw new Error(`Unexpected argument: ${argv[i]}`);
    }
    const key = argv[i].slice(2);
    const value = argv[i + 1];
    if (!value || value.startsWith('--')) {
      throw new Error(`Missing value for --${key}`);
    }
    args[key] = value;
    i += 1;
  }
  if (!args.input || !args.output) {
    throw new Error('Usage: node scripts/export_source_audit_annotations.js --input <json> --output <json>');
  }
  return args;
}

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function projectApiKey(annotation) {
  return `${annotation.projectName}\u0000${annotation.api.key}`;
}

function exportAnnotations(source) {
  const projects = source.samples.map(sample => ({
    sampleId: sample.sampleId,
    rankByReportedApiUsages: sample.rankByDetectedApiUsages,
    projectName: sample.projectName,
    sourceDirectoryName: path.basename(sample.sourcePath),
    confirmedProjectApiKeys: sample.manualGoldApiMethods,
  }));

  const grouped = new Map();
  for (const annotation of source.annotations) {
    const key = projectApiKey(annotation);
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(annotation);
  }

  const annotations = [...grouped.values()].map((records, index) => {
    const first = records[0];
    const evidence = new Map();
    for (const record of records) {
      const item = {
        file: record.sourceEvidence.file,
        line: record.sourceEvidence.line,
        column: record.sourceEvidence.column,
        matchedText: record.sourceEvidence.matchedText,
        snippet: record.sourceEvidence.snippet,
      };
      const key = [
        item.file,
        item.line,
        item.column,
        item.matchedText,
      ]
        .map(value => String(value == null ? '' : value).trim().toLowerCase())
        .join('\u0000');
      if (!evidence.has(key)) evidence.set(key, item);
    }
    return {
      annotationId: `T120-K${String(index + 1).padStart(4, '0')}`,
      sampleId: first.sampleId,
      projectName: first.projectName,
      api: {
        key: first.api.key,
        package: first.api.package,
        namespace: first.api.namespace,
        member: first.api.methodOrProperty,
      },
      sourceEvidence: [...evidence.values()],
      reviewDecision: {
        label: 'confirmed_reported_project_api_key',
        evidenceKinds: [
          ...new Set(
            records.map(record => record.manualAnnotation.evidenceKind)
          ),
        ].sort(),
        rationale:
          'At least one executable source location supports this reported project-API key.',
      },
    };
  });

  const sourceEvidenceLocations = annotations.reduce(
    (sum, annotation) => sum + annotation.sourceEvidence.length,
    0
  );
  const confirmed = annotations.filter(
    annotation =>
      annotation.reviewDecision.label ===
      'confirmed_reported_project_api_key'
  );

  return {
    schemaVersion: 2,
    benchmark: {
      name: 'ArkPrism Top-120 Project-API-Key Source Audit',
      version: '2026-07-24',
      annotationUnit: 'reported_project_api_key',
      scope: 'output_selected_precision_audit',
      selection: {
        strategy: 'descending_reported_privacy_api_usage_count',
        candidateProjects: 1015,
        selectedProjects: projects.length,
      },
      inputReportDerivedRecords: source.annotations.length,
      reviewedProjectApiKeys: annotations.length,
      confirmedProjectApiKeys: confirmed.length,
      uniqueSourceEvidenceLocations: sourceEvidenceLocations,
      recallDefined: false,
      occurrencePrecisionDefined: false,
      occurrencePrecisionUndefinedReason:
        'The input contained repeated report-derived records and was not an exhaustive annotation of distinct source occurrences.',
      recallUndefinedReason:
        'The sample and annotation candidates were selected from ArkPrism reports; unreported project-API keys were not exhaustively enumerated.',
    },
    projects,
    annotations,
  };
}

function validate(output) {
  if (output.projects.length !== 120) {
    throw new Error(`Expected 120 projects, found ${output.projects.length}`);
  }
  if (output.annotations.length !== 666) {
    throw new Error(`Expected 666 project-API keys, found ${output.annotations.length}`);
  }
  if (output.benchmark.confirmedProjectApiKeys !== 666) {
    throw new Error(
      `Expected 666 confirmed project-API keys, found ${output.benchmark.confirmedProjectApiKeys}`
    );
  }
  for (const annotation of output.annotations) {
    if (!annotation.sourceEvidence.length) {
      throw new Error(`Missing source evidence for ${annotation.annotationId}`);
    }
    for (const evidence of annotation.sourceEvidence) {
      if (!evidence.file || !(evidence.line > 0)) {
        throw new Error(`Missing source location for ${annotation.annotationId}`);
      }
      if (!evidence.snippet) {
        throw new Error(`Missing source snippet for ${annotation.annotationId}`);
      }
    }
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const inputPath = path.resolve(args.input);
  const outputPath = path.resolve(args.output);
  const inputBuffer = fs.readFileSync(inputPath);
  const source = JSON.parse(inputBuffer.toString('utf8'));
  const output = exportAnnotations(source);
  validate(output);
  output.provenance = {
    sourceFileName: path.basename(inputPath),
    sourceSha256: sha256(inputBuffer),
  };
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`);
  console.log(
    JSON.stringify({
      output: outputPath,
      projects: output.projects.length,
      annotations: output.annotations.length,
      sourceEvidenceLocations:
        output.benchmark.uniqueSourceEvidenceLocations,
      recallDefined: output.benchmark.recallDefined,
      occurrencePrecisionDefined:
        output.benchmark.occurrencePrecisionDefined,
    })
  );
}

if (require.main === module) {
  main();
}

module.exports = {
  exportAnnotations,
  validate,
};
