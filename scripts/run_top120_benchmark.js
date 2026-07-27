'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

function parseArgs(argv) {
  const args = {
    benchmark: path.resolve('benchmarks', 'ArkPrismTop120', 'annotations.json'),
    dataset: '',
    outputDir: '',
    sdkPath: '',
    concurrency: 2,
    timeoutMs: 30 * 60 * 1000,
    nodeOptions: '--max-old-space-size=8192',
    noDot: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--benchmark') args.benchmark = path.resolve(argv[++index] || '');
    else if (token === '--dataset') args.dataset = path.resolve(argv[++index] || '');
    else if (token === '--output-dir') args.outputDir = path.resolve(argv[++index] || '');
    else if (token === '--sdkPath') args.sdkPath = path.resolve(argv[++index] || '');
    else if (token === '--concurrency') args.concurrency = Number(argv[++index]);
    else if (token === '--timeout-ms') args.timeoutMs = Number(argv[++index]);
    else if (token === '--node-options') args.nodeOptions = argv[++index] || '';
    else if (token === '--no-dot') args.noDot = true;
    else if (token === '--help' || token === '-h') {
      console.log([
        'Usage:',
        '  node scripts/run_top120_benchmark.js --dataset <dir> --output-dir <dir>',
        '    --sdkPath <OpenHarmony SDK ets dir> [options]',
        '',
        'Runs the exact 120-project API-localization benchmark in detector-only mode.',
        'JSON reports and DOT graphs are retained unless --no-dot is specified.',
      ].join('\n'));
      process.exit(0);
    } else throw new Error(`Unknown argument: ${token}`);
  }
  for (const required of ['dataset', 'outputDir', 'sdkPath']) {
    if (!args[required]) throw new Error(`--${required === 'outputDir' ? 'output-dir' : required} is required`);
  }
  if (!Number.isInteger(args.concurrency) || args.concurrency < 1) {
    throw new Error(`Invalid concurrency: ${args.concurrency}`);
  }
  if (!Number.isInteger(args.timeoutMs) || args.timeoutMs <= 0) {
    throw new Error(`Invalid timeout: ${args.timeoutMs}`);
  }
  return args;
}

function buildRunnerArgs(args, projects) {
  const runner = path.resolve('scripts', 'run_argus_batch_isolated.js');
  const logDir = path.join(args.outputDir, 'logs');
  const runnerArgs = [
    runner,
    '--dataset', args.dataset,
    '--output-dir', args.outputDir,
    '--log-dir', logDir,
    '--sdkPath', args.sdkPath,
    '--engine', 'compiled',
    '--concurrency', String(args.concurrency),
    '--timeout-ms', String(args.timeoutMs),
    '--node-options', args.nodeOptions,
    '--max-attempts', '1',
  ];
  for (const project of projects) runnerArgs.push('--include-project', project);
  runnerArgs.push('--', '--no-taint');
  if (args.noDot) runnerArgs.push('--no-dot');
  return runnerArgs;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  for (const [label, target] of [
    ['benchmark', args.benchmark],
    ['dataset', args.dataset],
    ['SDK', args.sdkPath],
    ['compiled entry', path.resolve('dist', 'arkprism.js')],
  ]) {
    if (!fs.existsSync(target)) throw new Error(`${label} does not exist: ${target}`);
  }
  const benchmark = JSON.parse(fs.readFileSync(args.benchmark, 'utf8').replace(/^\uFEFF/, ''));
  const projects = (benchmark.projects || []).map(project => project.projectName);
  if (projects.length !== 120 || new Set(projects).size !== 120) {
    throw new Error(`Expected 120 unique benchmark projects, found ${projects.length}`);
  }
  const missing = projects.filter(project => !fs.existsSync(path.join(args.dataset, project)));
  if (missing.length > 0) throw new Error(`Missing benchmark projects: ${missing.join(', ')}`);
  if (fs.existsSync(args.outputDir) && fs.readdirSync(args.outputDir).length > 0) {
    throw new Error(`Output directory must be empty or absent: ${args.outputDir}`);
  }
  fs.mkdirSync(args.outputDir, { recursive: true });
  const result = spawnSync(process.execPath, buildRunnerArgs(args, projects), {
    cwd: path.resolve('.'),
    stdio: 'inherit',
    env: process.env,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

if (require.main === module) main();

module.exports = { buildRunnerArgs, parseArgs };
