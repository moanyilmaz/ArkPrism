'use strict';

const fs = require('fs');
const path = require('path');

const PACKAGE_ALIASES = require('../config/package_aliases.json');

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith('--') || !value) throw new Error(`Invalid argument: ${key}`);
    args[key.slice(2)] = path.resolve(value);
  }
  for (const required of ['queue', 'reports', 'output']) {
    if (!args[required]) throw new Error(`--${required} is required`);
  }
  return args;
}

function normalized(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9_$]/g, '');
}

function normalizedMember(value) {
  return normalized(String(value || '').replace(/\s*\(.*/, '').split('.').pop());
}

function packageAliases(packageName) {
  const key = Object.keys(PACKAGE_ALIASES).find(item =>
    item.toLowerCase() === String(packageName || '').toLowerCase(),
  );
  return key ? PACKAGE_ALIASES[key] : [];
}

function packageCompatible(left, right) {
  const a = String(left || '').toLowerCase();
  const b = String(right || '').toLowerCase();
  return a === b || packageAliases(left).some(alias => alias.toLowerCase() === b) ||
    packageAliases(right).some(alias => alias.toLowerCase() === a);
}

function receiverRoot(receiver) {
  return String(receiver || '').replace(/\?\./g, '.').split(/[.([?]/)[0];
}

function typeOwnerTokens(value) {
  const chains = String(value || '').match(
    /[A-Za-z_$][A-Za-z0-9_$]*(?:\s*\.\s*[A-Za-z_$][A-Za-z0-9_$]*)*/g,
  ) || [];
  return chains.map(chain => normalized(chain.split('.').pop())).filter(Boolean);
}

function receiverIdentities(rule) {
  return new Set([rule.namespace, ...(rule.receiverTypes || [])].map(normalized));
}

function directImportEvidence(candidate, rule) {
  const root = receiverRoot(candidate.receiver);
  const bindings = (candidate.importBindings || []).filter(binding =>
    binding.local === root && packageCompatible(binding.package, rule.package));
  for (const binding of bindings) {
    if (binding.kind === 'named' && normalized(binding.imported) === normalized(rule.namespace)) {
      return `named-import:${binding.local}<-${binding.imported}`;
    }
    if (binding.kind === 'default') return `default-import:${binding.local}`;
    if (binding.kind === 'namespace') {
      const receiverParts = String(candidate.receiver).split('.').map(normalized);
      if (receiverParts.includes(normalized(rule.namespace))) {
        return `namespace-import:${binding.local}.${rule.namespace}`;
      }
    }
  }
  if (candidate.aliasOrigin) {
    const binding = (candidate.importBindings || []).find(item =>
      item.local === candidate.aliasOrigin &&
      packageCompatible(item.package, rule.package) &&
      normalized(item.imported) === normalized(rule.member));
    if (binding) return `function-import:${binding.local}<-${binding.imported}`;
  }
  return '';
}

function typeEvidence(candidate, rule) {
  const expected = receiverIdentities(rule);
  const matched = typeOwnerTokens(candidate.receiverTypeHint).find(token => expected.has(token));
  return matched ? `receiver-type:${candidate.receiverTypeHint}` : '';
}

function originEvidence(candidate, rule) {
  const identities = [...receiverIdentities(rule)];
  const factories = new Set();
  for (const identity of identities) {
    for (const prefix of ['create', 'get', 'construct']) factories.add(`${prefix}${identity}`);
    factories.add(`construct${identity}instance`);
  }
  const inlineReceiver = /\bnew\s+|\(/.test(String(candidate.receiver || ''))
    ? [candidate.receiver]
    : [];
  const expressions = [...inlineReceiver, ...(candidate.receiverOrigins || [])];
  for (const expression of expressions) {
    const compact = normalized(expression);
    const identity = identities.find(item => compact.includes(item));
    if (identity) return `receiver-origin:${expression}`;
    const factory = [...factories].find(item => compact.includes(item));
    if (factory) return `factory-origin:${expression}`;
  }
  return '';
}

function ruleEvidence(candidate, rule) {
  const evidence = [];
  if (rule.callPattern === 'direct' || rule.callPattern === 'property') {
    const direct = directImportEvidence(candidate, rule);
    if (direct) evidence.push(direct);
  } else {
    const typed = typeEvidence(candidate, rule);
    const origin = originEvidence(candidate, rule);
    if (typed) evidence.push(typed);
    if (origin) evidence.push(origin);
  }
  return evidence;
}

function locationKey(project, record) {
  const file = String(record.file || '').replace(/\\/g, '/').toLowerCase();
  return [project, file, Number(record.line || 0), Number(record.column || 0),
    normalizedMember(record.method || record.member)].join('|');
}

function detectorLocations(reportsRoot, projects) {
  const exact = new Map();
  const line = new Map();
  for (const project of projects) {
    const reportPath = path.join(
      reportsRoot,
      project.project,
      `${project.project}-arkprism-report.json`,
    );
    const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
    for (const usage of report.privacyApiUsages || []) {
      exact.set(locationKey(project.project, usage), usage);
      const fallback = [project.project,
        String(usage.file || '').replace(/\\/g, '/').toLowerCase(),
        Number(usage.line || 0), normalizedMember(usage.method)].join('|');
      line.set(fallback, [...(line.get(fallback) || []), usage]);
    }
  }
  return { exact, line };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const queue = JSON.parse(fs.readFileSync(args.queue, 'utf8'));
  const detector = detectorLocations(args.reports, queue.projects);
  const candidates = [];
  const summary = { strongAcceptEvidence: 0, ambiguous: 0, detectorMatched: 0, disagreements: 0 };
  for (const project of queue.projects) {
    for (const candidate of project.candidates) {
      const rules = candidate.candidateApis.map(rule => ({
        rule,
        evidence: ruleEvidence(candidate, rule),
      }));
      const strong = rules.filter(item => item.evidence.length > 0);
      const exactKey = locationKey(project.project, candidate);
      let detected = detector.exact.get(exactKey) || null;
      if (!detected) {
        const fallback = [project.project, candidate.file.toLowerCase(), candidate.line,
          normalizedMember(candidate.member)].join('|');
        const matches = detector.line.get(fallback) || [];
        if (matches.length === 1) detected = matches[0];
      }
      const proposedStatus = strong.length === 1 ? 'strong-evidence' : 'manual-review';
      if (proposedStatus === 'strong-evidence') summary.strongAcceptEvidence++;
      else summary.ambiguous++;
      if (detected) summary.detectorMatched++;
      if ((strong.length === 1) !== Boolean(detected)) summary.disagreements++;
      candidates.push({
        key: [project.project, candidate.file, candidate.line, candidate.column, candidate.member].join('|'),
        project: project.project,
        ...candidate,
        proposedStatus,
        ruleEvidence: rules,
        detectorMatched: Boolean(detected),
        detectorUsage: detected,
      });
    }
  }
  const output = {
    schemaVersion: 1,
    role: 'manual-review-workbook-not-ground-truth',
    queue: args.queue,
    reports: args.reports,
    candidateCount: candidates.length,
    summary,
    candidates,
  };
  fs.mkdirSync(path.dirname(args.output), { recursive: true });
  fs.writeFileSync(args.output, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({ output: args.output, ...summary }));
}

main();
