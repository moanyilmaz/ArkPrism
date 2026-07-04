const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

function usage() {
  console.log([
    'Usage:',
    '  node scripts/run_argus_batch_isolated.js --dataset <dir> --output-dir <dir> --sdkPath <dir> [options] -- [arkprism args]',
    '',
    'Options:',
    '  --dataset <dir>       Dataset directory containing one subdirectory per sample',
    '  --output-dir <dir>    ArkPrism output directory',
    '  --sdkPath <dir>       OpenHarmony SDK ets directory',
    '  --log-dir <dir>       Per-sample log directory (default: logs/argus1015_validated_20260704_isolated)',
    '  --timeout-ms <n>      Per-sample wall-clock timeout (default: 1800000)',
    '  --node-options <str>  NODE_OPTIONS for child processes (default: --max-old-space-size=12288)',
    '  --concurrency <n>     Number of samples to run concurrently (default: 1)',
    '  --resume             Skip samples whose report JSON already exists',
    '  --prior-log <file>    Recover duration for skipped samples from a previous batch log',
    '  --help               Show this help message',
  ].join('\n'));
}

function parseArgs(argv) {
  const args = {
    dataset: '',
    outputDir: '',
    sdkPath: '',
    logDir: path.join('logs', 'argus1015_validated_20260704_isolated'),
    timeoutMs: 30 * 60 * 1000,
    nodeOptions: '--max-old-space-size=12288',
    concurrency: 1,
    resume: false,
    priorLog: '',
    arkArgs: [],
  };

  const passthrough = argv.indexOf('--');
  const ownArgs = passthrough >= 0 ? argv.slice(0, passthrough) : argv;
  args.arkArgs = passthrough >= 0 ? argv.slice(passthrough + 1) : [];

  for (let i = 0; i < ownArgs.length; i++) {
    const arg = ownArgs[i];
    if (arg === '--dataset') args.dataset = ownArgs[++i] || '';
    else if (arg === '--output-dir') args.outputDir = ownArgs[++i] || '';
    else if (arg === '--sdkPath') args.sdkPath = ownArgs[++i] || '';
    else if (arg === '--log-dir') args.logDir = ownArgs[++i] || args.logDir;
    else if (arg === '--timeout-ms') args.timeoutMs = Number(ownArgs[++i]) || args.timeoutMs;
    else if (arg === '--node-options') args.nodeOptions = ownArgs[++i] || args.nodeOptions;
    else if (arg === '--concurrency') args.concurrency = Math.max(1, Number(ownArgs[++i]) || args.concurrency);
    else if (arg === '--resume') args.resume = true;
    else if (arg === '--prior-log') args.priorLog = ownArgs[++i] || '';
    else if (arg === '--help' || arg === '-h') {
      usage();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!args.dataset || !args.outputDir || !args.sdkPath) {
    usage();
    process.exit(1);
  }
  return args;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, ''));
}

function findReport(outputDir, projectName) {
  const reportPath = path.join(outputDir, projectName, `${projectName}-arkprism-report.json`);
  return fs.existsSync(reportPath) ? reportPath : '';
}

function countDataSinks(report) {
  return (report.callChains || []).reduce((sum, chain) => sum + ((chain.dataSinks || []).length), 0);
}

function summarizeReport(projectName, reportPath, durationMs, extra = {}) {
  const report = readJson(reportPath);
  const stats = report.statistics || {};
  const chains = report.callChains || [];
  const chainsWithPath = chains.filter(chain => (chain.chain || []).length > 0 || chain.entryMethod).length;
  const apiCount = (report.privacyApiUsages || []).length;
  return {
    projectName,
    files: stats.totalFilesAnalyzed || 0,
    methods: stats.totalMethodsAnalyzed || 0,
    apis: apiCount,
    chainsWithPath,
    chainsTotal: chains.length,
    chainRate: apiCount > 0 ? `${(chainsWithPath / apiCount * 100).toFixed(1)}%` : 'N/A',
    collaborations: stats.totalCollaborationsDetected || (report.collaborativeBehaviors || []).length || 0,
    permissions: (report.permissionUsages || []).length,
    dataSinks: countDataSinks(report),
    durationMs,
    ...extra,
  };
}

function recoverDurations(priorLogPath) {
  const durations = new Map();
  if (!priorLogPath || !fs.existsSync(priorLogPath)) return durations;

  const lines = fs.readFileSync(priorLogPath, 'utf8').split(/\r?\n/);
  let currentProject = '';
  for (const line of lines) {
    const projectMatch = line.match(/^\[\d+\/\d+\]\s+(.+?)\s*$/);
    if (projectMatch) {
      currentProject = projectMatch[1].trim();
      continue;
    }
    const doneMatch = line.match(/^\s+APIs:\s+\d+,\s+Chains:.*,\s+Time:\s+([0-9.]+)s\s*$/);
    if (currentProject && doneMatch) {
      durations.set(currentProject, Math.round(Number(doneMatch[1]) * 1000));
      currentProject = '';
    }
  }
  return durations;
}

function runProject(projectName, projectDir, args, index, total) {
  return new Promise(resolve => {
    const logPath = path.join(args.logDir, `${String(index + 1).padStart(4, '0')}-${projectName}.log`);
    const logStream = fs.createWriteStream(logPath, { flags: 'w' });
    const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
    const childArgs = [
      'ts-node',
      'src/arkprism.ts',
      projectDir,
      '--output-dir',
      args.outputDir,
      '--sdkPath',
      args.sdkPath,
      ...args.arkArgs,
    ];

    const env = { ...process.env, NODE_OPTIONS: args.nodeOptions };
    const startedAt = Date.now();
    logStream.write(`[RUNNER] [${index + 1}/${total}] ${projectName}\n`);
    logStream.write(`[RUNNER] Command: ${npx} ${childArgs.map(arg => JSON.stringify(arg)).join(' ')}\n\n`);

    let child;
    try {
      child = spawn(npx, childArgs, {
        cwd: process.cwd(),
        env,
        shell: process.platform === 'win32',
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (error) {
      const durationMs = Date.now() - startedAt;
      logStream.write(`\n[RUNNER][SPAWN_ERROR] ${error.stack || error.message || String(error)}\n`);
      logStream.end();
      resolve({ projectName, error: error.message || String(error), durationMs, timedOut: false, logPath });
      return;
    }

    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      logStream.write(`\n[RUNNER][TIMEOUT] Exceeded ${args.timeoutMs}ms, terminating child process.\n`);
      child.kill('SIGKILL');
    }, args.timeoutMs);

    child.stdout.pipe(logStream, { end: false });
    child.stderr.pipe(logStream, { end: false });

    child.on('error', error => {
      clearTimeout(timer);
      const durationMs = Date.now() - startedAt;
      logStream.write(`\n[RUNNER][ERROR] ${error.stack || error.message || String(error)}\n`);
      logStream.end();
      resolve({ projectName, error: error.message || String(error), durationMs, timedOut: false, logPath });
    });

    child.on('close', code => {
      clearTimeout(timer);
      const durationMs = Date.now() - startedAt;
      const reportPath = findReport(args.outputDir, projectName);
      logStream.write(`\n[RUNNER] Exit code: ${code}, durationMs=${durationMs}\n`);
      logStream.end();

      if (timedOut) {
        resolve({ projectName, error: 'TIMEOUT', durationMs, timedOut: true, logPath });
      } else if (code !== 0) {
        resolve({ projectName, error: `EXIT_${code}`, durationMs, timedOut: false, logPath });
      } else if (!reportPath) {
        resolve({ projectName, error: 'REPORT_MISSING', durationMs, timedOut: false, logPath });
      } else {
        try {
          resolve(summarizeReport(projectName, reportPath, durationMs, { logPath }));
        } catch (error) {
          resolve({ projectName, error: `REPORT_PARSE_FAILED: ${error.message}`, durationMs, timedOut: false, logPath });
        }
      }
    });
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const datasetDir = path.resolve(args.dataset);
  const outputDir = path.resolve(args.outputDir);
  args.outputDir = outputDir;
  args.sdkPath = path.resolve(args.sdkPath);
  args.logDir = path.resolve(args.logDir);

  fs.mkdirSync(outputDir, { recursive: true });
  fs.mkdirSync(args.logDir, { recursive: true });

  const projects = fs.readdirSync(datasetDir, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name)
    .sort((a, b) => a.localeCompare(b));
  const recoveredDurations = recoverDurations(args.priorLog);
  const results = new Array(projects.length);

  console.log(`[RUNNER] Dataset: ${datasetDir}`);
  console.log(`[RUNNER] Projects: ${projects.length}`);
  console.log(`[RUNNER] Output: ${outputDir}`);
  console.log(`[RUNNER] Logs: ${args.logDir}`);
  console.log(`[RUNNER] Resume: ${args.resume}`);
  console.log(`[RUNNER] Concurrency: ${args.concurrency}`);

  function writeSummary() {
    const summaryPath = path.join(outputDir, 'batch_summary.json');
    fs.writeFileSync(summaryPath, `${JSON.stringify(results.filter(Boolean), null, 2)}\n`, 'utf8');
  }

  let nextIndex = 0;
  async function worker() {
    while (true) {
      const i = nextIndex++;
      if (i >= projects.length) return;

      const projectName = projects[i];
      const projectDir = path.join(datasetDir, projectName);
      const existingReport = findReport(outputDir, projectName);

      if (args.resume && existingReport) {
        const durationMs = recoveredDurations.get(projectName) || 0;
        const result = summarizeReport(projectName, existingReport, durationMs, { skipped: true });
        results[i] = result;
        console.log(`[RUNNER] [${i + 1}/${projects.length}] ${projectName} SKIP apis=${result.apis} chains=${result.chainsWithPath}/${result.chainsTotal}`);
      } else {
        console.log(`[RUNNER] [${i + 1}/${projects.length}] ${projectName} RUN`);
        const result = await runProject(projectName, projectDir, args, i, projects.length);
        results[i] = result;
        if (result.error) {
          console.log(`[RUNNER] [${i + 1}/${projects.length}] ${projectName} ERROR ${result.error} time=${(result.durationMs / 1000).toFixed(1)}s`);
        } else {
          console.log(`[RUNNER] [${i + 1}/${projects.length}] ${projectName} DONE apis=${result.apis} chains=${result.chainsWithPath}/${result.chainsTotal} sinks=${result.dataSinks} time=${(result.durationMs / 1000).toFixed(1)}s`);
        }
      }
      writeSummary();
    }
  }

  await Promise.all(Array.from({ length: args.concurrency }, () => worker()));

  const finalResults = results.filter(Boolean);
  const errors = finalResults.filter(result => result.error);
  const completed = finalResults.length - errors.length;
  console.log(`[RUNNER] Complete: ${completed}/${finalResults.length}, errors=${errors.length}`);
  if (errors.length > 0) {
    console.log('[RUNNER] Error projects:');
    for (const error of errors) console.log(`  - ${error.projectName}: ${error.error}`);
  }
}

main().catch(error => {
  console.error(error.stack || error.message || String(error));
  process.exit(1);
});
