'use strict';

const fs = require('fs');
const path = require('path');

const { collectFiles, projectFingerprint } = require('./package_top120_sources');

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 2) {
    const token = argv[index];
    const value = argv[index + 1];
    if (!token?.startsWith('--') || !value) throw new Error(`Invalid argument: ${token}`);
    args[token.slice(2)] = path.resolve(value);
  }
  for (const required of ['sources', 'output']) {
    if (!args[required]) throw new Error(`--${required} is required`);
  }
  return args;
}

function verifySources(sourceRoot) {
  const manifestPath = path.join(sourceRoot, 'source_manifest.json');
  if (!fs.existsSync(manifestPath)) throw new Error(`Missing source manifest: ${manifestPath}`);
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8').replace(/^\uFEFF/, ''));
  const expectedProjects = new Set((manifest.projects || []).map(project => project.projectName));
  const actualProjects = fs.readdirSync(sourceRoot, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name);
  const failures = [];
  for (const projectName of actualProjects) {
    if (!expectedProjects.has(projectName)) failures.push(`${projectName}: unexpected project`);
  }
  const verifiedProjects = [];
  for (const expected of manifest.projects || []) {
    const projectRoot = path.join(sourceRoot, expected.projectName);
    if (!fs.existsSync(projectRoot)) {
      failures.push(`${expected.projectName}: missing project directory`);
      continue;
    }
    const actual = projectFingerprint(projectRoot, collectFiles(projectRoot));
    const matches = actual.sha256 === expected.sha256
      && actual.files === expected.files
      && actual.bytes === expected.bytes;
    if (!matches) {
      failures.push(
        `${expected.projectName}: fingerprint ${actual.sha256}/${expected.sha256}, `
        + `files ${actual.files}/${expected.files}, bytes ${actual.bytes}/${expected.bytes}`,
      );
    }
    verifiedProjects.push({ projectName: expected.projectName, matches, ...actual });
  }
  return {
    schemaVersion: 1,
    manifest: 'source_manifest.json',
    checks: {
      expectedProjects: expectedProjects.size,
      actualProjects: actualProjects.length,
      verifiedProjects: verifiedProjects.filter(project => project.matches).length,
      expectedFiles: manifest.totals?.files,
      verifiedFiles: verifiedProjects.reduce((sum, project) => sum + project.files, 0),
      expectedBytes: manifest.totals?.bytes,
      verifiedBytes: verifiedProjects.reduce((sum, project) => sum + project.bytes, 0),
    },
    failures,
    passed: failures.length === 0
      && expectedProjects.size === actualProjects.length
      && verifiedProjects.length === expectedProjects.size,
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const result = verifySources(args.sources);
  fs.mkdirSync(path.dirname(args.output), { recursive: true });
  fs.writeFileSync(args.output, `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify({ output: args.output, passed: result.passed, checks: result.checks }));
  if (!result.passed) process.exitCode = 2;
}

if (require.main === module) main();

module.exports = { verifySources };
