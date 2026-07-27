const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DEFAULT_DATASET =
  'E:\\Projects\\ARGUS\\release_20260617\\ARGUS-successful-1015-samples-20260617';
const DEFAULT_OUTPUT = path.join(
  ROOT,
  'benchmarks',
  'ArkSourceFirst60',
  'selection_manifest.json',
);
const EXCLUDED_PROJECTS = new Set(['readmigo_harmony-app']);
const SKIPPED_DIRECTORIES = new Set([
  '.git',
  '.idea',
  '.preview',
  'build',
  'cache',
  'node_modules',
  'oh_modules',
  'resources',
]);
const SOURCE_EXTENSIONS = new Set(['.ets', '.ts']);
const SEED = 'arkprism-source-first-v1';
const PACKAGE_ALIASES = new Map(
  Object.entries(require('../config/package_aliases.json')),
);

function parseArgs(argv) {
  const args = { dataset: DEFAULT_DATASET, output: DEFAULT_OUTPUT };
  for (let index = 0; index < argv.length; index++) {
    if (argv[index] === '--dataset') args.dataset = path.resolve(argv[++index]);
    else if (argv[index] === '--output') args.output = path.resolve(argv[++index]);
    else throw new Error(`Unknown argument: ${argv[index]}`);
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
  return files;
}

function stableScore(project) {
  return crypto
    .createHash('sha256')
    .update(`${SEED}\0${project}`)
    .digest('hex');
}

function sourceTreeHash(projectRoot, files) {
  const hash = crypto.createHash('sha256');
  for (const file of files.sort()) {
    hash.update(path.relative(projectRoot, file).replace(/\\/g, '/'));
    hash.update('\0');
    hash.update(fs.readFileSync(file));
    hash.update('\0');
  }
  return hash.digest('hex');
}

function assignSizeStrata(projects) {
  const sorted = [...projects].sort((left, right) =>
    left.sourceFiles - right.sourceFiles ||
    left.project.localeCompare(right.project),
  );
  for (let index = 0; index < sorted.length; index++) {
    const quantile = (index + 0.5) / sorted.length;
    sorted[index].sizeStratum =
      quantile < 1 / 3 ? 'small' : quantile < 2 / 3 ? 'medium' : 'large';
  }
}

function select(projects) {
  const selected = [];
  for (const importStratum of ['configured_import', 'no_configured_import']) {
    const group = projects.filter(project => project.importStratum === importStratum);
    assignSizeStrata(group);
    for (const sizeStratum of ['small', 'medium', 'large']) {
      const candidates = group
        .filter(project => project.sizeStratum === sizeStratum)
        .sort((left, right) => stableScore(left.project).localeCompare(stableScore(right.project)));
      if (candidates.length < 10) {
        throw new Error(`${importStratum}/${sizeStratum} has only ${candidates.length} projects.`);
      }
      selected.push(...candidates.slice(0, 10));
    }
  }
  return selected.sort((left, right) => left.project.localeCompare(right.project));
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const rules = JSON.parse(
    fs.readFileSync(path.join(ROOT, 'config', 'sensitive_apis.json'), 'utf8'),
  );
  const configuredPackages = new Set(rules.map(rule => rule.systemPackage));
  const sourceEvidencePackages = new Set(configuredPackages);
  for (const configuredPackage of configuredPackages) {
    for (const alias of PACKAGE_ALIASES.get(configuredPackage) || []) {
      sourceEvidencePackages.add(alias);
    }
  }
  const projects = [];

  for (const entry of fs.readdirSync(args.dataset, { withFileTypes: true })) {
    if (!entry.isDirectory() || EXCLUDED_PROJECTS.has(entry.name)) continue;
    const projectRoot = path.join(args.dataset, entry.name);
    const files = walkSources(projectRoot);
    let hasConfiguredImport = false;
    for (const file of files) {
      const source = fs.readFileSync(file, 'utf8');
      if ([...sourceEvidencePackages].some(pkg => source.includes(pkg))) {
        hasConfiguredImport = true;
        break;
      }
    }
    projects.push({
      project: entry.name,
      sourceFiles: files.length,
      importStratum: hasConfiguredImport ? 'configured_import' : 'no_configured_import',
      files,
      projectRoot,
    });
  }

  const selected = select(projects);
  const manifest = {
    schemaVersion: 2,
    benchmark: 'ArkSourceFirst60',
    selectionFrozenBeforeFinalRun: true,
    readsArkPrismReports: false,
    seed: SEED,
    population: {
      dataset: args.dataset,
      retainedProjects: projects.length,
      excludedProjects: [...EXCLUDED_PROJECTS],
    },
    design: {
      projects: 60,
      importStrata: {
        configured_import: 30,
        no_configured_import: 30,
      },
      sizeStrataPerImportGroup: {
        small: 10,
        medium: 10,
        large: 10,
      },
      sizeMeasure: 'Number of .ets/.ts source files after excluding generated/dependency trees.',
      importEvidence:
        'Exact occurrence of a configured package or an accepted @ohos/@kit migration alias in source.',
      purpose:
        'Source-first author audit of configured privacy-API occurrences; project selection does not use detector output.',
    },
    projects: selected.map(project => ({
      project: project.project,
      sourceFiles: project.sourceFiles,
      importStratum: project.importStratum,
      sizeStratum: project.sizeStratum,
      sourceTreeSha256: sourceTreeHash(project.projectRoot, project.files),
    })),
  };

  fs.mkdirSync(path.dirname(args.output), { recursive: true });
  fs.writeFileSync(args.output, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({
    output: args.output,
    selectedProjects: manifest.projects.length,
    configuredImport: manifest.projects.filter(
      project => project.importStratum === 'configured_import',
    ).length,
    noConfiguredImport: manifest.projects.filter(
      project => project.importStratum === 'no_configured_import',
    ).length,
  }));
}

main();
