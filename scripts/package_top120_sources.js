'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const EXCLUDED_DIRECTORIES = new Set([
  '.git', '.cache', '.preview', 'build', 'cache', 'node_modules', 'oh_modules',
]);

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 2) {
    const token = argv[index];
    const value = argv[index + 1];
    if (!token?.startsWith('--') || !value) throw new Error(`Invalid argument: ${token}`);
    args[token.slice(2)] = path.resolve(value);
  }
  for (const required of ['benchmark', 'dataset', 'output']) {
    if (!args[required]) throw new Error(`--${required} is required`);
  }
  return args;
}

function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function collectFiles(projectRoot) {
  const files = [];
  const pending = [projectRoot];
  while (pending.length > 0) {
    const current = pending.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (entry.isDirectory() && EXCLUDED_DIRECTORIES.has(entry.name)) continue;
      const target = path.join(current, entry.name);
      if (entry.isDirectory()) pending.push(target);
      else if (entry.isFile()) files.push(target);
    }
  }
  return files.sort((left, right) => left.localeCompare(right));
}

function projectFingerprint(projectRoot, files) {
  const hash = crypto.createHash('sha256');
  let bytes = 0;
  for (const filePath of files) {
    const relative = path.relative(projectRoot, filePath).replace(/\\/g, '/');
    const content = fs.readFileSync(filePath);
    hash.update(relative);
    hash.update('\0');
    hash.update(content);
    hash.update('\0');
    bytes += content.length;
  }
  return { sha256: hash.digest('hex'), files: files.length, bytes };
}

function packageSources({ benchmarkPath, datasetRoot, outputRoot }) {
  const benchmark = JSON.parse(fs.readFileSync(benchmarkPath, 'utf8').replace(/^\uFEFF/, ''));
  const projects = (benchmark.projects || []).map(project => project.projectName);
  if (projects.length !== 120 || new Set(projects).size !== 120) {
    throw new Error(`Expected 120 unique benchmark projects, found ${projects.length}`);
  }
  if (fs.existsSync(outputRoot) && fs.readdirSync(outputRoot).length > 0) {
    throw new Error(`Output directory must be empty or absent: ${outputRoot}`);
  }
  fs.mkdirSync(outputRoot, { recursive: true });

  const manifestProjects = [];
  for (const projectName of projects) {
    const sourceRoot = path.join(datasetRoot, projectName);
    if (!fs.existsSync(sourceRoot)) throw new Error(`Missing project: ${sourceRoot}`);
    const files = collectFiles(sourceRoot);
    if (!files.some(file => ['.ets', '.ts'].includes(path.extname(file).toLowerCase()))) {
      throw new Error(`Project has no ArkTS/TypeScript source: ${projectName}`);
    }
    const destinationRoot = path.join(outputRoot, projectName);
    for (const sourceFile of files) {
      const relative = path.relative(sourceRoot, sourceFile);
      const destination = path.join(destinationRoot, relative);
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.copyFileSync(sourceFile, destination);
    }
    const fingerprint = projectFingerprint(sourceRoot, files);
    manifestProjects.push({ projectName, ...fingerprint });
  }

  for (const annotation of benchmark.annotations || []) {
    for (const evidence of annotation.sourceEvidence || []) {
      const delivered = path.join(
        outputRoot,
        annotation.projectName,
        String(evidence.file).replace(/\//g, path.sep),
      );
      if (!fs.existsSync(delivered)) {
        throw new Error(`Annotated source was not packaged: ${annotation.annotationId}`);
      }
    }
  }

  const manifest = {
    schemaVersion: 1,
    benchmarkFile: path.basename(benchmarkPath),
    benchmarkSha256: sha256File(benchmarkPath),
    sourceDatasetName: path.basename(datasetRoot),
    projects: manifestProjects,
    totals: {
      projects: manifestProjects.length,
      files: manifestProjects.reduce((sum, project) => sum + project.files, 0),
      bytes: manifestProjects.reduce((sum, project) => sum + project.bytes, 0),
    },
    inclusion: {
      allProjectFiles: true,
      excludedDirectories: [...EXCLUDED_DIRECTORIES].sort(),
    },
  };
  fs.writeFileSync(
    path.join(outputRoot, 'source_manifest.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  return manifest;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const manifest = packageSources({
    benchmarkPath: args.benchmark,
    datasetRoot: args.dataset,
    outputRoot: args.output,
  });
  console.log(JSON.stringify({ output: args.output, totals: manifest.totals }));
}

if (require.main === module) main();

module.exports = { collectFiles, packageSources, projectFingerprint };
