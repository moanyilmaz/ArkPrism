const assert = require('assert');
const childProcess = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = path.resolve(__dirname, '..');
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'arkprism-source-first-'));

try {
  const project = path.join(temporary, 'dataset', 'EnumeratorCase');
  const sourceDirectory = path.join(project, 'entry', 'src', 'main', 'ets');
  fs.mkdirSync(sourceDirectory, { recursive: true });
  fs.writeFileSync(path.join(sourceDirectory, 'Index.ets'), [
    "import { request as req, getOAID as readId } from '@kit.BasicServicesKit';",
    "const createAgent = req.agent['create'];",
    'export function execute(context: object, config: object): void {',
    '  createAgent(context, config);',
    "  req.agent['create'](context, config);",
    '  readId();',
    '}',
    '',
  ].join('\n'));

  const manifest = path.join(temporary, 'manifest.json');
  const rules = path.join(temporary, 'rules.json');
  const output = path.join(temporary, 'queue.json');
  fs.writeFileSync(manifest, JSON.stringify({
    benchmark: 'EnumeratorCase',
    projects: [{
      project: 'EnumeratorCase',
      importStratum: 'configured_import',
      sizeStratum: 'small',
    }],
  }));
  fs.writeFileSync(rules, JSON.stringify([{
    systemPackage: '@kit.BasicServicesKit',
    privacyApis: [
      { namespace: 'request.agent', method: 'create', directCall: true },
      { namespace: 'identifier', method: 'getOAID', directCall: true },
    ],
  }]));

  childProcess.execFileSync(process.execPath, [
    path.join(root, 'scripts', 'generate_source_first_review_queue.js'),
    '--dataset', path.join(temporary, 'dataset'),
    '--manifest', manifest,
    '--rules', rules,
    '--output', output,
  ], { cwd: root, stdio: 'pipe' });

  const queue = JSON.parse(fs.readFileSync(output, 'utf8'));
  const candidates = queue.projects[0].candidates;
  assert.strictEqual(candidates.length, 3);
  assert.deepStrictEqual(candidates.map(candidate => candidate.line), [4, 5, 6]);
  assert.deepStrictEqual(candidates.map(candidate => candidate.member), ['create', 'create', 'getOAID']);
  assert.strictEqual(candidates[0].aliasOrigin, 'createAgent');
  assert.strictEqual(candidates[1].receiver, 'req.agent');
  assert.strictEqual(candidates[2].aliasOrigin, 'readId');

  console.log('Source-first candidate enumerator verified: alias, element, and named-import calls.');
} finally {
  fs.rmSync(temporary, { recursive: true, force: true });
}
