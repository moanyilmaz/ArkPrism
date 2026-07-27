const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const ts = require('typescript');

const EXCLUDED_DIRS = new Set([
  '.git',
  '.idea',
  '.hvigor',
  'build',
  'dist',
  'node_modules',
  'oh_modules',
  'resources',
]);

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i];
    if (!key.startsWith('--')) throw new Error(`Unexpected argument: ${key}`);
    args[key.slice(2)] = argv[++i];
  }
  for (const required of ['dataset', 'reports', 'benchmark', 'output']) {
    if (!args[required]) throw new Error(`Missing --${required}`);
  }
  return args;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, ''));
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function sourceFiles(root) {
  const result = [];
  const stack = [root];
  while (stack.length > 0) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (entry.name.startsWith('.') && entry.isDirectory()) continue;
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (!EXCLUDED_DIRS.has(entry.name.toLowerCase())) stack.push(fullPath);
      } else if (/\.(ets|ts)$/i.test(entry.name) && !/\.d\.ts$/i.test(entry.name)) {
        result.push(fullPath);
      }
    }
  }
  return result.sort();
}

function tokenFingerprint(filePath) {
  const text = fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '');
  const scanner = ts.createScanner(
    ts.ScriptTarget.Latest,
    true,
    ts.LanguageVariant.Standard,
    text,
  );
  const tokens = [];
  while (true) {
    const kind = scanner.scan();
    if (kind === ts.SyntaxKind.EndOfFileToken) break;
    let token = String(kind);
    if (
      kind === ts.SyntaxKind.Identifier
      || kind === ts.SyntaxKind.PrivateIdentifier
      || kind === ts.SyntaxKind.StringLiteral
      || kind === ts.SyntaxKind.NumericLiteral
      || kind === ts.SyntaxKind.RegularExpressionLiteral
      || kind === ts.SyntaxKind.NoSubstitutionTemplateLiteral
      || kind === ts.SyntaxKind.TemplateHead
      || kind === ts.SyntaxKind.TemplateMiddle
      || kind === ts.SyntaxKind.TemplateTail
    ) {
      token += `:${scanner.getTokenText()}`;
    }
    tokens.push(token);
  }
  return {
    hash: sha256(tokens.join('\u001f')),
    tokens: tokens.length,
    lines: text.length === 0 ? 0 : text.split(/\r?\n/).length,
  };
}

function reportPath(reportRoot, projectName) {
  const exact = path.join(reportRoot, projectName, `${projectName}-arkprism-report.json`);
  if (fs.existsSync(exact)) return exact;
  const directory = path.join(reportRoot, projectName);
  if (!fs.existsSync(directory)) return '';
  const candidates = fs.readdirSync(directory)
    .filter(name => name.endsWith('-arkprism-report.json'));
  return candidates.length === 1 ? path.join(directory, candidates[0]) : '';
}

function summarizeReport(filePath) {
  if (!filePath) return null;
  const report = readJson(filePath);
  const usages = Array.isArray(report.privacyApiUsages) ? report.privacyApiUsages : [];
  const chains = Array.isArray(report.callChains) ? report.callChains : [];
  return {
    apiUsages: usages.length,
    callChains: chains.length,
    chainsWithPath: chains.filter(chain => (chain.chain || []).length > 0 || chain.entryMethod).length,
    sinks: chains.reduce((sum, chain) => sum + (Array.isArray(chain.dataSinks) ? chain.dataSinks.length : 0), 0),
    taintFlows: Array.isArray(report.taintFlows) ? report.taintFlows.length : 0,
  };
}

function groupsBy(items, key) {
  const groups = new Map();
  for (const item of items) {
    const value = key(item);
    if (!groups.has(value)) groups.set(value, []);
    groups.get(value).push(item);
  }
  return groups;
}

function jaccard(a, b) {
  if (a.size === 0 && b.size === 0) return 1;
  let intersection = 0;
  const smaller = a.size <= b.size ? a : b;
  const larger = a.size <= b.size ? b : a;
  for (const value of smaller) if (larger.has(value)) intersection++;
  return {
    intersection,
    score: intersection / (a.size + b.size - intersection),
  };
}

class UnionFind {
  constructor(size) {
    this.parent = Array.from({ length: size }, (_, index) => index);
    this.rank = new Array(size).fill(0);
  }

  find(value) {
    if (this.parent[value] !== value) this.parent[value] = this.find(this.parent[value]);
    return this.parent[value];
  }

  union(a, b) {
    let rootA = this.find(a);
    let rootB = this.find(b);
    if (rootA === rootB) return;
    if (this.rank[rootA] < this.rank[rootB]) [rootA, rootB] = [rootB, rootA];
    this.parent[rootB] = rootA;
    if (this.rank[rootA] === this.rank[rootB]) this.rank[rootA]++;
  }
}

function connectedGroups(projects, pairs) {
  const unionFind = new UnionFind(projects.length);
  for (const pair of pairs) unionFind.union(pair.left, pair.right);
  return [...groupsBy(projects.map((project, index) => ({ project, index })), item => unionFind.find(item.index)).values()]
    .map(group => group.map(item => item.project))
    .sort((a, b) => b.length - a.length || a[0].name.localeCompare(b[0].name));
}

function ratio(numerator, denominator) {
  return denominator === 0 ? null : numerator / denominator;
}

function detectionRates(projects) {
  const completed = projects.filter(project => project.report !== null);
  const count = predicate => completed.filter(predicate).length;
  return {
    projects: projects.length,
    completedReports: completed.length,
    withApi: count(project => project.report.apiUsages > 0),
    withChain: count(project => project.report.chainsWithPath > 0),
    withSink: count(project => project.report.sinks > 0),
    withTaint: count(project => project.report.taintFlows > 0),
    apiRate: ratio(count(project => project.report.apiUsages > 0), completed.length),
    chainRate: ratio(count(project => project.report.chainsWithPath > 0), completed.length),
    sinkRate: ratio(count(project => project.report.sinks > 0), completed.length),
    taintRate: ratio(count(project => project.report.taintFlows > 0), completed.length),
  };
}

function representatives(groups) {
  return groups.map(group => [...group].sort((a, b) => a.name.localeCompare(b.name))[0]);
}

function percent(value) {
  return value === null ? 'N/A' : `${(value * 100).toFixed(2)}%`;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const datasetDir = path.resolve(args.dataset);
  const reportRoot = path.resolve(args.reports);
  const benchmark = readJson(path.resolve(args.benchmark));
  const reviewed = new Set((benchmark.projects || []).map(project => project.projectName));
  const excludedProjects = new Set(
    String(args['exclude-projects'] || '')
      .split(',')
      .map(value => value.trim())
      .filter(Boolean),
  );
  const projectDirs = fs.readdirSync(datasetDir, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && !excludedProjects.has(entry.name))
    .map(entry => entry.name)
    .sort((a, b) => a.localeCompare(b));

  const fileFrequency = new Map();
  const projects = [];
  for (let index = 0; index < projectDirs.length; index++) {
    const name = projectDirs[index];
    const root = path.join(datasetDir, name);
    const files = sourceFiles(root);
    const source = files.map(filePath => ({
      relativePath: path.relative(root, filePath).replace(/\\/g, '/'),
      ...tokenFingerprint(filePath),
    }));
    for (const hash of new Set(source.map(file => file.hash))) {
      fileFrequency.set(hash, (fileFrequency.get(hash) || 0) + 1);
    }
    projects.push({
      name,
      reviewed: reviewed.has(name),
      source,
      report: summarizeReport(reportPath(reportRoot, name)),
    });
    if ((index + 1) % 100 === 0) console.log(`[CORPUS] Fingerprinted ${index + 1}/${projectDirs.length}`);
  }

  const commonThreshold = Math.ceil(projects.length * 0.05);
  for (const project of projects) {
    project.fileCount = project.source.length;
    project.tokenCount = project.source.reduce((sum, file) => sum + file.tokens, 0);
    project.lineCount = project.source.reduce((sum, file) => sum + file.lines, 0);
    project.allHashes = project.source.map(file => file.hash).sort();
    project.rareHashes = new Set(project.allHashes.filter(hash => fileFrequency.get(hash) < commonThreshold));
    project.exactSignature = sha256(project.allHashes.join('\n'));
  }

  const exactGroups = [...groupsBy(projects, project => project.exactSignature).values()]
    .sort((a, b) => b.length - a.length || a[0].name.localeCompare(b[0].name));
  const nearPairs = [];
  for (let left = 0; left < projects.length; left++) {
    for (let right = left + 1; right < projects.length; right++) {
      const similarity = jaccard(projects[left].rareHashes, projects[right].rareHashes);
      if (
        similarity.score >= 0.8
        && (similarity.intersection >= 2 || projects[left].exactSignature === projects[right].exactSignature)
      ) {
        nearPairs.push({
          left,
          right,
          similarity: similarity.score,
          sharedRareFiles: similarity.intersection,
        });
      }
    }
  }
  const nearGroups = connectedGroups(projects, nearPairs);
  const duplicateFileGroups = [...groupsBy(
    projects.flatMap(project => project.source.map(file => ({ project: project.name, ...file }))),
    file => file.hash,
  ).values()].filter(group => group.length > 1);
  const exactDuplicateGroups = exactGroups.filter(group => group.length > 1);
  const nearDuplicateGroups = nearGroups.filter(group => group.length > 1);
  const exactRepresentatives = representatives(exactGroups);
  const nearRepresentatives = representatives(nearGroups);
  const allFiles = projects.flatMap(project => project.source);
  const reviewedProjects = projects.filter(project => project.reviewed);

  const result = {
    generatedAt: new Date().toISOString(),
    definitions: {
      sourceFingerprint: 'SHA-256 of TypeScript scanner tokens after removing comments and trivia; identifiers and literals are preserved.',
      exactProjectClone: 'Projects with the same multiset of source-file token fingerprints.',
      boilerplateFile: `A source fingerprint appearing in at least ${commonThreshold} projects (5% of the corpus).`,
      nearProjectClone: 'Connected component of project pairs with Jaccard similarity >= 0.80 over non-boilerplate file fingerprints and at least two shared non-boilerplate files.',
    },
    corpus: {
      projects: projects.length,
      excludedProjects: [...excludedProjects].sort(),
      sourceFiles: allFiles.length,
      sourceLines: allFiles.reduce((sum, file) => sum + file.lines, 0),
      sourceTokens: allFiles.reduce((sum, file) => sum + file.tokens, 0),
      uniqueSourceFingerprints: new Set(allFiles.map(file => file.hash)).size,
      duplicatedFileOccurrences: allFiles.length - new Set(allFiles.map(file => file.hash)).size,
      duplicateFileGroups: duplicateFileGroups.length,
      exactProjectClusters: exactGroups.length,
      exactDuplicateClusters: exactDuplicateGroups.length,
      exactDuplicateProjects: exactDuplicateGroups.reduce((sum, group) => sum + group.length, 0),
      nearProjectClusters: nearGroups.length,
      nearDuplicateClusters: nearDuplicateGroups.length,
      nearDuplicateProjects: nearDuplicateGroups.reduce((sum, group) => sum + group.length, 0),
      commonFileFingerprints: [...fileFrequency.values()].filter(count => count >= commonThreshold).length,
    },
    detectionSensitivity: {
      raw: detectionRates(projects),
      onePerExactCloneCluster: detectionRates(exactRepresentatives),
      onePerNearCloneCluster: detectionRates(nearRepresentatives),
      reviewedTop120: detectionRates(reviewedProjects),
    },
    benchmarkSampling: {
      requestedProjects: reviewed.size,
      matchedProjects: reviewedProjects.length,
      exactClustersCovered: new Set(reviewedProjects.map(project => project.exactSignature)).size,
      nearClustersCovered: new Set(reviewedProjects.map(project => nearGroups.findIndex(group => group.includes(project)))).size,
      reviewedProjectsInExactDuplicateClusters: reviewedProjects.filter(project => exactGroups.find(group => group.includes(project)).length > 1).length,
      reviewedProjectsInNearDuplicateClusters: reviewedProjects.filter(project => nearGroups.find(group => group.includes(project)).length > 1).length,
    },
    largestExactCloneClusters: exactDuplicateGroups.slice(0, 20).map(group => ({
      size: group.length,
      projects: group.map(project => project.name),
      reviewed: group.filter(project => project.reviewed).length,
    })),
    largestNearCloneClusters: nearDuplicateGroups.slice(0, 20).map(group => ({
      size: group.length,
      projects: group.map(project => project.name),
      reviewed: group.filter(project => project.reviewed).length,
    })),
    projectStatistics: projects.map(project => ({
      name: project.name,
      reviewed: project.reviewed,
      sourceFiles: project.fileCount,
      sourceLines: project.lineCount,
      sourceTokens: project.tokenCount,
      rareFileFingerprints: project.rareHashes.size,
      exactCloneClusterSize: exactGroups.find(group => group.includes(project)).length,
      nearCloneClusterSize: nearGroups.find(group => group.includes(project)).length,
      report: project.report,
    })),
  };

  const outputDir = path.resolve(args.output);
  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(path.join(outputDir, 'corpus_redundancy.json'), `${JSON.stringify(result, null, 2)}\n`);

  const c = result.corpus;
  const d = result.detectionSensitivity;
  const markdown = [
    '# Corpus Redundancy and Sensitivity Analysis',
    '',
    '## Corpus structure',
    '',
    '| Projects | Source files | Unique token fingerprints | Duplicate file occurrences | Exact clone clusters | Near-clone clusters |',
    '|---:|---:|---:|---:|---:|---:|',
    `| ${c.projects} | ${c.sourceFiles} | ${c.uniqueSourceFingerprints} | ${c.duplicatedFileOccurrences} | ${c.exactDuplicateClusters} | ${c.nearDuplicateClusters} |`,
    '',
    '## Detection-rate sensitivity',
    '',
    '| Sampling unit | N | API | Call chain | Sink | Taint flow |',
    '|---|---:|---:|---:|---:|---:|',
    `| Project | ${d.raw.completedReports} | ${percent(d.raw.apiRate)} | ${percent(d.raw.chainRate)} | ${percent(d.raw.sinkRate)} | ${percent(d.raw.taintRate)} |`,
    `| One per exact-clone cluster | ${d.onePerExactCloneCluster.completedReports} | ${percent(d.onePerExactCloneCluster.apiRate)} | ${percent(d.onePerExactCloneCluster.chainRate)} | ${percent(d.onePerExactCloneCluster.sinkRate)} | ${percent(d.onePerExactCloneCluster.taintRate)} |`,
    `| One per near-clone cluster | ${d.onePerNearCloneCluster.completedReports} | ${percent(d.onePerNearCloneCluster.apiRate)} | ${percent(d.onePerNearCloneCluster.chainRate)} | ${percent(d.onePerNearCloneCluster.sinkRate)} | ${percent(d.onePerNearCloneCluster.taintRate)} |`,
    '',
    'The deduplicated rows are sensitivity analyses, not replacements for the project-level census.',
    '',
  ].join('\n');
  fs.writeFileSync(path.join(outputDir, 'corpus_redundancy.md'), `${markdown}\n`);
  console.log(markdown);
}

main();
