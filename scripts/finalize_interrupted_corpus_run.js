#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const {
  packageDependencyContract,
  sha256File,
} = require('./summarize_corpus_reports');

function parseArgs(argv) {
  const args = { primary: '', tail: '' };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--primary') args.primary = argv[++index] || '';
    else if (token === '--tail') args.tail = argv[++index] || '';
    else throw new Error(`Unknown argument: ${token}`);
  }
  if (!args.primary || !args.tail) {
    throw new Error(
      'Usage: node scripts/finalize_interrupted_corpus_run.js '
      + '--primary <interrupted-run> --tail <recovery-run>',
    );
  }
  return args;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, ''));
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function canonical(value) {
  return JSON.stringify(value);
}

function assertEqual(label, left, right) {
  if (canonical(left) !== canonical(right)) {
    throw new Error(
      `${label} mismatch: primary=${canonical(left)} tail=${canonical(right)}`,
    );
  }
}

function reportPath(runDirectory, projectName) {
  return path.join(
    runDirectory,
    projectName,
    `${projectName}-arkprism-report.json`,
  );
}

function selectedProjects(manifest) {
  const dataset = manifest.inputs?.dataset;
  if (!dataset || !fs.existsSync(dataset)) {
    throw new Error(`Dataset directory is missing: ${dataset || '(missing)'}`);
  }
  const allProjects = fs.readdirSync(dataset, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name)
    .sort((left, right) => left.localeCompare(right));
  const included = new Set(manifest.inputs?.includedProjects || []);
  const excluded = new Set(manifest.inputs?.excludedProjects || []);
  const projects = allProjects.filter(projectName => (
    (included.size === 0 || included.has(projectName))
    && !excluded.has(projectName)
  ));
  if (projects.length !== Number(manifest.inputs?.projectCount)) {
    throw new Error(
      `Selected project count mismatch: ${projects.length}/`
      + `${manifest.inputs?.projectCount}`,
    );
  }
  return projects;
}

function verifyCompleteTail(tailManifest, tailBatch) {
  const projectCount = Number(tailManifest.inputs?.projectCount);
  if (tailManifest.status !== 'complete') {
    throw new Error(`Tail run is not complete: ${tailManifest.status}`);
  }
  if (tailManifest.execution?.resume === true) {
    throw new Error('Tail run must not use resume mode');
  }
  if (!Array.isArray(tailBatch) || tailBatch.length !== projectCount) {
    throw new Error(`Tail batch entries mismatch: ${tailBatch.length}/${projectCount}`);
  }
  if (tailBatch.some(item => item.error)) {
    throw new Error('Tail run contains batch errors');
  }
  const progress = tailManifest.progress || {};
  if (Number(progress.finished) !== projectCount
    || Number(progress.completed) !== projectCount
    || Number(progress.errors) !== 0) {
    throw new Error(`Invalid tail progress: ${canonical(progress)}`);
  }
}

function verifySemanticCompatibility(primary, tail) {
  assertEqual('dataset', primary.inputs?.dataset, tail.inputs?.dataset);
  assertEqual(
    'dataset project count',
    primary.inputs?.datasetProjectCount,
    tail.inputs?.datasetProjectCount,
  );
  assertEqual('SDK root', primary.inputs?.sdk?.root, tail.inputs?.sdk?.root);
  assertEqual('SDK sha256', primary.inputs?.sdk?.sha256, tail.inputs?.sdk?.sha256);
  assertEqual('configuration hashes', primary.inputs?.configHashes, tail.inputs?.configHashes);
  assertEqual(
    'analysis feature flags',
    primary.environment?.analysisFeatureFlags,
    tail.environment?.analysisFeatureFlags,
  );
  assertEqual('engine', primary.execution?.engine, tail.execution?.engine);
  assertEqual('timeout', primary.execution?.timeoutMs, tail.execution?.timeoutMs);
  assertEqual('Node options', primary.execution?.nodeOptions, tail.execution?.nodeOptions);
  assertEqual('ArkPrism arguments', primary.execution?.arkArgs, tail.execution?.arkArgs);
  assertEqual(
    'maximum attempts',
    primary.execution?.maxAttempts,
    tail.execution?.maxAttempts,
  );
  assertEqual(
    'retry delay',
    primary.execution?.retryDelayMs,
    tail.execution?.retryDelayMs,
  );

  const primaryImplementation = primary.inputs?.implementation || {};
  const tailImplementation = tail.inputs?.implementation || {};
  for (const key of [
    'runnerSha256',
    'source',
    'packageLockSha256',
    'tsconfigSha256',
  ]) {
    assertEqual(`implementation ${key}`, primaryImplementation[key], tailImplementation[key]);
  }
  assertEqual('compiled build', primary.inputs?.build, tail.inputs?.build);

  const repositoryRoot = primaryImplementation.runnerPath
    ? path.dirname(path.dirname(primaryImplementation.runnerPath))
    : '';
  const packageJson = repositoryRoot ? path.join(repositoryRoot, 'package.json') : '';
  const packageLock = repositoryRoot ? path.join(repositoryRoot, 'package-lock.json') : '';
  if (!packageJson || !fs.existsSync(packageJson)
    || !packageLock || !fs.existsSync(packageLock)) {
    throw new Error('Current package metadata is unavailable for dependency verification');
  }
  const dependencyContract = packageDependencyContract(packageJson, packageLock);
  if (!dependencyContract.consistent) {
    throw new Error(
      `Package dependency contract changed: ${dependencyContract.mismatches.join('|')}`,
    );
  }
  return {
    dependencyContract,
    primaryPackageJsonSha256: primaryImplementation.packageJsonSha256 || null,
    tailPackageJsonSha256: tailImplementation.packageJsonSha256 || null,
    currentPackageJsonSha256: sha256File(packageJson),
    packageLockSha256: sha256File(packageLock),
  };
}

function verifyPrimaryState(primaryDirectory, primaryManifest, primaryBatch) {
  if (primaryManifest.status !== 'running') {
    throw new Error(`Primary run is not interrupted/running: ${primaryManifest.status}`);
  }
  if (primaryManifest.execution?.resume === true) {
    throw new Error('Primary run unexpectedly used resume mode');
  }
  if (!Array.isArray(primaryBatch) || primaryBatch.some(item => item.error)) {
    throw new Error('Primary batch summary is invalid or contains errors');
  }
  const batchNames = new Set();
  for (const item of primaryBatch) {
    if (!item.projectName || batchNames.has(item.projectName)) {
      throw new Error(`Duplicate or missing primary project: ${item.projectName}`);
    }
    batchNames.add(item.projectName);
    if (!fs.existsSync(reportPath(primaryDirectory, item.projectName))) {
      throw new Error(`Primary report is missing for ${item.projectName}`);
    }
  }
  const progress = primaryManifest.progress || {};
  if (Number(progress.finished) !== primaryBatch.length
    || Number(progress.completed) !== primaryBatch.length
    || Number(progress.errors) !== 0) {
    throw new Error(`Invalid primary progress: ${canonical(progress)}`);
  }
}

function copyDirectoryVerified(source, target) {
  if (!fs.existsSync(source)) throw new Error(`Recovery source is missing: ${source}`);
  if (!fs.existsSync(target)) {
    fs.cpSync(source, target, { recursive: true, errorOnExist: true });
    return;
  }
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const sourcePath = path.join(source, entry.name);
    const targetPath = path.join(target, entry.name);
    if (entry.isDirectory()) copyDirectoryVerified(sourcePath, targetPath);
    else if (!fs.existsSync(targetPath)
      || sha256File(sourcePath) !== sha256File(targetPath)) {
      throw new Error(`Recovery target conflict: ${targetPath}`);
    }
  }
}

function finalizeInterruptedRun(primaryInput, tailInput) {
  const primaryDirectory = path.resolve(primaryInput);
  const tailDirectory = path.resolve(tailInput);
  const primaryManifestPath = path.join(primaryDirectory, 'run_manifest.json');
  const primaryBatchPath = path.join(primaryDirectory, 'batch_summary.json');
  const tailManifestPath = path.join(tailDirectory, 'run_manifest.json');
  const tailBatchPath = path.join(tailDirectory, 'batch_summary.json');

  const primaryManifest = readJson(primaryManifestPath);
  if (primaryManifest.interruptionRecovery?.status === 'complete') {
    return primaryManifest.interruptionRecovery;
  }
  const primaryBatch = readJson(primaryBatchPath);
  const tailManifest = readJson(tailManifestPath);
  const tailBatch = readJson(tailBatchPath);

  verifyPrimaryState(primaryDirectory, primaryManifest, primaryBatch);
  verifyCompleteTail(tailManifest, tailBatch);
  const packageVerification = verifySemanticCompatibility(primaryManifest, tailManifest);

  const expectedProjects = selectedProjects(primaryManifest);
  const completedNames = new Set(primaryBatch.map(item => item.projectName));
  const missingProjects = expectedProjects.filter(projectName => !completedNames.has(projectName));
  const tailProjects = selectedProjects(tailManifest);
  if (canonical([...missingProjects].sort()) !== canonical([...tailProjects].sort())) {
    throw new Error(
      `Recovery project set mismatch: missing=${missingProjects.join('|')} `
      + `tail=${tailProjects.join('|')}`,
    );
  }

  const tailByProject = new Map(tailBatch.map(item => [item.projectName, item]));
  const recoveredAt = new Date().toISOString();
  const proofDirectory = path.join(primaryDirectory, '_run_recovery_proof');
  fs.mkdirSync(proofDirectory, { recursive: true });
  const proofFiles = [
    ['primary_manifest_before_recovery.json', primaryManifestPath],
    ['primary_batch_before_recovery.json', primaryBatchPath],
    ['tail_manifest.json', tailManifestPath],
    ['tail_batch.json', tailBatchPath],
  ].map(([name, source]) => {
    const target = path.join(proofDirectory, name);
    if (!fs.existsSync(target)) fs.copyFileSync(source, target);
    else if (sha256File(target) !== sha256File(source)) {
      throw new Error(`Recovery proof conflict: ${target}`);
    }
    return {
      path: path.relative(primaryDirectory, target).replace(/\\/g, '/'),
      sha256: sha256File(target),
    };
  });

  const recoveredProjects = [];
  const recoveryLogDirectory = path.join(
    primaryDirectory,
    'logs',
    'interruption_recovery',
  );
  fs.mkdirSync(recoveryLogDirectory, { recursive: true });
  for (const projectName of missingProjects) {
    const tailItem = tailByProject.get(projectName);
    if (!tailItem) throw new Error(`Tail batch entry is missing for ${projectName}`);
    const sourceProject = path.join(tailDirectory, projectName);
    const targetProject = path.join(primaryDirectory, projectName);
    const sourceReport = reportPath(tailDirectory, projectName);
    const targetReport = reportPath(primaryDirectory, projectName);
    if (!fs.existsSync(sourceReport)) {
      throw new Error(`Tail report is missing for ${projectName}`);
    }
    const report = readJson(sourceReport);
    if (report.projectName !== projectName) {
      throw new Error(`Tail report identity mismatch for ${projectName}`);
    }
    copyDirectoryVerified(sourceProject, targetProject);

    const sourceLog = tailItem.logPath ? path.resolve(tailItem.logPath) : '';
    let targetLog = '';
    if (sourceLog && fs.existsSync(sourceLog)) {
      targetLog = path.join(recoveryLogDirectory, path.basename(sourceLog));
      if (!fs.existsSync(targetLog)) fs.copyFileSync(sourceLog, targetLog);
      else if (sha256File(sourceLog) !== sha256File(targetLog)) {
        throw new Error(`Recovery log conflict: ${targetLog}`);
      }
    }
    tailItem.logPath = targetLog;
    tailItem.recoveredFromInterruption = true;
    recoveredProjects.push({
      projectName,
      report: path.relative(primaryDirectory, targetReport).replace(/\\/g, '/'),
      reportSha256: sha256File(targetReport),
      log: targetLog
        ? path.relative(primaryDirectory, targetLog).replace(/\\/g, '/')
        : null,
      logSha256: targetLog ? sha256File(targetLog) : null,
    });
  }

  const mergedByProject = new Map(primaryBatch.map(item => [item.projectName, item]));
  for (const item of tailBatch) mergedByProject.set(item.projectName, item);
  const mergedBatch = expectedProjects.map(projectName => {
    const item = mergedByProject.get(projectName);
    if (!item) throw new Error(`Merged batch entry is missing for ${projectName}`);
    return item;
  });
  writeJson(primaryBatchPath, mergedBatch);

  const recovery = {
    schemaVersion: 1,
    status: 'complete',
    reason: 'orchestrator_interruption',
    primaryStatusBefore: primaryManifest.status,
    primaryProgressBefore: primaryManifest.progress,
    recoveredAt,
    recoveredProjects,
    proofFiles,
    semanticCompatibility: {
      sdkSha256: primaryManifest.inputs.sdk.sha256,
      buildSha256: primaryManifest.inputs.build.sha256,
      buildEntrySha256: primaryManifest.inputs.build.entrySha256,
      runnerSha256: primaryManifest.inputs.implementation.runnerSha256,
      sourceSha256: primaryManifest.inputs.implementation.source.sha256,
      configHashes: primaryManifest.inputs.configHashes,
      arkArgs: primaryManifest.execution.arkArgs,
      packageVerification,
    },
  };
  primaryManifest.status = 'complete';
  primaryManifest.updatedAt = recoveredAt;
  primaryManifest.completedAt = recoveredAt;
  primaryManifest.progress = {
    finished: expectedProjects.length,
    completed: expectedProjects.length,
    errors: 0,
  };
  primaryManifest.execution.interruptionRecovery = true;
  primaryManifest.interruptionRecovery = recovery;
  writeJson(primaryManifestPath, primaryManifest);
  return recovery;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const recovery = finalizeInterruptedRun(args.primary, args.tail);
  console.log(JSON.stringify(recovery, null, 2));
}

if (require.main === module) main();

module.exports = {
  finalizeInterruptedRun,
  selectedProjects,
  verifySemanticCompatibility,
};
