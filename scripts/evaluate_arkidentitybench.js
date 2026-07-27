const fs = require('fs');
const path = require('path');
const ts = require('typescript');

function parseArgs(argv) {
  const result = { oracle: '', reports: '', outputDir: '' };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--oracle') result.oracle = path.resolve(argv[++i]);
    else if (argv[i] === '--reports') result.reports = path.resolve(argv[++i]);
    else if (argv[i] === '--output-dir') result.outputDir = path.resolve(argv[++i]);
    else throw new Error(`Unknown argument: ${argv[i]}`);
  }
  if (!result.oracle || !result.reports || !result.outputDir) {
    throw new Error(
      'Usage: node scripts/evaluate_arkidentitybench.js '
        + '--oracle <json> --reports <dir> --output-dir <dir>',
    );
  }
  return result;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, ''));
}

function walkFiles(root, predicate) {
  const output = [];
  const pending = [root];
  while (pending.length > 0) {
    const current = pending.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const target = path.join(current, entry.name);
      if (entry.isDirectory() && entry.name !== 'logs') pending.push(target);
      else if (entry.isFile() && predicate(entry.name)) output.push(target);
    }
  }
  return output.sort();
}

function reportIndex(root) {
  const result = new Map();
  for (const filePath of walkFiles(root, name => name.endsWith('-arkprism-report.json'))) {
    const report = readJson(filePath);
    if (result.has(report.projectName)) throw new Error(`Duplicate report: ${report.projectName}`);
    result.set(report.projectName, report);
  }
  return result;
}

function expressionPath(node) {
  const parts = [];
  let current = node;
  while (ts.isPropertyAccessExpression(current)) {
    parts.unshift(current.name.text);
    current = current.expression;
  }
  if (ts.isIdentifier(current)) {
    parts.unshift(current.text);
    return parts;
  }
  if (current.kind === ts.SyntaxKind.ThisKeyword) {
    parts.unshift('this');
    return parts;
  }
  return [];
}

function unwrapExpression(node) {
  let current = node;
  while (
    ts.isAwaitExpression(current) ||
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

function analyzeSource(sourceText, target) {
  const source = ts.createSourceFile(
    'IdentityCase.ets',
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const imports = new Map();
  const declaredReceivers = new Map();
  const factoryReceivers = new Map();
  const calls = [];
  const propertyReads = [];

  function typeText(node) {
    return node ? node.getText(source).replace(/\s+/g, '') : '';
  }

  function recordImport(node) {
    if (!node.importClause) return;
    if (node.importClause.name) {
      const moduleName = String(node.moduleSpecifier.text || '');
      const fileName = moduleName.split('/').pop() || '';
      const canonical = fileName.startsWith('@')
        ? fileName.split('.').pop()
        : fileName;
      imports.set(node.importClause.name.text, canonical);
    }
    const bindings = node.importClause.namedBindings;
    if (bindings && ts.isNamedImports(bindings)) {
      for (const element of bindings.elements) {
        imports.set(
          element.name.text,
          element.propertyName ? element.propertyName.text : element.name.text,
        );
      }
    }
  }

  function receiverKey(node) {
    const parts = expressionPath(node);
    return parts.join('.');
  }

  function recordDeclaration(name, typeNode, initializer) {
    const type = typeText(typeNode);
    if (target.receiverClass && type.includes(target.receiverClass)) {
      declaredReceivers.set(name, target.receiverClass);
    }
    const value = initializer ? unwrapExpression(initializer) : null;
    if (value && ts.isCallExpression(value)) {
      const pathParts = expressionPath(value.expression);
      const root = imports.get(pathParts[0]) || pathParts[0];
      if (pathParts.length > 0) pathParts[0] = root;
      if (target.factoryPath && pathParts.join('.') === target.factoryPath) {
        factoryReceivers.set(name, target.receiverClass);
      }
    } else if (value && ts.isIdentifier(value)) {
      if (declaredReceivers.has(value.text)) {
        declaredReceivers.set(name, declaredReceivers.get(value.text));
      }
      if (factoryReceivers.has(value.text)) {
        factoryReceivers.set(name, factoryReceivers.get(value.text));
      }
    }
  }

  function visit(node) {
    if (ts.isImportDeclaration(node)) recordImport(node);
    if (ts.isParameter(node) && ts.isIdentifier(node.name)) {
      recordDeclaration(node.name.text, node.type, node.initializer);
    }
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
      recordDeclaration(node.name.text, node.type, node.initializer);
    }
    if (ts.isPropertyDeclaration(node) && ts.isIdentifier(node.name)) {
      recordDeclaration(`this.${node.name.text}`, node.type, node.initializer);
    }
    if (ts.isBinaryExpression(node) &&
        node.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
      const key = receiverKey(node.left);
      if (key) recordDeclaration(key, null, node.right);
    }
    if (ts.isCallExpression(node)) {
      const parts = expressionPath(node.expression);
      if (parts.length > 0) {
        const canonical = [...parts];
        canonical[0] = imports.get(canonical[0]) || canonical[0];
        calls.push({
          raw: parts,
          canonical,
          receiver: parts.slice(0, -1).join('.'),
          method: parts[parts.length - 1],
          firstArgument: node.arguments[0] && ts.isStringLiteral(node.arguments[0])
            ? node.arguments[0].text
            : '',
        });
      }
    } else if (ts.isPropertyAccessExpression(node) &&
               !ts.isCallExpression(node.parent) &&
               node.parent.expression !== node) {
      const parts = expressionPath(node);
      if (parts.length > 0) {
        const canonical = [...parts];
        canonical[0] = imports.get(canonical[0]) || canonical[0];
        propertyReads.push(canonical);
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(source);

  const eventMatches = call =>
    !target.eventLiteral || call.firstArgument === target.eventLiteral;
  const namespace = target.accessKind === 'property'
    ? propertyReads.some(parts => parts.join('.') === target.canonicalPath)
    : calls.some(call =>
        call.canonical.join('.') === target.canonicalPath && eventMatches(call),
      );
  const declaredReceiver = namespace || Boolean(target.receiverClass) && calls.some(call =>
    call.method === target.method.split('(')[0] &&
    declaredReceivers.get(call.receiver) === target.receiverClass &&
    eventMatches(call),
  );
  const factoryAware = declaredReceiver || Boolean(target.receiverClass) && calls.some(call =>
    call.method === target.method.split('(')[0] &&
    factoryReceivers.get(call.receiver) === target.receiverClass &&
    eventMatches(call),
  );
  return {
    namespace,
    declaredReceiver,
    factoryAware,
  };
}

function detectorPrediction(report, target) {
  const expectedNamespace = String(target.namespace).toLowerCase();
  const expectedMethod = String(target.method).toLowerCase().replace(/\s+/g, '');
  return (report.privacyApiUsages || []).some(usage => {
    const namespace = String(usage.namespace || '').toLowerCase();
    const method = String(usage.method || '').toLowerCase().replace(/\s+/g, '');
    return namespace === expectedNamespace && method === expectedMethod;
  });
}

function metrics(rows, key) {
  let tp = 0;
  let tn = 0;
  let fp = 0;
  let fn = 0;
  for (const row of rows) {
    if (row.expected && row[key]) tp++;
    else if (!row.expected && !row[key]) tn++;
    else if (!row.expected && row[key]) fp++;
    else fn++;
  }
  const precision = tp + fp ? tp / (tp + fp) : 0;
  const recall = tp + fn ? tp / (tp + fn) : 0;
  const specificity = tn + fp ? tn / (tn + fp) : 0;
  const f1 = precision + recall ? 2 * precision * recall / (precision + recall) : 0;
  return { tp, tn, fp, fn, precision, recall, specificity, f1 };
}

function percent(value) {
  return `${(value * 100).toFixed(2)}%`;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const oracle = readJson(args.oracle);
  const reports = reportIndex(args.reports);
  const rows = [];
  for (const testCase of oracle.cases) {
    const report = reports.get(testCase.id);
    if (!report) throw new Error(`Missing report: ${testCase.id}`);
    const sourcePath = path.join(path.dirname(args.oracle), testCase.id, testCase.sourceFile);
    const sourceText = fs.readFileSync(sourcePath, 'utf8');
    const staticModels = analyzeSource(sourceText, testCase.target);
    rows.push({
      id: testCase.id,
      family: testCase.family,
      expected: testCase.expected,
      evidence: testCase.evidence,
      lexical: sourceText.includes(testCase.target.lexicalToken),
      namespace: staticModels.namespace,
      declaredReceiver: staticModels.declaredReceiver,
      factoryAware: staticModels.factoryAware,
      arkprism: detectorPrediction(report, testCase.target),
    });
  }

  const tools = [
    ['lexical', 'Lexical token'],
    ['namespace', 'Import-aware namespace'],
    ['declaredReceiver', 'Declared-receiver AST'],
    ['factoryAware', 'Factory-aware AST'],
    ['arkprism', 'ArkPrism'],
  ].map(([key, name]) => ({ key, name, overall: metrics(rows, key) }));
  const result = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    oracle: {
      path: args.oracle,
      cases: rows.length,
      positives: rows.filter(row => row.expected).length,
      negatives: rows.filter(row => !row.expected).length,
    },
    tools,
    rows,
  };
  fs.mkdirSync(args.outputDir, { recursive: true });
  fs.writeFileSync(
    path.join(args.outputDir, 'arkidentitybench_results.json'),
    `${JSON.stringify(result, null, 2)}\n`,
    'utf8',
  );
  const lines = [
    '# ArkIdentityBench',
    '',
    `Oracle: ${result.oracle.cases} cases; ${result.oracle.positives} positive and ${result.oracle.negatives} negative.`,
    '',
    '| Configuration | TP | TN | FP | FN | Precision | Recall | Specificity | F1 |',
    '|---|---:|---:|---:|---:|---:|---:|---:|---:|',
    ...tools.map(tool => {
      const value = tool.overall;
      return `| ${tool.name} | ${value.tp} | ${value.tn} | ${value.fp} | ${value.fn} | `
        + `${percent(value.precision)} | ${percent(value.recall)} | `
        + `${percent(value.specificity)} | ${percent(value.f1)} |`;
    }),
    '',
  ];
  fs.writeFileSync(
    path.join(args.outputDir, 'arkidentitybench_results.md'),
    `${lines.join('\n')}\n`,
    'utf8',
  );
  console.log(lines.join('\n'));
}

if (require.main === module) main();

module.exports = {
  analyzeSource,
  detectorPrediction,
  metrics,
};
