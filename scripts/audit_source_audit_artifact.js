'use strict';

const fs = require('fs');
const path = require('path');

const PACKAGE_ALIASES = Object.fromEntries(
  Object.entries(require('../config/package_aliases.json')).map(([key, aliases]) => [
    key.toLowerCase(),
    aliases.map(alias => alias.toLowerCase()),
  ]),
);

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) throw new Error(`Unexpected argument: ${token}`);
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) {
      throw new Error(`Missing value for ${token}`);
    }
    args[token.slice(2)] = path.resolve(value);
    index += 1;
  }
  for (const required of ['benchmark', 'dataset', 'rules', 'output']) {
    if (!args[required]) throw new Error(`Missing --${required}`);
  }
  return args;
}

function normalized(value) {
  return String(value == null ? '' : value)
    .replace(/\s+/g, '')
    .toLowerCase();
}

function normalizedPackage(value) {
  return String(value == null ? '' : value).trim().toLowerCase();
}

function normalizedNamespace(value) {
  const result = normalized(value);
  if (result === 'distributeddevicemanager') return 'devicemanager';
  if (result === 'geolocationmanager') return 'geolocation';
  return result;
}

function normalizedMember(value) {
  const parts = String(value == null ? '' : value)
    .replace(/\(\)\s*$/, '')
    .replace(/\s*\(.*/, '')
    .split('.')
    .filter(Boolean);
  return (parts.pop() || '').toLowerCase();
}

function loadRules(file) {
  const groups = JSON.parse(fs.readFileSync(file, 'utf8'));
  return groups.flatMap(group =>
    (group.privacyApis || []).map(entry => ({
      package: normalizedPackage(group.systemPackage),
      namespace: normalizedNamespace(entry.namespace),
      member: normalizedMember(entry.method),
    }))
  );
}

function packageCompatible(observedPackage, rulePackage) {
  const observed = normalizedPackage(observedPackage);
  const candidates = new Set([observed, ...(PACKAGE_ALIASES[observed] || [])]);
  return candidates.has(rulePackage);
}

function configuredApi(rules, api) {
  const namespace = normalizedNamespace(api.namespace);
  const member = normalizedMember(api.member);
  return rules.some(
    rule =>
      packageCompatible(api.package, rule.package) &&
      namespace === rule.namespace &&
      member === rule.member
  );
}

function sourceLineSupports(line, matchedText, member) {
  const normalizedLine = normalized(line);
  const normalizedMatch = normalized(matchedText).replace(/^\./, '');
  const normalizedMember = normalized(member)
    .replace(/\(.*$/, '')
    .split('.')
    .pop();
  return (
    (normalizedMatch && normalizedLine.includes(normalizedMatch)) ||
    (normalizedMember && normalizedLine.includes(normalizedMember))
  );
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const benchmark = JSON.parse(fs.readFileSync(args.benchmark, 'utf8'));
  const rules = loadRules(args.rules);
  const fileCache = new Map();
  const failures = [];
  const checks = {
    records: benchmark.annotations.length,
    sourceEvidenceLocations: 0,
    projectDirectoriesPresent: 0,
    sourceFilesPresent: 0,
    positiveLinesPresent: 0,
    lineTextSupported: 0,
    snippetsPresent: 0,
    configuredApiKeys: 0,
  };

  for (const annotation of benchmark.annotations) {
    const projectDir = path.join(args.dataset, annotation.projectName);
    const projectPresent = fs.existsSync(projectDir);
    if (projectPresent) checks.projectDirectoriesPresent += 1;
    else {
      failures.push({
        annotationId: annotation.annotationId,
        check: 'project_directory',
        value: projectDir,
      });
    }

    const configured = configuredApi(rules, annotation.api);
    if (configured) checks.configuredApiKeys += 1;
    else {
      failures.push({
        annotationId: annotation.annotationId,
        check: 'configured_api_key',
        value: annotation.api,
      });
    }

    for (const evidence of annotation.sourceEvidence) {
      checks.sourceEvidenceLocations += 1;
      if (evidence.snippet) checks.snippetsPresent += 1;
      else {
        failures.push({
          annotationId: annotation.annotationId,
          check: 'source_snippet',
        });
      }

      const sourceFile = path.join(
        projectDir,
        String(evidence.file).replace(/\//g, path.sep)
      );
      if (!fs.existsSync(sourceFile)) {
        failures.push({
          annotationId: annotation.annotationId,
          check: 'source_file',
          value: sourceFile,
        });
        continue;
      }
      checks.sourceFilesPresent += 1;
      if (!fileCache.has(sourceFile)) {
        fileCache.set(
          sourceFile,
          fs.readFileSync(sourceFile, 'utf8').split(/\r?\n/)
        );
      }
      const lines = fileCache.get(sourceFile);
      const lineNumber = Number(evidence.line);
      if (!Number.isInteger(lineNumber) || lineNumber <= 0 || lineNumber > lines.length) {
        failures.push({
          annotationId: annotation.annotationId,
          check: 'positive_source_line',
          value: evidence.line,
        });
        continue;
      }
      checks.positiveLinesPresent += 1;
      const line = lines[lineNumber - 1];
      if (
        sourceLineSupports(
          line,
          evidence.matchedText,
          annotation.api.member
        )
      ) {
        checks.lineTextSupported += 1;
      } else {
        failures.push({
          annotationId: annotation.annotationId,
          check: 'line_text_support',
          value: {
            file: evidence.file,
            line: lineNumber,
            matchedText: evidence.matchedText,
            actualLine: line,
          },
        });
      }
    }
  }

  const output = {
    schemaVersion: 1,
    benchmark: args.benchmark,
    dataset: args.dataset,
    rules: args.rules,
    checks,
    failures,
    passed: failures.length === 0,
  };
  fs.mkdirSync(path.dirname(args.output), { recursive: true });
  fs.writeFileSync(args.output, `${JSON.stringify(output, null, 2)}\n`);
  console.log(
    JSON.stringify({
      output: args.output,
      passed: output.passed,
      checks,
      failures: failures.length,
    })
  );
  if (!output.passed) process.exitCode = 2;
}

if (require.main === module) {
  main();
}
