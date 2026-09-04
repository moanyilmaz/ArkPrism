'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { normalizeSensitiveApiCatalog } = require('../dist/sensitiveApiCatalog');

const repoRoot = path.resolve(__dirname, '..');
const sdkPath = process.env.OPENHARMONY_SDK_PATH;
if (!sdkPath || !fs.existsSync(sdkPath)) {
  throw new Error('OPENHARMONY_SDK_PATH must point to a real OpenHarmony ets SDK');
}

function methodName(method) {
  return method.replace(/\(\)\s*$/, '').replace(/\s*\(.*/, '').split('.').pop();
}

function callArguments(rule) {
  const overload = (rule.overloads || [])[0];
  const required = overload ? overload.minArgs : 0;
  const event = rule.method.match(/['"]([^'"]+)['"]/);
  const args = event ? [`'${event[1]}'`] : [];
  while (args.length < required) args.push('undefined as any');
  return args.join(', ');
}

function witnessSource(rule, index) {
  const imported = `CatalogImport${index}`;
  const receiver = `catalogReceiver${index}`;
  const args = callArguments(rule);
  const member = methodName(rule.method);
  const className = `CatalogCase${String(index).padStart(3, '0')}`;
  const nestedReceiverCall = rule.directCall === false &&
    rule.method.startsWith(`${rule.namespace}.`);

  if (rule.directCall === null) {
    return [
      `import { ${rule.namespace} as ${imported} } from '${rule.systemPackage}';`,
      '',
      `export class ${className} {`,
      '  run(): void {',
      `    const value = ${imported}.${member};`,
      '    console.info(String(value));',
      '  }',
      '}',
      '',
    ].join('\n');
  }

  if (nestedReceiverCall) {
    const memberPath = rule.method.replace(/\s*\(.*/, '');
    return [
      `import { ${rule.namespace} as ${imported} } from '${rule.systemPackage}';`,
      '',
      `export class ${className} {`,
      '  run(): void {',
      `    ${imported}.${memberPath}(${args});`,
      '  }',
      '}',
      '',
    ].join('\n');
  }

  if (rule.directCall === false) {
    const receiverType = (rule.receiverTypes || [])[0] || rule.namespace;
    return [
      `import { ${receiverType} as ${imported} } from '${rule.systemPackage}';`,
      '',
      `export class ${className} {`,
      `  run(${receiver}: ${imported}): void {`,
      `    ${receiver}.${member}(${args});`,
      '  }',
      '}',
      '',
    ].join('\n');
  }

  const topLevelFunction = rule.namespace === rule.method;
  const invocation = topLevelFunction
    ? `${imported}(${args})`
    : `${imported}.${member}(${args})`;
  return [
    `import { ${rule.namespace} as ${imported} } from '${rule.systemPackage}';`,
    '',
    `export class ${className} {`,
    '  run(): void {',
    `    ${invocation};`,
    '  }',
    '}',
    '',
  ].join('\n');
}

function identity(rule) {
  return [
    rule.systemPackage,
    rule.namespace,
    rule.method,
    rule.dataType,
    rule.label,
  ].join('|');
}

const rawCatalog = JSON.parse(fs.readFileSync(
  path.join(repoRoot, 'config', 'sensitive_apis.json'),
  'utf8',
));
const rules = normalizeSensitiveApiCatalog(rawCatalog).flatMap(group =>
  group.privacyApis.map(rule => ({ ...rule, systemPackage: group.systemPackage })),
);
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'arkprism-catalog-detectability-'));
const projectName = 'catalog-detectability';
const projectRoot = path.join(root, projectName);
const sourceRoot = path.join(projectRoot, 'entry', 'src', 'main', 'ets');
const outputRoot = path.join(root, 'output');

try {
  fs.mkdirSync(sourceRoot, { recursive: true });
  const expectedByFile = new Map();
  rules.forEach((rule, index) => {
    const filename = `CatalogCase${String(index).padStart(3, '0')}.ets`;
    fs.writeFileSync(path.join(sourceRoot, filename), witnessSource(rule, index), 'utf8');
    expectedByFile.set(filename.toLowerCase(), rule);
  });

  const child = spawnSync(process.execPath, [
    'dist/arkprism.js',
    projectRoot,
    '--output-dir',
    outputRoot,
    '--sdkPath',
    sdkPath,
    '--no-taint',
    '--no-dot',
  ], {
    cwd: repoRoot,
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
    maxBuffer: 16 * 1024 * 1024,
  });
  if (child.status !== 0) {
    process.stderr.write(child.stdout || '');
    process.stderr.write(child.stderr || '');
    throw new Error(`ArkPrism exited with status ${child.status}`);
  }

  const reportPath = path.join(
    outputRoot,
    projectName,
    `${projectName}-arkprism-report.json`,
  );
  const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
  const actualByFile = new Map();
  for (const usage of report.privacyApiUsages || []) {
    const filename = path.basename(usage.file).toLowerCase();
    if (!actualByFile.has(filename)) actualByFile.set(filename, []);
    actualByFile.get(filename).push(usage);
  }

  const failures = [];
  for (const [filename, expected] of expectedByFile) {
    const usages = actualByFile.get(filename) || [];
    if (usages.length !== 1) {
      const identities = usages.map(usage => [
        usage.apiPackage,
        usage.namespace,
        usage.method,
        usage.dataType,
        usage.label,
      ].join('|'));
      failures.push(
        `${filename}: expected one detection, found ${usages.length}` +
        (identities.length > 0 ? ` (${identities.join('; ')})` : ''),
      );
      continue;
    }
    const usage = usages[0];
    const actualIdentity = [
      usage.apiPackage,
      usage.namespace,
      usage.method,
      usage.dataType,
      usage.label,
    ].join('|');
    if (actualIdentity !== identity(expected)) {
      failures.push(
        `${filename}: expected ${identity(expected)}, found ${actualIdentity}`,
      );
    }
    if (usage.catalogApiSignature !== expected.catalogApiSignature) {
      failures.push(
        `${filename}: catalog signature ${usage.catalogApiSignature} does not match ` +
        expected.catalogApiSignature,
      );
    }
    if (usage.locationEvidence !== 'source_ast' || !usage.line) {
      failures.push(`${filename}: source location was not recovered from the AST`);
    }
  }

  for (const filename of actualByFile.keys()) {
    if (!expectedByFile.has(filename)) failures.push(`${filename}: unexpected detection file`);
  }
  if (failures.length > 0) {
    throw new Error(
      `Sensitive API detectability failed (${failures.length}):\n${failures.join('\n')}`,
    );
  }

  const counts = rules.reduce((result, rule) => {
    const kind = rule.directCall === true
      ? 'direct'
      : rule.directCall === false ? 'indirect' : 'property';
    result[kind]++;
    return result;
  }, { direct: 0, indirect: 0, property: 0 });
  console.log(
    `Sensitive API detectability verified: ${rules.length} identities ` +
    `(${counts.direct} direct, ${counts.indirect} indirect, ${counts.property} property).`,
  );
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
