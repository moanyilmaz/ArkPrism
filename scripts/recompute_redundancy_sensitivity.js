const fs = require('fs');
const path = require('path');

function parseArgs(argv) {
  const args = { redundancy: '', summary: '', output: '' };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === '--redundancy') args.redundancy = argv[++index] || '';
    else if (arg === '--summary') args.summary = argv[++index] || '';
    else if (arg === '--output') args.output = argv[++index] || '';
    else if (arg === '--help' || arg === '-h') {
      console.log([
        'Usage:',
        '  node scripts/recompute_redundancy_sensitivity.js',
        '    --redundancy <corpus_redundancy.json>',
        '    --summary <large_corpus_summary.json>',
        '    --output <redundancy_sensitivity.json>',
      ].join('\n'));
      process.exit(0);
    }
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!args.redundancy || !args.summary || !args.output) {
    throw new Error('--redundancy, --summary, and --output are required');
  }
  return args;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, ''));
}

function rates(projects) {
  const count = field => projects.filter(project => Number(project[field] || 0) > 0).length;
  const total = projects.length;
  const result = {
    projects: total,
    withApi: count('apis'),
    withChain: count('chains'),
    withSink: count('sinks'),
    withTaint: count('taintFlows'),
  };
  return {
    ...result,
    apiRate: result.withApi / total,
    chainRate: result.withChain / total,
    sinkRate: result.withSink / total,
    taintRate: result.withTaint / total,
  };
}

function representatives(projects, duplicateClusters) {
  const byName = new Map(projects.map(project => [project.projectName, project]));
  const clustered = new Set(duplicateClusters.flatMap(cluster => cluster.projects));
  const result = projects.filter(project => !clustered.has(project.projectName));
  for (const cluster of duplicateClusters) {
    const representative = [...cluster.projects]
      .sort((left, right) => left.localeCompare(right))
      .map(project => byName.get(project))
      .find(Boolean);
    if (representative) result.push(representative);
  }
  return result;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const redundancy = readJson(args.redundancy);
  const summary = readJson(args.summary);
  const projects = summary.projects;
  const exact = representatives(projects, redundancy.largestExactCloneClusters);
  const near = representatives(projects, redundancy.largestNearCloneClusters);

  const result = {
    generatedAt: new Date().toISOString(),
    sourceRedundancyAnalysis: path.resolve(args.redundancy),
    projectedCorpusSummary: path.resolve(args.summary),
    projectedCorpusTraceability: summary.traceability || null,
    corpusStructure: redundancy.corpus,
    definition:
      `Clone membership is retained from the token-fingerprint analysis; detector, sink, and taint rates are recomputed from the ${projects.length}-project summary.`,
    detectionSensitivity: {
      project: rates(projects),
      onePerExactCloneCluster: rates(exact),
      onePerNearCloneCluster: rates(near),
    },
    largestExactCloneClusters: redundancy.largestExactCloneClusters,
    largestNearCloneClusters: redundancy.largestNearCloneClusters,
  };
  const outputPath = path.resolve(args.output);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify(result.detectionSensitivity, null, 2));
}

if (require.main === module) {
  main();
}

module.exports = {
  rates,
  representatives,
};
