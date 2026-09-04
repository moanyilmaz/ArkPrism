const fs = require('fs');
const path = require('path');
const ts = require('ohos-typescript');
const { normalizeSensitiveApiCatalog } = require('../dist/sensitiveApiCatalog');

const PACKAGE_ALIASES = require('../config/package_aliases.json');
const SOURCE_EXTENSIONS = new Set(['.ets', '.ts']);
const SKIPPED_DIRECTORIES = new Set([
  '.git', '.hvigor', '.idea', '.preview', 'build', 'cache', 'node_modules',
  'oh_modules', 'resources', 'rawfile',
]);

function parseArgs(argv) {
  const args = { dataset: '', manifest: '', rules: '', output: '' };
  for (let index = 0; index < argv.length; index++) {
    const name = argv[index];
    if (name === '--dataset') args.dataset = path.resolve(argv[++index]);
    else if (name === '--manifest') args.manifest = path.resolve(argv[++index]);
    else if (name === '--rules') args.rules = path.resolve(argv[++index]);
    else if (name === '--output') args.output = path.resolve(argv[++index]);
    else throw new Error(`Unknown argument: ${name}`);
  }
  for (const [name, value] of Object.entries(args)) {
    if (!value) throw new Error(`--${name} is required`);
  }
  return args;
}

function walkSources(directory, files = []) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (!SKIPPED_DIRECTORIES.has(entry.name)) walkSources(fullPath, files);
    } else if (SOURCE_EXTENSIONS.has(path.extname(entry.name))) {
      files.push(fullPath);
    }
  }
  return files.sort();
}

function normalizedMember(method) {
  const base = String(method).replace(/\(\)\s*$/, '').replace(/\s*\(.*/, '');
  return base.split('.').filter(Boolean).pop() || base;
}

function eventDiscriminator(method) {
  const match = String(method).match(/['"]([^'"]+)['"]/);
  return match ? match[1] : '';
}

function loadRules(file) {
  const groups = normalizeSensitiveApiCatalog(JSON.parse(fs.readFileSync(file, 'utf8')));
  const byPackage = new Map();
  for (const group of groups) {
    const rules = (group.privacyApis || []).map(api => ({
      package: group.systemPackage,
      packageAliases: api.packageAliases || [],
      namespace: api.namespace,
      member: normalizedMember(api.method),
      configuredMethod: api.method,
      accessKind: api.directCall === null ? 'property' : 'call',
      callPattern: api.directCall === true
        ? 'direct'
        : api.directCall === false ? 'indirect' : 'property',
      event: eventDiscriminator(api.method),
      category: api.profilingCategory || '',
      permission: api.permission || null,
      dataType: api.dataType,
      label: api.label,
      receiverTypes: api.receiverTypes || [],
      catalogApiSignature: api.catalogApiSignature,
    }));
    for (const rule of rules) {
      const packageNames = new Set([
        group.systemPackage,
        ...(PACKAGE_ALIASES[group.systemPackage] || []),
        ...rule.packageAliases,
      ]);
      for (const packageName of packageNames) {
        byPackage.set(packageName, (byPackage.get(packageName) || []).concat(rule));
      }
    }
  }
  return byPackage;
}

function importedPackages(sourceFile) {
  const packages = new Set();
  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
    const imported = statement.moduleSpecifier.text;
    if (imported.startsWith('@kit.') || imported.startsWith('@ohos.') || imported.startsWith('@hms.')) {
      packages.add(imported);
    }
  }
  return packages;
}

function relatedRules(imports, rulesByPackage) {
  const rules = new Map();
  for (const imported of imports) {
    for (const rulePackage of [imported, ...(PACKAGE_ALIASES[imported] || [])]) {
      for (const rule of rulesByPackage.get(rulePackage) || []) {
        const key = [rule.package, rule.namespace, rule.configuredMethod, rule.dataType, rule.label].join('|');
        rules.set(key, rule);
      }
    }
  }
  return [...rules.values()];
}

function staticEventArgument(call, sourceFile) {
  if (!call || call.arguments.length === 0) return { known: false, value: '' };
  const argument = unwrapExpression(call.arguments[0]);
  if (ts.isStringLiteral(argument) || ts.isNoSubstitutionTemplateLiteral(argument)) {
    return { known: true, value: argument.text };
  }
  if (ts.isPropertyAccessExpression(argument)) {
    return { known: true, value: argument.getText(sourceFile).replace(/\s+/g, '') };
  }
  return { known: false, value: argument.getText(sourceFile).replace(/\s+/g, '') };
}

function eventMatches(rule, argument) {
  if (!rule.event || !argument.known) return true;
  const expected = rule.event.replace(/\s+/g, '');
  const expectedTail = expected.split('.').pop();
  return argument.value === expected ||
    argument.value.endsWith(`.${expected}`) ||
    argument.value === expectedTail;
}

function staticElementMember(node) {
  if (!ts.isElementAccessExpression(node)) return '';
  const argument = node.argumentExpression;
  return ts.isStringLiteral(argument) || ts.isNoSubstitutionTemplateLiteral(argument)
    ? argument.text
    : '';
}

function unwrapExpression(node) {
  let current = node;
  while (current && (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isTypeAssertionExpression(current) ||
    ts.isNonNullExpression(current)
  )) {
    current = current.expression;
  }
  return current;
}

function invokedCall(node) {
  let current = node;
  let parent = current.parent;
  while (parent && (
    ts.isParenthesizedExpression(parent) ||
    ts.isAsExpression(parent) ||
    ts.isTypeAssertionExpression(parent) ||
    ts.isNonNullExpression(parent)
  )) {
    current = parent;
    parent = current.parent;
  }
  return parent && ts.isCallExpression(parent) && parent.expression === current ? parent : null;
}

function importMemberAliases(sourceFile, rulesByPackage) {
  const aliases = new Map();
  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
    const imported = statement.moduleSpecifier.text;
    const packageRules = relatedRules(new Set([imported]), rulesByPackage);
    const bindings = statement.importClause?.namedBindings;
    if (!bindings || !ts.isNamedImports(bindings)) continue;
    for (const element of bindings.elements) {
      const importedName = element.propertyName?.text || element.name.text;
      const matched = packageRules.filter(rule =>
        rule.accessKind === 'call' && rule.member === importedName,
      );
      if (matched.length > 0) aliases.set(element.name.text, matched);
    }
  }
  return aliases;
}

function isWriteAccess(node) {
  let current = node;
  let parent = current.parent;
  while (parent && (
    ts.isParenthesizedExpression(parent) ||
    ts.isAsExpression(parent) ||
    ts.isTypeAssertionExpression(parent) ||
    ts.isNonNullExpression(parent)
  )) {
    current = parent;
    parent = current.parent;
  }
  if (parent && ts.isBinaryExpression(parent) && parent.left === current) {
    return parent.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
      parent.operatorToken.kind <= ts.SyntaxKind.LastAssignment;
  }
  if (parent && (ts.isPrefixUnaryExpression(parent) || ts.isPostfixUnaryExpression(parent))) {
    return parent.operator === ts.SyntaxKind.PlusPlusToken ||
      parent.operator === ts.SyntaxKind.MinusMinusToken;
  }
  return parent && ts.isDeleteExpression(parent);
}

function sourceImportBindings(sourceFile) {
  const bindings = [];
  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
    const packageName = statement.moduleSpecifier.text;
    const clause = statement.importClause;
    if (!clause) continue;
    if (clause.name) {
      bindings.push({
        local: clause.name.text,
        imported: 'default',
        package: packageName,
        kind: 'default',
      });
    }
    if (clause.namedBindings && ts.isNamespaceImport(clause.namedBindings)) {
      bindings.push({
        local: clause.namedBindings.name.text,
        imported: '*',
        package: packageName,
        kind: 'namespace',
      });
    } else if (clause.namedBindings && ts.isNamedImports(clause.namedBindings)) {
      for (const element of clause.namedBindings.elements) {
        bindings.push({
          local: element.name.text,
          imported: element.propertyName?.text || element.name.text,
          package: packageName,
          kind: 'named',
        });
      }
    }
  }
  return bindings;
}

function receiverLookupKey(receiver) {
  const normalized = String(receiver || '').replace(/\?\./g, '.').trim();
  if (normalized.startsWith('this.')) return normalized.split('.').slice(0, 2).join('.');
  return normalized.split(/[.([?]/)[0];
}

function candidateQueue(projectRoot, sourceRoots, rulesByPackage) {
  const candidates = [];
  const files = [...new Set(sourceRoots.flatMap(root => walkSources(root, [])))].sort();
  const parsedFiles = files.map(file => {
    const text = fs.readFileSync(file, 'utf8');
    const sourceFile = ts.createSourceFile(
      file,
      text,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS,
    );
    const imports = importedPackages(sourceFile);
    return { file, sourceFile, imports };
  });
  const projectImports = new Set(
    parsedFiles.flatMap(parsed => [...parsed.imports]),
  );
  const projectRules = relatedRules(projectImports, rulesByPackage);
  const rulesByMember = new Map();
  for (const rule of projectRules) {
    const key = rule.member;
    rulesByMember.set(key, (rulesByMember.get(key) || []).concat(rule));
  }

  for (const { file, sourceFile, imports } of parsedFiles) {
    const callableAliases = importMemberAliases(sourceFile, rulesByPackage);
    const importBindings = sourceImportBindings(sourceFile);
    const sourceLines = sourceFile.getFullText().split(/\r?\n/);
    const typeHints = new Map();
    const receiverOrigins = new Map();

    function appendOrigin(name, expression) {
      if (!name || !expression) return;
      receiverOrigins.set(name, [
        ...(receiverOrigins.get(name) || []),
        expression,
      ]);
    }

    function collectTypeHints(node) {
      if ((ts.isVariableDeclaration(node) || ts.isParameter(node) ||
          ts.isPropertyDeclaration(node) || ts.isPropertySignature(node)) &&
          ts.isIdentifier(node.name) && node.type) {
        typeHints.set(node.name.text, node.type.getText(sourceFile));
      }
      if ((ts.isVariableDeclaration(node) || ts.isPropertyDeclaration(node)) &&
          ts.isIdentifier(node.name) && node.initializer) {
        appendOrigin(node.name.text, node.initializer.getText(sourceFile));
        appendOrigin(`this.${node.name.text}`, node.initializer.getText(sourceFile));
      }
      if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
        appendOrigin(node.left.getText(sourceFile), node.right.getText(sourceFile));
      }
      ts.forEachChild(node, collectTypeHints);
    }
    collectTypeHints(sourceFile);

    function rulesForAccess(node) {
      const member = ts.isPropertyAccessExpression(node) ? node.name.text : staticElementMember(node);
      if (!member) return { member: '', call: null, rules: [] };
      const call = invokedCall(node);
      const matched = rulesByMember.get(member) || [];
      return {
        member,
        call,
        rules: matched.filter(rule =>
          rule.accessKind === (call ? 'call' : 'property') &&
          (call || !isWriteAccess(node)),
        ),
      };
    }

    function collectAliases(node) {
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
        const initializer = unwrapExpression(node.initializer);
        if (ts.isPropertyAccessExpression(initializer) || ts.isElementAccessExpression(initializer)) {
          const member = ts.isPropertyAccessExpression(initializer)
            ? initializer.name.text
            : staticElementMember(initializer);
          const callable = (rulesByMember.get(member) || [])
            .filter(rule => rule.accessKind === 'call');
          if (callable.length > 0) callableAliases.set(node.name.text, callable);
        }
      }
      if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
          ts.isIdentifier(node.left)) {
        const right = unwrapExpression(node.right);
        if (ts.isPropertyAccessExpression(right) || ts.isElementAccessExpression(right)) {
          const member = ts.isPropertyAccessExpression(right) ? right.name.text : staticElementMember(right);
          const callable = (rulesByMember.get(member) || [])
            .filter(rule => rule.accessKind === 'call');
          if (callable.length > 0) callableAliases.set(node.left.text, callable);
        }
      }
      if (ts.isVariableDeclaration(node) && ts.isObjectBindingPattern(node.name) && node.initializer) {
        for (const element of node.name.elements) {
          if (!ts.isIdentifier(element.name)) continue;
          const importedName = element.propertyName && ts.isIdentifier(element.propertyName)
            ? element.propertyName.text
            : element.name.text;
          const callable = (rulesByMember.get(importedName) || [])
            .filter(rule => rule.accessKind === 'call');
          if (callable.length > 0) callableAliases.set(element.name.text, callable);
        }
      }
      ts.forEachChild(node, collectAliases);
    }
    collectAliases(sourceFile);

    const seen = new Set();
    function addCandidate(locationNode, member, accessKind, receiver, expression, candidateRules, aliasOrigin) {
      if (candidateRules.length === 0) return;
      const start = locationNode.getStart(sourceFile);
      const location = sourceFile.getLineAndCharacterOfPosition(start);
      const candidateKey = `${start}|${member}|${accessKind}`;
      if (seen.has(candidateKey)) return;
      seen.add(candidateKey);
      const candidate = {
        file: path.relative(projectRoot, file).replace(/\\/g, '/'),
        line: location.line + 1,
        column: location.character + 1,
        accessKind,
        receiver,
        member,
        expression,
        sourceSnippet: sourceLines.slice(
          Math.max(0, location.line - 2),
          Math.min(sourceLines.length, location.line + 3),
        ).map((line, offset) => ({
          line: Math.max(0, location.line - 2) + offset + 1,
          text: line,
        })),
        receiverTypeHint: typeHints.get(receiver.replace(/^this\./, '').split('.')[0]) || '',
        receiverOrigins: receiverOrigins.get(receiverLookupKey(receiver)) || [],
        importBindings,
        imports: [...imports].sort(),
        projectImports: [...projectImports].sort(),
        candidateApis: candidateRules,
      };
      if (aliasOrigin) candidate.aliasOrigin = aliasOrigin;
      candidates.push(candidate);
    }

    function visit(node) {
      if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
        const { member, call, rules: candidateRules } = rulesForAccess(node);
        if (!member) {
          ts.forEachChild(node, visit);
          return;
        }
        const accessKind = call ? 'call' : 'property';
        const firstArgument = staticEventArgument(call, sourceFile);
        const eventCompatible = candidateRules.filter(rule =>
          eventMatches(rule, firstArgument),
        );
        addCandidate(
          ts.isPropertyAccessExpression(node) ? node.name : node.argumentExpression,
          member,
          accessKind,
          node.expression.getText(sourceFile),
          (call || node).getText(sourceFile),
          eventCompatible,
          null,
        );
      } else if (ts.isCallExpression(node)) {
        const callee = unwrapExpression(node.expression);
        if (ts.isIdentifier(callee) && callableAliases.has(callee.text)) {
          const firstArgument = staticEventArgument(node, sourceFile);
          const candidateRules = callableAliases.get(callee.text).filter(rule =>
            eventMatches(rule, firstArgument),
          );
          addCandidate(
            callee,
            candidateRules[0]?.member || callee.text,
            'call',
            callee.text,
            node.getText(sourceFile),
            candidateRules,
            callee.text,
          );
        }
      }
      ts.forEachChild(node, visit);
    }
    visit(sourceFile);
  }
  return candidates;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const manifest = JSON.parse(fs.readFileSync(args.manifest, 'utf8'));
  const rulesByPackage = loadRules(args.rules);
  const projects = [];
  for (const project of manifest.projects) {
    const root = path.join(args.dataset, project.project);
    const sourceRoots = (project.sourceRoots || ['.']).map(sourceRoot =>
      path.resolve(root, sourceRoot),
    );
    const candidates = candidateQueue(root, sourceRoots, rulesByPackage);
    projects.push({
      project: project.project,
      importStratum: project.importStratum,
      sizeStratum: project.sizeStratum,
      candidates,
    });
  }
  const output = {
    schemaVersion: 1,
    benchmark: manifest.benchmark,
    role: 'manual-review-navigation-only',
    manifestSha256: require('crypto')
      .createHash('sha256')
      .update(fs.readFileSync(args.manifest))
      .digest('hex'),
    projectCount: projects.length,
    candidateCount: projects.reduce((sum, project) => sum + project.candidates.length, 0),
    projects,
  };
  fs.mkdirSync(path.dirname(args.output), { recursive: true });
  fs.writeFileSync(args.output, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({ output: args.output, candidates: output.candidateCount }));
}

main();
