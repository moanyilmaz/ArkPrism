#!/usr/bin/env node

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

function parseArgs(argv) {
  const args = {
    reports: '',
    dataset: '',
    output: '',
    sampleSize: 120,
    privacyQuota: 90,
    frameworkQuota: 30,
    asyncQuota: 20,
    seed: 'ArkPrism-FSE2027-semantic-path-audit-v1',
  };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--reports') args.reports = argv[++index] || '';
    else if (token === '--dataset') args.dataset = argv[++index] || '';
    else if (token === '--output') args.output = argv[++index] || '';
    else if (token === '--sample-size') args.sampleSize = Number(argv[++index]);
    else if (token === '--privacy-quota') args.privacyQuota = Number(argv[++index]);
    else if (token === '--framework-quota') args.frameworkQuota = Number(argv[++index]);
    else if (token === '--async-quota') args.asyncQuota = Number(argv[++index]);
    else if (token === '--seed') args.seed = argv[++index] || '';
    else throw new Error(`Unknown argument: ${token}`);
  }
  if (!args.reports || !args.dataset || !args.output) {
    throw new Error(
      'Usage: node scripts/select_semantic_path_audit.js '
      + '--reports <run-dir> --dataset <corpus-dir> --output <queue.json>',
    );
  }
  for (const [name, value] of [
    ['sample size', args.sampleSize],
    ['privacy quota', args.privacyQuota],
    ['framework quota', args.frameworkQuota],
    ['async quota', args.asyncQuota],
  ]) {
    if (!Number.isInteger(value) || value < 0) throw new Error(`Invalid ${name}: ${value}`);
  }
  if (args.privacyQuota + args.frameworkQuota !== args.sampleSize) {
    throw new Error('privacy quota plus framework quota must equal sample size');
  }
  return args;
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function sha256File(filePath) {
  return sha256(fs.readFileSync(filePath));
}

function reportPaths(root) {
  const files = [];
  const pending = [path.resolve(root)];
  while (pending.length > 0) {
    const current = pending.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const target = path.join(current, entry.name);
      if (entry.isDirectory()) pending.push(target);
      else if (entry.isFile() && entry.name.endsWith('-arkprism-report.json')) files.push(target);
    }
  }
  return files.sort((left, right) => left.localeCompare(right));
}

function sinkFamily(sinkApi) {
  const value = String(sinkApi || '').toLowerCase();
  if (/console|hilog|logger|\.debug\(|\.info\(|\.warn\(|\.error\(|\.fatal\(/.test(value)) {
    return 'logging';
  }
  if (/showtoast|showdialog|showactionmenu|promptaction/.test(value)) return 'ui';
  if (/pasteboard|writetext|appendfile|file\.fs|\.write\(/.test(value)) return 'storage';
  if (/http|request|sendrequest|bluetooth|\.send\(/.test(value)) return 'network';
  if (/notification|wantagent|bundlemanager|publish/.test(value)) return 'inter_app';
  return 'other';
}

function pathLengthBin(length) {
  if (length <= 3) return 'short_1_3';
  if (length <= 7) return 'medium_4_7';
  return 'long_8_plus';
}

function normalizeSourceIdentity(identity, context = 'flow') {
  if (!identity || typeof identity !== 'object') {
    throw new Error(`${context}: missing sourceIdentity`);
  }
  const requiredText = ['module', 'apiName', 'sourceType', 'methodSignature', 'ruleOrigin'];
  for (const field of requiredText) {
    if (typeof identity[field] !== 'string' || identity[field].trim() === '') {
      throw new Error(`${context}: invalid sourceIdentity.${field}`);
    }
  }
  for (const field of ['sourceIndex', 'callbackIndex']) {
    if (!Number.isInteger(identity[field])) {
      throw new Error(`${context}: invalid sourceIdentity.${field}`);
    }
  }
  return {
    module: identity.module,
    namespace: String(identity.namespace || ''),
    className: String(identity.className || ''),
    apiName: identity.apiName,
    sourceType: identity.sourceType,
    sourceIndex: identity.sourceIndex,
    callbackIndex: identity.callbackIndex,
    methodSignature: identity.methodSignature,
    ruleOrigin: identity.ruleOrigin,
  };
}

function resolveProjectFile(datasetRoot, projectName, fileValue) {
  if (!fileValue) return null;
  const projectRoot = path.resolve(datasetRoot, projectName);
  const candidate = path.isAbsolute(fileValue)
    ? path.resolve(fileValue)
    : path.resolve(projectRoot, fileValue);
  const relative = path.relative(projectRoot, candidate);
  if (relative.startsWith('..') || path.isAbsolute(relative)) return null;
  return fs.existsSync(candidate) && fs.statSync(candidate).isFile() ? candidate : null;
}

function createSourceCache() {
  const cache = new Map();
  return (filePath) => {
    if (!filePath) return null;
    if (!cache.has(filePath)) {
      const content = fs.readFileSync(filePath, 'utf8');
      cache.set(filePath, {
        sha256: sha256(Buffer.from(content, 'utf8')),
        lines: content.split(/\r?\n/),
      });
    }
    return cache.get(filePath);
  };
}

function sourceWindow(filePath, line, sourceCache, radius = 3) {
  if (!filePath || !Number.isInteger(line) || line <= 0) return null;
  const source = sourceCache(filePath);
  if (!source || line > source.lines.length) return null;
  const startLine = Math.max(1, line - radius);
  const endLine = Math.min(source.lines.length, line + radius);
  return {
    startLine,
    endLine,
    lines: source.lines.slice(startLine - 1, endLine).map((text, offset) => ({
      line: startLine + offset,
      text,
    })),
  };
}

function methodDeclarationLine(filePath, methodName, sourceCache) {
  if (!filePath || !methodName) return null;
  const source = sourceCache(filePath);
  const escaped = String(methodName).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const declaration = new RegExp(`\\b${escaped}\\s*\\(`);
  const index = source.lines.findIndex(line => declaration.test(line));
  return index >= 0 ? index + 1 : null;
}

function candidateFromFlow({
  report,
  reportPath,
  reportRoot,
  reportHash,
  flow,
  flowIndex,
  datasetRoot,
  sourceCache,
}) {
  const project = report.projectName;
  const projectRoot = path.resolve(datasetRoot, project);
  const sourceFile = resolveProjectFile(datasetRoot, project, flow.sourceFile);
  const sinkFile = resolveProjectFile(datasetRoot, project, flow.sinkFile);
  const reportedSourceLine = Number(flow.sourceLine);
  const sinkLine = Number(flow.sinkLine);
  if (!sinkFile || !Number.isInteger(sinkLine) || sinkLine <= 0) {
    throw new Error(`${project}: invalid sink endpoint at flow ${flowIndex}`);
  }
  if (Number.isInteger(reportedSourceLine) && reportedSourceLine > 0 && !sourceFile) {
    throw new Error(`${project}: invalid source endpoint at flow ${flowIndex}`);
  }
  const pathEntries = (Array.isArray(flow.path) ? flow.path : []).map((entry) => {
    const entryFile = resolveProjectFile(datasetRoot, project, entry.file);
    const entryLine = Number(entry.line);
    const cached = entryFile ? sourceCache(entryFile) : null;
    return {
      statement: String(entry.statement || ''),
      file: entryFile ? path.relative(projectRoot, entryFile).replace(/\\/g, '/') : null,
      line: Number.isInteger(entryLine) ? entryLine : null,
      method: String(entry.method || ''),
      sourceText: cached && entryLine > 0 && entryLine <= cached.lines.length
        ? cached.lines[entryLine - 1]
        : null,
    };
  });
  const sourceArtifact = sourceFile ? sourceCache(sourceFile) : null;
  const sinkArtifact = sourceCache(sinkFile);
  const sourceIdentity = normalizeSourceIdentity(
    flow.sourceIdentity,
    `${project}:flow ${flowIndex}`,
  );
  const declarationLine = sourceFile
    ? methodDeclarationLine(sourceFile, sourceIdentity.apiName, sourceCache)
    : null;
  const sourceLine = Number.isInteger(reportedSourceLine) && reportedSourceLine > 0
    ? reportedSourceLine
    : declarationLine;
  if (!sourceLine) {
    throw new Error(`${project}: source location cannot be recovered at flow ${flowIndex}`);
  }
  const keyMaterial = [
    project,
    flow.sourceKind,
    flow.provenance,
    JSON.stringify(sourceIdentity),
    flow.sourceApi,
    flow.sourceFile,
    reportedSourceLine,
    flow.sinkApi,
    flow.sinkFile,
    sinkLine,
    pathEntries.map((entry) => entry.statement).join('\n'),
  ].join('\0');
  const length = pathEntries.length;
  const family = sinkFamily(flow.sinkApi);
  const lengthBin = pathLengthBin(length);
  return {
    id: sha256(keyMaterial).slice(0, 24),
    project,
    report: path.relative(reportRoot, reportPath).replace(/\\/g, '/'),
    reportSha256: reportHash,
    flowIndex,
    sourceKind: flow.sourceKind,
    provenance: flow.provenance,
    analysisDerivations: [...new Set(
      (Array.isArray(flow.analysisDerivations) ? flow.analysisDerivations : [])
        .map(value => String(value)),
    )].sort(),
    carrierState: typeof flow.carrierState === 'string' ? flow.carrierState : null,
    sourceIdentity,
    sinkFamily: family,
    pathLength: length,
    pathLengthBin: lengthBin,
    stratum: `${flow.sourceKind}|${flow.provenance}|${family}|${lengthBin}`,
    sourceApi: String(flow.sourceApi || ''),
    sourceFile: sourceFile
      ? path.relative(projectRoot, sourceFile).replace(/\\/g, '/')
      : String(flow.sourceFile || '').replace(/\\/g, '/'),
    sourceFileSha256: sourceArtifact?.sha256 || null,
    reportedSourceLine: Number.isInteger(reportedSourceLine) ? reportedSourceLine : null,
    sourceLine,
    sourceLocationKind: reportedSourceLine > 0 ? 'reported_statement' : 'method_declaration',
    sourceContext: sourceWindow(sourceFile, sourceLine, sourceCache),
    sinkApi: String(flow.sinkApi || ''),
    sinkFile: path.relative(projectRoot, sinkFile).replace(/\\/g, '/'),
    sinkFileSha256: sinkArtifact.sha256,
    sinkLine,
    sinkContext: sourceWindow(sinkFile, sinkLine, sourceCache),
    taintedValue: String(flow.taintedValue || ''),
    path: pathEntries,
  };
}

function diversitySelect(candidates, count, seed, preselected = []) {
  const selected = [...preselected];
  const selectedIds = new Set(selected.map((candidate) => candidate.id));
  const counts = {
    stratum: new Map(),
    provenance: new Map(),
    sinkFamily: new Map(),
    pathLengthBin: new Map(),
    project: new Map(),
  };
  const increment = (map, key) => map.set(key, (map.get(key) || 0) + 1);
  for (const candidate of selected) {
    for (const dimension of Object.keys(counts)) increment(counts[dimension], candidate[dimension]);
  }
  const available = candidates.filter((candidate) => !selectedIds.has(candidate.id));
  while (selected.length < count && available.length > 0) {
    let bestIndex = -1;
    let bestScore = -Infinity;
    let bestHash = '';
    for (let index = 0; index < available.length; index += 1) {
      const candidate = available[index];
      const score = (
        1000 / (1 + (counts.stratum.get(candidate.stratum) || 0))
        + 160 / (1 + (counts.provenance.get(candidate.provenance) || 0))
        + 120 / (1 + (counts.sinkFamily.get(candidate.sinkFamily) || 0))
        + 80 / (1 + (counts.pathLengthBin.get(candidate.pathLengthBin) || 0))
        + 30 / (1 + (counts.project.get(candidate.project) || 0))
      );
      const tieHash = sha256(`${seed}\0${candidate.id}`);
      if (score > bestScore || (score === bestScore && tieHash < bestHash)) {
        bestIndex = index;
        bestScore = score;
        bestHash = tieHash;
      }
    }
    const [chosen] = available.splice(bestIndex, 1);
    selected.push(chosen);
    selectedIds.add(chosen.id);
    for (const dimension of Object.keys(counts)) increment(counts[dimension], chosen[dimension]);
  }
  return selected;
}

function countBy(items, key) {
  return Object.fromEntries([...items.reduce((counts, item) => {
    const value = item[key];
    counts.set(value, (counts.get(value) || 0) + 1);
    return counts;
  }, new Map()).entries()].sort(([left], [right]) => String(left).localeCompare(String(right))));
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const reportRoot = path.resolve(args.reports);
  const datasetRoot = path.resolve(args.dataset);
  const outputPath = path.resolve(args.output);
  const manifestPath = path.join(reportRoot, 'run_manifest.json');
  const sourceCache = createSourceCache();
  const candidates = [];
  for (const reportPath of reportPaths(reportRoot)) {
    let report;
    try {
      report = JSON.parse(fs.readFileSync(reportPath, 'utf8').replace(/^\uFEFF/, ''));
    } catch (error) {
      throw new Error(`Invalid report JSON ${reportPath}: ${error.message}`);
    }
    const reportHash = sha256File(reportPath);
    (report.taintFlows || []).forEach((flow, flowIndex) => {
      if (!['privacy_data', 'framework_input'].includes(flow.sourceKind)) return;
      if (!['ifds', 'async_supplement', 'both'].includes(flow.provenance)) return;
      candidates.push(candidateFromFlow({
        report,
        reportPath,
        reportRoot,
        reportHash,
        flow,
        flowIndex,
        datasetRoot,
        sourceCache,
      }));
    });
  }
  const uniqueIds = new Set(candidates.map((candidate) => candidate.id));
  if (uniqueIds.size !== candidates.length) throw new Error('Duplicate semantic path IDs');
  if (candidates.length < args.sampleSize) {
    throw new Error(`Only ${candidates.length} eligible paths for sample size ${args.sampleSize}`);
  }

  const privacy = candidates.filter((candidate) => candidate.sourceKind === 'privacy_data');
  const framework = candidates.filter((candidate) => candidate.sourceKind === 'framework_input');
  const asyncPrivacy = privacy.filter((candidate) => (
    candidate.provenance === 'async_supplement' || candidate.provenance === 'both'
  ));
  const asyncSeed = diversitySelect(
    asyncPrivacy,
    Math.min(args.asyncQuota, args.privacyQuota, asyncPrivacy.length),
    `${args.seed}:privacy-async`,
  );
  let privacySelected = diversitySelect(
    privacy,
    Math.min(args.privacyQuota, privacy.length),
    `${args.seed}:privacy`,
    asyncSeed,
  );
  let frameworkSelected = diversitySelect(
    framework,
    Math.min(args.frameworkQuota, framework.length),
    `${args.seed}:framework`,
  );
  const selectedIds = new Set([...privacySelected, ...frameworkSelected].map((item) => item.id));
  if (privacySelected.length + frameworkSelected.length < args.sampleSize) {
    const fill = diversitySelect(
      candidates.filter((candidate) => !selectedIds.has(candidate.id)),
      args.sampleSize - privacySelected.length - frameworkSelected.length,
      `${args.seed}:fill`,
    );
    privacySelected = [...privacySelected, ...fill.filter((item) => item.sourceKind === 'privacy_data')];
    frameworkSelected = [
      ...frameworkSelected,
      ...fill.filter((item) => item.sourceKind === 'framework_input'),
    ];
  }
  const selected = [...privacySelected, ...frameworkSelected]
    .sort((left, right) => sha256(`${args.seed}\0${left.id}`).localeCompare(
      sha256(`${args.seed}\0${right.id}`),
    ));
  if (selected.length !== args.sampleSize) {
    throw new Error(`Selected ${selected.length}/${args.sampleSize} semantic paths`);
  }

  const output = {
    schemaVersion: 2,
    reportsDirectory: reportRoot,
    datasetDirectory: datasetRoot,
    runManifestSha256: fs.existsSync(manifestPath) ? sha256File(manifestPath) : null,
    selectionAlgorithm: 'deterministic-diversity-v1',
    seed: args.seed,
    requested: {
      sampleSize: args.sampleSize,
      privacyQuota: args.privacyQuota,
      frameworkQuota: args.frameworkQuota,
      asyncQuota: args.asyncQuota,
    },
    population: {
      paths: candidates.length,
      sourceKind: countBy(candidates, 'sourceKind'),
      provenance: countBy(candidates, 'provenance'),
      sinkFamily: countBy(candidates, 'sinkFamily'),
      pathLengthBin: countBy(candidates, 'pathLengthBin'),
      strata: countBy(candidates, 'stratum'),
    },
    sample: {
      paths: selected.length,
      projects: new Set(selected.map((item) => item.project)).size,
      sourceKind: countBy(selected, 'sourceKind'),
      provenance: countBy(selected, 'provenance'),
      sinkFamily: countBy(selected, 'sinkFamily'),
      pathLengthBin: countBy(selected, 'pathLengthBin'),
      strata: countBy(selected, 'stratum'),
    },
    records: selected,
  };
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({ output: outputPath, population: output.population, sample: output.sample }, null, 2));
}

if (require.main === module) main();

module.exports = {
  candidateFromFlow,
  countBy,
  createSourceCache,
  diversitySelect,
  normalizeSourceIdentity,
  pathLengthBin,
  reportPaths,
  sha256,
  sha256File,
  sinkFamily,
};
