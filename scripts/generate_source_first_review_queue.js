const fs = require('fs');
const path = require('path');
const ts = require('ohos-typescript');

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
  const groups = JSON.parse(fs.readFileSync(file, 'utf8'));
  const byPackage = new Map();
  for (const group of groups) {
    const rules = (group.privacyApis || []).map(api => ({
      package: group.systemPackage,
      namespace: api.namespace,
      member: normalizedMember(api.method),
      configuredMethod: api.method,
      accessKind: api.directCall === null ? 'property' : 'call',
      event: eventDiscriminator(api.method),
      category: api.profilingCategory || '',
      permission: api.permission || null,
    }));
    byPackage.set(group.systemPackage, (byPackage.get(group.systemPackage) || []).concat(rules));
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
  const rules = [];
  for (const imported of imports) {
    for (const rulePackage of [imported, ...(PACKAGE_ALIASES[imported] || [])]) {
      rules.push(...(rulesByPackage.get(rulePackage) || []));
    }
  }
  return rules;
}

function stringArgument(call) {
  if (!call || call.arguments.length === 0) return '';
  const argument = call.arguments[0];
  return ts.isStringLiteral(argument) || ts.isNoSubstitutionTemplateLiteral(argument)
    ? argument.text
    : '';
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
        rule.accessKind === 'call' && rule.member.toLowerCase() === importedName.toLowerCase(),
      );
      if (matched.length > 0) aliases.set(element.name.text, matched);
    }
  }
  return aliases;
}

function candidateQueue(projectRoot, rulesByPackage) {
  const candidates = [];
  const files = walkSources(projectRoot);
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
    const key = rule.member.toLowerCase();
    rulesByMember.set(key, (rulesByMember.get(key) || []).concat(rule));
  }

  for (const { file, sourceFile, imports } of parsedFiles) {
    const callableAliases = importMemberAliases(sourceFile, rulesByPackage);

    function rulesForAccess(node) {
      const member = ts.isPropertyAccessExpression(node) ? node.name.text : staticElementMember(node);
      if (!member) return { member: '', call: null, rules: [] };
      const call = invokedCall(node);
      const matched = rulesByMember.get(member.toLowerCase()) || [];
      return {
        member,
        call,
        rules: matched.filter(rule => rule.accessKind === (call ? 'call' : 'property')),
      };
    }

    function collectAliases(node) {
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
        const initializer = unwrapExpression(node.initializer);
        if (ts.isPropertyAccessExpression(initializer) || ts.isElementAccessExpression(initializer)) {
          const member = ts.isPropertyAccessExpression(initializer)
            ? initializer.name.text
            : staticElementMember(initializer);
          const callable = (rulesByMember.get(member.toLowerCase()) || [])
            .filter(rule => rule.accessKind === 'call');
          if (callable.length > 0) callableAliases.set(node.name.text, callable);
        }
      }
      if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
          ts.isIdentifier(node.left)) {
        const right = unwrapExpression(node.right);
        if (ts.isPropertyAccessExpression(right) || ts.isElementAccessExpression(right)) {
          const member = ts.isPropertyAccessExpression(right) ? right.name.text : staticElementMember(right);
          const callable = (rulesByMember.get(member.toLowerCase()) || [])
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
          const callable = (rulesByMember.get(importedName.toLowerCase()) || [])
            .filter(rule => rule.accessKind === 'call');
          if (callable.length > 0) callableAliases.set(element.name.text, callable);
        }
      }
      ts.forEachChild(node, collectAliases);
    }
    collectAliases(sourceFile);

    const seen = new Set();
    function addCandidate(node, member, accessKind, receiver, expression, candidateRules, aliasOrigin) {
      if (candidateRules.length === 0) return;
      const start = node.getStart(sourceFile);
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
        const firstArgument = stringArgument(call);
        const eventCompatible = candidateRules.filter(rule =>
          !rule.event || rule.event === firstArgument,
        );
        addCandidate(
          call || node,
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
          const firstArgument = stringArgument(node);
          const candidateRules = callableAliases.get(callee.text).filter(rule =>
            !rule.event || rule.event === firstArgument,
          );
          addCandidate(
            node,
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
    const candidates = candidateQueue(root, rulesByPackage);
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
