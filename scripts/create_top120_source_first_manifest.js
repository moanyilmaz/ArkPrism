'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const JSON5 = require('json5');
const { normalizeSensitiveApiCatalog } = require('../dist/sensitiveApiCatalog');
const PACKAGE_ALIASES = require('../config/package_aliases.json');

const SOURCE_EXTENSIONS = new Set(['.ets', '.ts']);
const SKIPPED_DIRECTORIES = new Set([
  '.git', '.hvigor', '.idea', '.preview', 'build', 'cache', 'node_modules',
  'oh_modules', 'resources', 'rawfile',
]);

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith('--') || !value) throw new Error(`Invalid argument: ${key}`);
    args[key.slice(2)] = path.resolve(value);
  }
  for (const required of ['benchmark', 'dataset', 'rules', 'output']) {
    if (!args[required]) throw new Error(`--${required} is required`);
  }
  return args;
}

function walkSources(directory, files = []) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (!SKIPPED_DIRECTORIES.has(entry.name)) walkSources(fullPath, files);
    } else if (SOURCE_EXTENSIONS.has(path.extname(entry.name))) {
      files.push(fullPath);
    }
  }
  return files.sort((left, right) => left.localeCompare(right));
}

function sourceTreeHash(projectRoot, files) {
  const hash = crypto.createHash('sha256');
  for (const file of files) {
    hash.update(path.relative(projectRoot, file).replace(/\\/g, '/'));
    hash.update('\0');
    hash.update(fs.readFileSync(file));
    hash.update('\0');
  }
  return hash.digest('hex');
}

function declaredSourceRoots(projectRoot) {
  const profilePath = path.join(projectRoot, 'build-profile.json5');
  if (!fs.existsSync(profilePath)) {
    return { scope: 'project-root-fallback', roots: [projectRoot] };
  }
  try {
    const profile = JSON5.parse(fs.readFileSync(profilePath, 'utf8'));
    const roots = [...new Set((profile.modules || [])
      .map(module => module?.srcPath)
      .filter(Boolean)
      .map(srcPath => path.resolve(projectRoot, srcPath))
      .filter(root => fs.existsSync(root)))];
    return roots.length > 0
      ? { scope: 'declared-build-modules', roots }
      : { scope: 'project-root-fallback', roots: [projectRoot] };
  } catch (error) {
    throw new Error(`Cannot parse ${profilePath}: ${error.message}`);
  }
}

function assignSizeStrata(projects) {
  const sorted = [...projects].sort((left, right) =>
    left.sourceFiles - right.sourceFiles || left.project.localeCompare(right.project));
  sorted.forEach((project, index) => {
    const quantile = (index + 0.5) / sorted.length;
    project.sizeStratum = quantile < 1 / 3 ? 'small' : quantile < 2 / 3 ? 'medium' : 'large';
  });
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const benchmark = JSON.parse(fs.readFileSync(args.benchmark, 'utf8').replace(/^\uFEFF/, ''));
  const rawRules = JSON.parse(fs.readFileSync(args.rules, 'utf8').replace(/^\uFEFF/, ''));
  const catalog = normalizeSensitiveApiCatalog(rawRules);
  const packages = new Set(catalog.flatMap(group => [
    group.systemPackage,
    ...(PACKAGE_ALIASES[group.systemPackage] || []),
    ...group.privacyApis.flatMap(api => api.packageAliases || []),
  ]));
  const projects = benchmark.projects.map(project => {
    const projectRoot = path.join(args.dataset, project.projectName);
    if (!fs.existsSync(projectRoot)) throw new Error(`Missing project: ${projectRoot}`);
    const sourceScope = declaredSourceRoots(projectRoot);
    const files = [...new Set(sourceScope.roots.flatMap(root => walkSources(root, [])))].sort();
    const hasConfiguredImport = files.some(file => {
      const source = fs.readFileSync(file, 'utf8');
      return [...packages].some(packageName => source.includes(`'${packageName}'`) ||
        source.includes(`"${packageName}"`));
    });
    return {
      sampleId: project.sampleId,
      project: project.projectName,
      sourceFiles: files.length,
      sourceTreeSha256: sourceTreeHash(projectRoot, files),
      sourceScope: sourceScope.scope,
      sourceRoots: sourceScope.roots.map(root =>
        path.relative(projectRoot, root).replace(/\\/g, '/') || '.',
      ),
      importStratum: hasConfiguredImport ? 'configured_import' : 'no_configured_import',
    };
  });
  assignSizeStrata(projects);
  const manifest = {
    schemaVersion: 1,
    benchmark: 'ArkPrismTop120-PAC-v2',
    projectSelection: 'The original fixed Top-120 project set; gold labels are rebuilt source-first for the reviewed PAC catalog.',
    annotationUnit: 'source_api_occurrence',
    candidateGenerationReadsArkPrismReports: false,
    dataset: args.dataset,
    ruleSetSha256: crypto.createHash('sha256').update(fs.readFileSync(args.rules)).digest('hex'),
    packageAliasSha256: crypto.createHash('sha256')
      .update(fs.readFileSync(path.resolve(__dirname, '..', 'config', 'package_aliases.json')))
      .digest('hex'),
    projectCount: projects.length,
    projects,
  };
  fs.mkdirSync(path.dirname(args.output), { recursive: true });
  fs.writeFileSync(args.output, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({
    output: args.output,
    projects: projects.length,
    sourceFiles: projects.reduce((sum, project) => sum + project.sourceFiles, 0),
    configuredImportProjects: projects.filter(project =>
      project.importStratum === 'configured_import').length,
  }));
}

main();
