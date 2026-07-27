const fs = require('fs');
const path = require('path');

function parseArgs(argv) {
  const args = { before: '', after: '', output: '' };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--before') args.before = argv[++i] || '';
    else if (arg === '--after') args.after = argv[++i] || '';
    else if (arg === '--output') args.output = argv[++i] || '';
    else if (arg === '--help' || arg === '-h') {
      console.log([
        'Usage:',
        '  node scripts/compare_detector_reports.js --before <reports-dir>',
        '    --after <reports-dir> --output <result.json>',
        '',
        'Compares detector usages in two report trees. It reports changes and',
        'evidence distributions; it does not classify changes as correct.',
      ].join('\n'));
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  if (!args.before || !args.after || !args.output) {
    throw new Error('--before, --after, and --output are required');
  }
  return args;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, ''));
}

function reportMap(root) {
  const result = new Map();
  const stack = [path.resolve(root)];
  while (stack.length > 0) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory() && entry.name !== 'logs') stack.push(fullPath);
      else if (entry.isFile() && entry.name.endsWith('-arkprism-report.json')) {
        const report = readJson(fullPath);
        const project = report.projectName || path.basename(path.dirname(fullPath));
        if (result.has(project)) throw new Error(`Duplicate report for project ${project}`);
        result.set(project, { path: fullPath, report });
      }
    }
  }
  return result;
}

function normalize(value) {
  return String(value || '').replace(/\\/g, '/').trim();
}

function usageKey(usage) {
  return [
    normalize(usage.apiPackage).toLowerCase(),
    normalize(usage.namespace).toLowerCase(),
    normalize(usage.method).toLowerCase(),
    normalize(usage.file).toLowerCase(),
    normalize(usage.declaringMethod).toLowerCase(),
    normalize(usage.code),
  ].join('|');
}

function usageRecord(project, usage) {
  return {
    project,
    apiPackage: usage.apiPackage || '',
    namespace: usage.namespace || '',
    method: usage.method || '',
    file: usage.file || '',
    declaringMethod: usage.declaringMethod || '',
    code: usage.code || '',
    category: usage.profilingCategory || '',
    matchEvidence: usage.matchEvidence || 'direct',
  };
}

function increment(target, key) {
  target[key] = (target[key] || 0) + 1;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const before = reportMap(args.before);
  const after = reportMap(args.after);
  const projects = [...new Set([...before.keys(), ...after.keys()])].sort();
  const added = [];
  const removed = [];
  const unchangedEvidence = {};
  const projectChanges = [];

  for (const project of projects) {
    const beforeUsages = before.get(project)?.report?.privacyApiUsages || [];
    const afterUsages = after.get(project)?.report?.privacyApiUsages || [];
    const beforeByKey = new Map(beforeUsages.map(usage => [usageKey(usage), usage]));
    const afterByKey = new Map(afterUsages.map(usage => [usageKey(usage), usage]));
    const projectAdded = [];
    const projectRemoved = [];

    for (const [key, usage] of afterByKey) {
      if (!beforeByKey.has(key)) projectAdded.push(usageRecord(project, usage));
      else increment(unchangedEvidence, usage.matchEvidence || 'direct');
    }
    for (const [key, usage] of beforeByKey) {
      if (!afterByKey.has(key)) projectRemoved.push(usageRecord(project, usage));
    }
    added.push(...projectAdded);
    removed.push(...projectRemoved);
    if (projectAdded.length > 0 || projectRemoved.length > 0) {
      projectChanges.push({
        project,
        before: beforeUsages.length,
        after: afterUsages.length,
        added: projectAdded.length,
        removed: projectRemoved.length,
      });
    }
  }

  const addedEvidence = {};
  const addedApis = {};
  for (const usage of added) {
    increment(addedEvidence, usage.matchEvidence);
    increment(addedApis, `${usage.apiPackage}|${usage.namespace}|${usage.method}`);
  }
  const result = {
    generatedAt: new Date().toISOString(),
    definition: 'Exact usage identity is package, namespace, method, file, declaring method, and IR statement.',
    limitation: 'Added and removed records are review candidates, not automatically ground-truth errors.',
    beforeDirectory: path.resolve(args.before),
    afterDirectory: path.resolve(args.after),
    projects: {
      union: projects.length,
      before: before.size,
      after: after.size,
      changed: projectChanges.length,
    },
    usages: {
      before: [...before.values()].reduce(
        (sum, item) => sum + (item.report.privacyApiUsages || []).length,
        0,
      ),
      after: [...after.values()].reduce(
        (sum, item) => sum + (item.report.privacyApiUsages || []).length,
        0,
      ),
      added: added.length,
      removed: removed.length,
    },
    addedEvidence,
    addedApis: Object.entries(addedApis)
      .map(([api, count]) => ({ api, count }))
      .sort((left, right) => right.count - left.count || left.api.localeCompare(right.api)),
    projectChanges,
    added,
    removed,
    unchangedEvidence,
  };

  const outputPath = path.resolve(args.output);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify({
    projects: result.projects,
    usages: result.usages,
    addedEvidence,
  }, null, 2));
}

main();
