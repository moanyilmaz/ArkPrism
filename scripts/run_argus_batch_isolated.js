const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync, spawn } = require('child_process');

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
    '  --engine <name>       compiled or ts-node (default: compiled)',
    '  --max-attempts <n>    Attempts per sample for process/report failures (default: 2)',
    '  --retry-delay-ms <n>  Delay before a retry (default: 2000)',
    '  --include-project <name>  Analyze only this project directory (repeatable)',
    '  --exclude-project <name>  Exclude one project directory (repeatable)',
    '  --sdk-fingerprint-cache <file>  Reuse a content fingerprint for this SDK root',
    '  --refresh-sdk-fingerprint      Recompute the SDK content fingerprint',
    '  --disable-continuation-flow    Disable Promise continuation IFDS flow',
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
    engine: 'compiled',
    maxAttempts: 2,
    retryDelayMs: 2000,
    includeProjects: [],
    excludeProjects: [],
    sdkFingerprintCache: '',
    refreshSdkFingerprint: false,
    disableContinuationFlow: false,
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
    else if (arg === '--engine') args.engine = ownArgs[++i] || args.engine;
    else if (arg === '--max-attempts') args.maxAttempts = Math.max(1, Number(ownArgs[++i]) || args.maxAttempts);
    else if (arg === '--retry-delay-ms') args.retryDelayMs = Math.max(0, Number(ownArgs[++i]) || 0);
    else if (arg === '--include-project') {
      const projectName = ownArgs[++i] || '';
      if (!projectName) throw new Error('--include-project requires a project directory name');
      args.includeProjects.push(projectName);
    }
    else if (arg === '--exclude-project') {
      const projectName = ownArgs[++i] || '';
      if (!projectName) throw new Error('--exclude-project requires a project directory name');
      args.excludeProjects.push(projectName);
    }
    else if (arg === '--sdk-fingerprint-cache') args.sdkFingerprintCache = ownArgs[++i] || '';
    else if (arg === '--refresh-sdk-fingerprint') args.refreshSdkFingerprint = true;
    else if (arg === '--disable-continuation-flow') args.disableContinuationFlow = true;
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
  if (!['compiled', 'ts-node'].includes(args.engine)) {
    throw new Error(`Unsupported engine: ${args.engine}`);
  }
  return args;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, ''));
}

function hashFile(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function hashDirectory(root) {
  const files = [];
  const stack = [root];
  while (stack.length > 0) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(fullPath);
      else if (entry.isFile()) files.push(fullPath);
    }
  }
  files.sort((left, right) => left.localeCompare(right));
  const hash = crypto.createHash('sha256');
  let bytes = 0;
  for (const filePath of files) {
    const relative = path.relative(root, filePath).replace(/\\/g, '/');
    const content = fs.readFileSync(filePath);
    hash.update(relative);
    hash.update('\0');
    hash.update(content);
    hash.update('\0');
    bytes += content.length;
  }
  return { sha256: hash.digest('hex'), files: files.length, bytes };
}

function directoryFingerprint(root, cachePath, refresh) {
  const resolvedRoot = path.resolve(root);
  const resolvedCache = path.resolve(cachePath);
  if (!refresh && fs.existsSync(resolvedCache)) {
    const cached = readJson(resolvedCache);
    if (path.resolve(cached.root || '') !== resolvedRoot) {
      throw new Error(`SDK fingerprint cache root mismatch: ${cached.root}`);
    }
    return {
      sha256: cached.sha256,
      files: cached.files,
      bytes: cached.bytes,
      cache: resolvedCache,
      cacheHit: true,
    };
  }

  const fingerprint = hashDirectory(resolvedRoot);
  const cached = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    root: resolvedRoot,
    ...fingerprint,
  };
  fs.mkdirSync(path.dirname(resolvedCache), { recursive: true });
  fs.writeFileSync(resolvedCache, `${JSON.stringify(cached, null, 2)}\n`, 'utf8');
  return {
    ...fingerprint,
    cache: resolvedCache,
    cacheHit: false,
  };
}

function gitMetadata() {
  try {
    const revision = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: process.cwd(),
      encoding: 'utf8',
      windowsHide: true,
    }).trim();
    const status = execFileSync('git', ['status', '--porcelain', '--untracked-files=no'], {
      cwd: process.cwd(),
      encoding: 'utf8',
      windowsHide: true,
    }).trim();
    return { revision, trackedFilesDirty: status.length > 0 };
  } catch {
    return { revision: 'unknown', trackedFilesDirty: null };
  }
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
  const { requireCompleteTaint = false, ...summaryExtra } = extra;
  if (requireCompleteTaint) {
    if (!report.taintAnalysis) {
      throw new Error('TAINT_METADATA_MISSING');
    }
    if (report.taintAnalysis.status !== 'SUCCESS') {
      throw new Error(`TAINT_${report.taintAnalysis.status || 'STATUS_MISSING'}`);
    }
    if (report.taintAnalysis.pointerAnalysis?.requested
      && report.taintAnalysis.pointerAnalysis.status !== 'SUCCESS') {
      throw new Error(`PTA_${report.taintAnalysis.pointerAnalysis.status || 'STATUS_MISSING'}`);
    }
    for (const [index, flow] of (report.taintFlows || []).entries()) {
      if (!['privacy_data', 'framework_input'].includes(flow.sourceKind)) {
        throw new Error(`TAINT_FLOW_${index}_SOURCE_KIND_INVALID`);
      }
      if (!['ifds', 'async_supplement', 'both'].includes(flow.provenance)) {
        throw new Error(`TAINT_FLOW_${index}_PROVENANCE_INVALID`);
      }
      const identity = flow.sourceIdentity;
      if (!identity
        || !identity.apiName
        || !identity.methodSignature
        || !['return', 'callback', 'ArgIn'].includes(identity.sourceType)) {
        throw new Error(`TAINT_FLOW_${index}_SOURCE_IDENTITY_INVALID`);
      }
      if (!Array.isArray(flow.path)
        || flow.path.length === 0
        || flow.path[0].statement !== flow.sourceApi) {
        throw new Error(`TAINT_FLOW_${index}_SOURCE_ENDPOINT_INVALID`);
      }
    }
  }
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
    ...summaryExtra,
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

function runProjectOnce(projectName, projectDir, args, index, total, attempt) {
  return new Promise(resolve => {
    const logPath = path.join(args.logDir, `${String(index + 1).padStart(4, '0')}-${projectName}.log`);
    const logStream = fs.createWriteStream(logPath, { flags: attempt === 1 ? 'w' : 'a' });
    const compiled = args.engine === 'compiled';
    const executable = compiled
      ? process.execPath
      : (process.platform === 'win32' ? 'npx.cmd' : 'npx');
    const childArgs = [
      ...(compiled ? ['dist/arkprism.js'] : ['ts-node', 'src/arkprism.ts']),
      projectDir,
      '--output-dir',
      args.outputDir,
      '--sdkPath',
      args.sdkPath,
      ...args.arkArgs,
    ];

    const env = {
      ...process.env,
      NODE_OPTIONS: args.nodeOptions,
      ARKPRISM_DISABLE_CONTINUATION_FLOW: args.disableContinuationFlow
        ? '1'
        : (process.env.ARKPRISM_DISABLE_CONTINUATION_FLOW || '0'),
    };
    const startedAt = Date.now();
    logStream.write(`[RUNNER] [${index + 1}/${total}] ${projectName} attempt=${attempt}/${args.maxAttempts}\n`);
    logStream.write(`[RUNNER] Command: ${executable} ${childArgs.map(arg => JSON.stringify(arg)).join(' ')}\n\n`);

    let child;
    try {
      child = spawn(executable, childArgs, {
        cwd: process.cwd(),
        env,
        shell: !compiled && process.platform === 'win32',
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
          resolve(summarizeReport(projectName, reportPath, durationMs, {
            logPath,
            attempts: attempt,
            requireCompleteTaint: !args.arkArgs.includes('--no-taint'),
          }));
        } catch (error) {
          resolve({ projectName, error: `REPORT_PARSE_FAILED: ${error.message}`, durationMs, timedOut: false, logPath });
        }
      }
    });
  });
}

function delay(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

async function runProject(projectName, projectDir, args, index, total) {
  let result;
  for (let attempt = 1; attempt <= args.maxAttempts; attempt++) {
    result = await runProjectOnce(projectName, projectDir, args, index, total, attempt);
    if (!result.error || result.timedOut || attempt === args.maxAttempts) return result;
    console.log(
      `[RUNNER] [${index + 1}/${total}] ${projectName} RETRY `
      + `${attempt + 1}/${args.maxAttempts} after ${result.error}`,
    );
    await delay(args.retryDelayMs);
  }
  return result;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const datasetDir = path.resolve(args.dataset);
  const outputDir = path.resolve(args.outputDir);
  args.outputDir = outputDir;
  args.sdkPath = path.resolve(args.sdkPath);
  args.logDir = path.resolve(args.logDir);
  if (!args.sdkFingerprintCache) {
    const cacheKey = crypto.createHash('sha256').update(args.sdkPath).digest('hex').slice(0, 16);
    args.sdkFingerprintCache = path.resolve('experiments', '.cache', `sdk-${cacheKey}.json`);
  }
  if (args.engine === 'compiled' && !fs.existsSync(path.resolve('dist', 'arkprism.js'))) {
    throw new Error('dist/arkprism.js is missing; run npm run build before using --engine compiled');
  }

  fs.mkdirSync(outputDir, { recursive: true });
  fs.mkdirSync(args.logDir, { recursive: true });

  const datasetProjects = fs.readdirSync(datasetDir, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name)
    .sort((a, b) => a.localeCompare(b));
  const includedProjects = [...new Set(args.includeProjects)].sort((a, b) => a.localeCompare(b));
  const excludedProjects = [...new Set(args.excludeProjects)].sort((a, b) => a.localeCompare(b));
  const datasetProjectSet = new Set(datasetProjects);
  const missingInclusions = includedProjects.filter(projectName => !datasetProjectSet.has(projectName));
  const missingExclusions = excludedProjects.filter(projectName => !datasetProjectSet.has(projectName));
  if (missingInclusions.length > 0) {
    throw new Error(`Included project directories do not exist: ${missingInclusions.join(', ')}`);
  }
  if (missingExclusions.length > 0) {
    throw new Error(`Excluded project directories do not exist: ${missingExclusions.join(', ')}`);
  }
  const includedProjectSet = new Set(includedProjects);
  const excludedProjectSet = new Set(excludedProjects);
  const projects = datasetProjects.filter(projectName =>
    (includedProjectSet.size === 0 || includedProjectSet.has(projectName))
      && !excludedProjectSet.has(projectName)
  );
  if (projects.length === 0) {
    throw new Error('Project selection is empty');
  }
  const recoveredDurations = recoverDurations(args.priorLog);
  const existingSummaryPath = path.join(outputDir, 'batch_summary.json');
  if (args.resume && fs.existsSync(existingSummaryPath)) {
    for (const item of readJson(existingSummaryPath)) {
      if (item.projectName && Number(item.durationMs) > 0) {
        recoveredDurations.set(item.projectName, Number(item.durationMs));
      }
    }
  }
  const results = new Array(projects.length);
  const startedAt = new Date().toISOString();
  const relevantConfigs = [
    'sensitive_apis.json',
    'package_aliases.json',
    'data_sinks.json',
    'hapflow_sources.json',
    'hapflow_sinks.json',
    'lifecycle_sources.json',
  ];
  const configHashes = Object.fromEntries(relevantConfigs.map(name => {
    const filePath = path.resolve('config', name);
    return [name, fs.existsSync(filePath) ? hashFile(filePath) : null];
  }));
  const runnerPath = path.resolve(__filename);
  const sourcePath = path.resolve('src');
  const packageJsonPath = path.resolve('package.json');
  const packageLockPath = path.resolve('package-lock.json');
  const tsconfigPath = path.resolve('tsconfig.json');
  const manifest = {
    schemaVersion: 1,
    status: 'running',
    startedAt,
    updatedAt: startedAt,
    completedAt: null,
    command: [process.execPath, ...process.argv.slice(1)],
    environment: {
      node: process.version,
      platform: process.platform,
      arch: process.arch,
      git: gitMetadata(),
      analysisFeatureFlags: {
        disableIrRecovery: process.env.ARKPRISM_DISABLE_IR_RECOVERY === '1',
        disableReceiverRefinement:
          process.env.ARKPRISM_DISABLE_RECEIVER_REFINEMENT === '1',
        disableLifecycleBounds:
          process.env.ARKPRISM_DISABLE_LIFECYCLE_BOUNDS === '1',
        disableContinuationFlow:
          args.disableContinuationFlow
          || process.env.ARKPRISM_DISABLE_CONTINUATION_FLOW === '1',
      },
    },
    inputs: {
      dataset: datasetDir,
      datasetProjectCount: datasetProjects.length,
      projectCount: projects.length,
      includedProjects,
      excludedProjects,
      sdk: {
        root: args.sdkPath,
        ...directoryFingerprint(
          args.sdkPath,
          args.sdkFingerprintCache,
          args.refreshSdkFingerprint,
        ),
      },
      configHashes,
      implementation: {
        runnerPath,
        runnerSha256: hashFile(runnerPath),
        source: {
          path: sourcePath,
          ...hashDirectory(sourcePath),
        },
        packageJsonSha256: hashFile(packageJsonPath),
        packageLockSha256: fs.existsSync(packageLockPath)
          ? hashFile(packageLockPath)
          : null,
        tsconfigSha256: fs.existsSync(tsconfigPath)
          ? hashFile(tsconfigPath)
          : null,
      },
      build: args.engine === 'compiled'
        ? {
          path: path.resolve('dist'),
          entrySha256: hashFile(path.resolve('dist', 'arkprism.js')),
          ...hashDirectory(path.resolve('dist')),
        }
        : null,
    },
    execution: {
      outputDir,
      logDir: args.logDir,
      engine: args.engine,
      concurrency: args.concurrency,
      timeoutMs: args.timeoutMs,
      nodeOptions: args.nodeOptions,
      resume: args.resume,
      arkArgs: args.arkArgs,
      maxAttempts: args.maxAttempts,
      retryDelayMs: args.retryDelayMs,
      disableContinuationFlow: args.disableContinuationFlow,
    },
    progress: {
      finished: 0,
      completed: 0,
      errors: 0,
    },
  };

  const existingManifestPath = path.join(outputDir, 'run_manifest.json');
  if (args.resume && fs.existsSync(existingManifestPath)) {
    const existingManifest = readJson(existingManifestPath);
    const mismatches = [];
    const compare = (label, previous, current) => {
      if (JSON.stringify(previous) !== JSON.stringify(current)) mismatches.push(label);
    };
    compare('dataset', existingManifest.inputs?.dataset, manifest.inputs.dataset);
    compare('datasetProjectCount', existingManifest.inputs?.datasetProjectCount, manifest.inputs.datasetProjectCount);
    compare('projectCount', existingManifest.inputs?.projectCount, manifest.inputs.projectCount);
    compare('includedProjects', existingManifest.inputs?.includedProjects, manifest.inputs.includedProjects);
    compare('excludedProjects', existingManifest.inputs?.excludedProjects, manifest.inputs.excludedProjects);
    compare('SDK root', existingManifest.inputs?.sdk?.root, manifest.inputs.sdk.root);
    compare('SDK fingerprint', existingManifest.inputs?.sdk?.sha256, manifest.inputs.sdk.sha256);
    compare('configuration hashes', existingManifest.inputs?.configHashes, manifest.inputs.configHashes);
    compare('implementation fingerprint', existingManifest.inputs?.implementation, manifest.inputs.implementation);
    compare('build fingerprint', existingManifest.inputs?.build?.sha256, manifest.inputs.build?.sha256);
    compare('engine', existingManifest.execution?.engine, manifest.execution.engine);
    compare('ArkPrism arguments', existingManifest.execution?.arkArgs, manifest.execution.arkArgs);
    compare(
      'analysis feature flags',
      existingManifest.environment?.analysisFeatureFlags,
      manifest.environment.analysisFeatureFlags,
    );
    if (mismatches.length > 0) {
      throw new Error(
        `Refusing incompatible resume; changed: ${mismatches.join(', ')}`,
      );
    }
    manifest.startedAt = existingManifest.startedAt || startedAt;
    manifest.resumeHistory = [
      ...(existingManifest.resumeHistory || []),
      {
        resumedAt: startedAt,
        previousStatus: existingManifest.status,
        previousProgress: existingManifest.progress,
      },
    ];
  }

  console.log(`[RUNNER] Dataset: ${datasetDir}`);
  console.log(`[RUNNER] Projects: ${projects.length}/${datasetProjects.length}`);
  if (includedProjects.length > 0) {
    console.log(`[RUNNER] Included: ${includedProjects.join(', ')}`);
  }
  if (excludedProjects.length > 0) {
    console.log(`[RUNNER] Excluded: ${excludedProjects.join(', ')}`);
  }
  console.log(`[RUNNER] Output: ${outputDir}`);
  console.log(`[RUNNER] Logs: ${args.logDir}`);
  console.log(`[RUNNER] Resume: ${args.resume}`);
  console.log(`[RUNNER] Concurrency: ${args.concurrency}`);
  console.log(`[RUNNER] Engine: ${args.engine}`);

  function writeSummary() {
    const summaryPath = path.join(outputDir, 'batch_summary.json');
    fs.writeFileSync(summaryPath, `${JSON.stringify(results.filter(Boolean), null, 2)}\n`, 'utf8');
    const finished = results.filter(Boolean);
    const errors = finished.filter(result => result.error).length;
    manifest.updatedAt = new Date().toISOString();
    manifest.progress = {
      finished: finished.length,
      completed: finished.length - errors,
      errors,
    };
    fs.writeFileSync(
      path.join(outputDir, 'run_manifest.json'),
      `${JSON.stringify(manifest, null, 2)}\n`,
      'utf8',
    );
  }

  writeSummary();
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
        const result = summarizeReport(projectName, existingReport, durationMs, {
          skipped: true,
          requireCompleteTaint: !args.arkArgs.includes('--no-taint'),
        });
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
  manifest.status = errors.length === 0 ? 'complete' : 'complete_with_errors';
  manifest.completedAt = new Date().toISOString();
  writeSummary();
  console.log(`[RUNNER] Complete: ${completed}/${finalResults.length}, errors=${errors.length}`);
  if (errors.length > 0) {
    console.log('[RUNNER] Error projects:');
    for (const error of errors) console.log(`  - ${error.projectName}: ${error.error}`);
  }
}

if (require.main === module) {
  main().catch(error => {
    console.error(error.stack || error.message || String(error));
    process.exit(1);
  });
}

module.exports = {
  parseArgs,
  summarizeReport,
};
