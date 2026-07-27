const fs = require('fs');
const path = require('path');

function parseArgs(argv) {
  const args = {
    reports: '',
    rules: path.join('config', 'sensitive_apis.json'),
    output: '',
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--reports') args.reports = argv[++i] || '';
    else if (arg === '--rules') args.rules = argv[++i] || args.rules;
    else if (arg === '--output') args.output = argv[++i] || '';
    else if (arg === '--help' || arg === '-h') {
      console.log([
        'Usage:',
        '  node scripts/audit_detector_ifds_consistency.js --reports <dir>',
        '    [--rules config/sensitive_apis.json] [--output result.json]',
        '',
        'Finds configured IFDS source statements without matching detector output.',
        'The result is a consistency audit and candidate list, not ground truth.',
      ].join('\n'));
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  if (!args.reports) throw new Error('--reports is required');
  return args;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, ''));
}

function reports(root) {
  const result = [];
  const stack = [root];
  while (stack.length > 0) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory() && entry.name !== 'logs') stack.push(fullPath);
      else if (entry.isFile() && entry.name.endsWith('-arkprism-report.json')) result.push(fullPath);
    }
  }
  return result.sort();
}

function normalize(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function normalizeMethod(value) {
  const method = String(value || '')
    .replace(/\(\)\s*$/, '')
    .replace(/\s*\(.*/, '')
    .split('.')
    .filter(Boolean)
    .pop();
  return normalize(method);
}

function sourceIdentity(statement) {
  const text = String(statement || '');
  const methodMatch = text.match(/:\s*\.([A-Za-z_$][\w$]*)\s*\(/)
    || text.match(/\.([A-Za-z_$][\w$]*)\s*\(/);
  const receiverMatch = text.match(/(?:instanceinvoke|staticinvoke)\s+([^.<\s]+)/);
  return {
    method: methodMatch?.[1] || '',
    receiver: receiverMatch?.[1] || '',
  };
}

function ruleIndex(ruleGroups) {
  const byMethod = new Map();
  for (const group of ruleGroups) {
    for (const api of group.privacyApis || []) {
      const method = normalizeMethod(api.method);
      if (!method) continue;
      const record = {
        systemPackage: group.systemPackage,
        namespace: api.namespace,
        method: api.method,
        directCall: api.directCall,
        profilingCategory: api.profilingCategory,
      };
      if (!byMethod.has(method)) byMethod.set(method, []);
      byMethod.get(method).push(record);
    }
  }
  return byMethod;
}

function uniqueSemanticRules(rules) {
  const seen = new Set();
  return rules.filter(rule => {
    const key = `${normalize(rule.systemPackage)}|${normalize(rule.namespace)}|${normalizeMethod(rule.method)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const rulesByMethod = ruleIndex(readJson(args.rules));
  const candidateByKey = new Map();
  let flows = 0;
  let configuredFlows = 0;
  let coveredConfiguredFlows = 0;

  for (const reportPath of reports(args.reports)) {
    const report = readJson(reportPath);
    const project = report.projectName || path.basename(path.dirname(reportPath));
    const detectedMethods = new Set();
    const detectedIdentities = new Set();
    for (const usage of report.privacyApiUsages || []) {
      const method = normalizeMethod(usage.method);
      detectedMethods.add(method);
      detectedIdentities.add(`${normalize(usage.namespace)}|${method}`);
    }

    for (const flow of report.taintFlows || []) {
      flows++;
      const identity = sourceIdentity(flow.sourceApi);
      const method = normalizeMethod(identity.method);
      const matchingRules = uniqueSemanticRules(rulesByMethod.get(method) || []);
      if (matchingRules.length === 0) continue;
      configuredFlows++;
      const strongRules = matchingRules.filter(rule => {
        const receiver = normalize(identity.receiver);
        const namespace = normalize(rule.namespace);
        return receiver.length > 0
          && namespace.length > 0
          && (receiver === namespace || receiver.includes(namespace) || namespace.includes(receiver));
      });
      const hasStrongDetectorMatch = strongRules.some(rule =>
        detectedIdentities.has(`${normalize(rule.namespace)}|${method}`));
      const hasMethodDetectorMatch = detectedMethods.has(method);
      if (hasStrongDetectorMatch || (strongRules.length === 0 && hasMethodDetectorMatch)) {
        coveredConfiguredFlows++;
        continue;
      }

      const key = [
        project,
        typeof flow.sourceFile === 'string' ? flow.sourceFile : JSON.stringify(flow.sourceFile),
        flow.sourceLine,
        method,
      ].join('|');
      if (!candidateByKey.has(key)) {
        candidateByKey.set(key, {
          project,
          sourceFile: flow.sourceFile,
          sourceLine: flow.sourceLine,
          sourceApi: flow.sourceApi,
          receiver: identity.receiver,
          method: identity.method,
          evidenceStrength: strongRules.length > 0 ? 'receiver-namespace' : 'method-only',
          candidateRuleCount: matchingRules.length,
          candidateNamespaces: [...new Set(matchingRules.map(rule => rule.namespace))].sort(),
          matchingStrongRules: strongRules,
          flowCount: 0,
        });
      }
      candidateByKey.get(key).flowCount++;
    }
  }

  const candidates = [...candidateByKey.values()].sort(
    (left, right) => left.project.localeCompare(right.project)
      || Number(left.sourceLine || 0) - Number(right.sourceLine || 0),
  );
  const result = {
    generatedAt: new Date().toISOString(),
    reportsDirectory: path.resolve(args.reports),
    ruleFile: path.resolve(args.rules),
    definition: 'Configured IFDS source statement whose final member is present in sensitive_apis.json but lacks a compatible detector usage in the same project.',
    limitation: 'Receiver-namespace candidates compare namespace+method identities. Method-only coverage and candidates remain heuristic and require source review.',
    flows,
    configuredFlows,
    coveredConfiguredFlows,
    coverage: configuredFlows === 0 ? null : coveredConfiguredFlows / configuredFlows,
    uniqueCandidates: candidates.length,
    strongCandidates: candidates.filter(item => item.evidenceStrength === 'receiver-namespace').length,
    candidates,
  };

  const output = JSON.stringify(result, null, 2);
  if (args.output) {
    fs.mkdirSync(path.dirname(path.resolve(args.output)), { recursive: true });
    fs.writeFileSync(args.output, `${output}\n`);
  }
  console.log(output);
}

main();
