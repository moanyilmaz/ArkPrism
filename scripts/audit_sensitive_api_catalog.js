'use strict';

const fs = require('fs');
const path = require('path');
const ts = require('typescript');

function parseArgs(argv) {
  const value = name => {
    const index = argv.indexOf(name);
    return index >= 0 ? argv[index + 1] : undefined;
  };
  return {
    catalog: path.resolve(value('--catalog') || path.join('config', 'sensitive_apis.json')),
    sdkPath: path.resolve(value('--sdkPath') || process.env.OPENHARMONY_SDK_PATH || ''),
    output: path.resolve(value('--output') || path.join('docs', 'rule_set_audit', 'sensitive_api_catalog_sdk_audit.json')),
  };
}

function extractLegacyModules(record) {
  return [...String(record.possible_module_title || '').matchAll(/@(?:ohos|hms)\.[A-Za-z0-9_.]+/g)]
    .map(match => match[0]);
}

function moduleFiles(sdkPath, moduleName) {
  const directory = moduleName.startsWith('@kit.') ? 'kits' : 'api';
  const base = path.join(sdkPath, directory, moduleName);
  return [`${base}.d.ts`, `${base}.d.ets`].filter(file => fs.existsSync(file));
}

function referencedModules(file) {
  if (!fs.existsSync(file)) return [];
  const source = fs.readFileSync(file, 'utf8');
  return [...source.matchAll(/\bfrom\s+['"]([^'"]+)['"]/g)]
    .map(match => match[1])
    .filter(moduleName => moduleName.startsWith('@'));
}

function candidateFiles(record, sdkPath) {
  const modules = new Set([
    String(record.import_kit || ''),
    ...extractLegacyModules(record),
  ].filter(Boolean));
  const queue = [...modules];
  while (queue.length > 0) {
    const moduleName = queue.shift();
    for (const file of moduleFiles(sdkPath, moduleName)) {
      for (const referenced of referencedModules(file)) {
        if (!modules.has(referenced)) {
          modules.add(referenced);
          queue.push(referenced);
        }
      }
    }
  }
  return [...modules]
    .flatMap(moduleName => moduleFiles(sdkPath, moduleName));
}

function nodeName(node, source) {
  if (!node || !node.name) return '';
  return String(node.name.getText(source)).replace(/^['"]|['"]$/g, '');
}

function declarationKind(node) {
  if (ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node) || ts.isMethodSignature(node)) return 'method';
  if (ts.isGetAccessorDeclaration(node)) return 'property';
  if (ts.isPropertyDeclaration(node) || ts.isPropertySignature(node) || ts.isVariableDeclaration(node)) return 'property';
  return '';
}

function ownerNames(node, source) {
  const owners = [];
  let current = node.parent;
  while (current) {
    if (ts.isClassDeclaration(current) || ts.isInterfaceDeclaration(current) ||
        ts.isModuleDeclaration(current) || ts.isEnumDeclaration(current)) {
      const name = nodeName(current, source);
      if (name) owners.push(name);
    }
    current = current.parent;
  }
  return owners;
}

function parameterRange(parameters) {
  if (!parameters) return { minArgs: 0, maxArgs: 0 };
  const minArgs = parameters.filter(parameter =>
    !parameter.questionToken && !parameter.initializer && !parameter.dotDotDotToken
  ).length;
  return {
    minArgs,
    maxArgs: parameters.some(parameter => parameter.dotDotDotToken) ? null : parameters.length,
  };
}

function declarationsIn(file) {
  const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const declarations = [];
  const inheritance = new Map();
  function visit(node) {
    if ((ts.isClassDeclaration(node) || ts.isInterfaceDeclaration(node)) && node.name) {
      const child = nodeName(node, source);
      const parents = (node.heritageClauses || []).flatMap(clause =>
        clause.types.map(type => type.expression.getText(source).split('.').pop())
      );
      if (child && parents.length > 0) inheritance.set(child, parents);
    }
    const kind = declarationKind(node);
    const name = nodeName(node, source);
    if (kind && name) {
      const range = kind === 'method' ? parameterRange(node.parameters) : { minArgs: 0, maxArgs: 0 };
      declarations.push({
        name,
        kind,
        owners: ownerNames(node, source),
        minArgs: range.minArgs,
        maxArgs: range.maxArgs,
        firstParameterType: node.parameters?.[0]?.type?.getText(source) || '',
        declaration: node.getText(source).replace(/\s+/g, ' ').slice(0, 500),
        file,
      });
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  let changed = true;
  while (changed) {
    changed = false;
    for (const declaration of declarations) {
      for (const [child, parents] of inheritance) {
        if (declaration.owners.includes(child)) continue;
        if (parents.some(parent => declaration.owners.includes(parent))) {
          declaration.owners.push(child);
          changed = true;
        }
      }
    }
  }
  return declarations;
}

function parseExpected(record) {
  const signature = String(record.api_signature || '').trim();
  const callIndex = signature.indexOf('(');
  const head = callIndex >= 0 ? signature.slice(0, callIndex) : signature;
  const parts = head.split('.').filter(Boolean);
  const inferredMember = parts.pop() || '';
  const member = inferredMember || String(record.api_kwd || '').trim();
  const owner = parts.pop() || '';
  const documentedOwners = [...String(record.possible_module_title || '')
    .matchAll(/\b(?:Class|Interface)\s*\(([A-Za-z_$][\w$]*)\)/g)]
    .map(match => match[1])
    .filter(candidate => candidate.toLowerCase() !== owner.toLowerCase());
  const event = (signature.match(/['"]([^'"]+)['"]/) || [])[1] || '';
  const callable = /\)\s*:/.test(String(record.descrip0 || ''));
  return { member, owner, documentedOwners, event, kind: callable ? 'method' : 'property' };
}

function arityFromDescription(description) {
  const source = ts.createSourceFile(
    'catalog.ts',
    `declare class Catalog { ${String(description || '')}; }`,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS
  );
  const declaration = source.statements.find(ts.isClassDeclaration);
  const method = declaration?.members.find(member => ts.isMethodDeclaration(member));
  return method ? parameterRange(method.parameters) : undefined;
}

function rangeCompatible(expected, actual) {
  if (!expected) return true;
  const expectedMax = expected.maxArgs === null ? Number.POSITIVE_INFINITY : expected.maxArgs;
  const actualMax = actual.maxArgs === null ? Number.POSITIVE_INFINITY : actual.maxArgs;
  return expected.minArgs >= actual.minArgs && expectedMax <= actualMax;
}

function auditRecord(record, index, sdkPath, declarationCache) {
  const expected = parseExpected(record);
  const files = candidateFiles(record, sdkPath);
  const externalSdkMissing = files.length === 0;
  const declarations = files.flatMap(file => {
    if (!declarationCache.has(file)) declarationCache.set(file, declarationsIn(file));
    return declarationCache.get(file);
  });
  const members = declarations.filter(declaration =>
    declaration.name.toLowerCase() === expected.member.toLowerCase() && declaration.kind === expected.kind
  );
  const originalOwnerMatches = expected.owner
    ? members.filter(declaration => declaration.owners.some(owner => owner.toLowerCase() === expected.owner.toLowerCase()))
    : members;
  const acceptedOwners = [expected.owner, ...expected.documentedOwners].filter(Boolean);
  const ownerMatches = expected.owner
    ? members.filter(declaration => declaration.owners.some(owner =>
        acceptedOwners.some(accepted => accepted.toLowerCase() === owner.toLowerCase())
      ))
    : members;
  const expectedArity = expected.kind === 'method' ? arityFromDescription(record.descrip0) : undefined;
  const overloadMatches = ownerMatches.filter(declaration => rangeCompatible(expectedArity, declaration));
  const eventMatches = expected.event
    ? overloadMatches.filter(declaration => {
        const normalized = declaration.firstParameterType.toLowerCase();
        const full = expected.event.toLowerCase();
        const tail = full.split('.').pop();
        return normalized.includes(full) || normalized.includes(tail);
      })
    : overloadMatches;

  let status = 'resolved';
  if (externalSdkMissing) status = 'external_sdk_missing';
  else if (members.length === 0) status = 'member_missing';
  else if (ownerMatches.length === 0) status = 'owner_mismatch';
  else if (overloadMatches.length === 0) status = 'overload_mismatch';
  else if (eventMatches.length === 0) status = 'event_discriminator_mismatch';
  else if (originalOwnerMatches.length === 0 && expected.documentedOwners.length > 0) {
    status = 'resolved_with_documented_receiver';
  }

  return {
    index,
    api: record.api_signature,
    importKit: record.import_kit,
    dataType: record.dataType,
    label: record.label,
    status,
    expected,
    candidateFiles: files.map(file => path.relative(sdkPath, file).replace(/\\/g, '/')),
    evidence: eventMatches.slice(0, 5).map(declaration => ({
      file: path.relative(sdkPath, declaration.file).replace(/\\/g, '/'),
      owners: declaration.owners,
      declaration: declaration.declaration,
    })),
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.sdkPath || !fs.existsSync(args.sdkPath)) {
    throw new Error(`SDK path does not exist: ${args.sdkPath}`);
  }
  const catalog = JSON.parse(fs.readFileSync(args.catalog, 'utf8'));
  if (!Array.isArray(catalog)) throw new Error('Reviewed catalog must be a JSON array');
  const sdkManifestPath = path.join(args.sdkPath, 'oh-uni-package.json');
  if (!fs.existsSync(sdkManifestPath)) {
    throw new Error(`Invalid OpenHarmony ets SDK: missing ${sdkManifestPath}`);
  }
  const sdkManifest = JSON.parse(fs.readFileSync(sdkManifestPath, 'utf8'));
  const declarationCache = new Map();
  const entries = catalog.map((record, index) => auditRecord(record, index, args.sdkPath, declarationCache));
  const statuses = entries.reduce((counts, entry) => {
    counts[entry.status] = (counts[entry.status] || 0) + 1;
    return counts;
  }, {});
  const result = {
    schemaVersion: 1,
    catalog: path.relative(process.cwd(), args.catalog).replace(/\\/g, '/'),
    sdk: {
      path: args.sdkPath.replace(/\\/g, '/'),
      apiVersion: String(sdkManifest.apiVersion || ''),
      version: String(sdkManifest.version || ''),
      releaseType: String(sdkManifest.releaseType || ''),
    },
    summary: {
      rows: catalog.length,
      statuses,
      sdkModuleRows: catalog.length - (statuses.external_sdk_missing || 0),
      resolvedSdkRows: (statuses.resolved || 0) + (statuses.resolved_with_documented_receiver || 0),
    },
    entries,
  };
  fs.mkdirSync(path.dirname(args.output), { recursive: true });
  fs.writeFileSync(args.output, `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify(result.summary, null, 2));
  console.log(`[AUDIT] ${args.output}`);
}

if (require.main === module) main();

module.exports = { auditRecord, candidateFiles, parseExpected };
