const fs = require('fs');
const path = require('path');
const { Scene, SceneConfig } = require('../src/arkanalyzer');

const projectDir = path.resolve(process.argv[2] || '');
if (!fs.existsSync(projectDir)) {
  throw new Error('Usage: node scripts/dump_arkir.js <project-dir> [method-pattern]');
}
const methodPattern = (process.argv[3] || '').toLowerCase();
const skipped = new Set(['build', 'cache', 'node_modules', 'oh_modules', '.git', 'resources']);

function discover(root) {
  const files = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory() && !skipped.has(entry.name)) files.push(...discover(fullPath));
    if (entry.isFile() && ['.ets', '.ts'].includes(path.extname(entry.name))) files.push(fullPath);
  }
  return files;
}

const files = discover(projectDir);
const config = new SceneConfig();
config.buildFromProjectFiles(path.basename(projectDir), projectDir, files);
const scene = new Scene();
scene.buildBasicInfo(config);
scene.genArkFiles();
scene.inferTypes();

for (const method of scene.getMethods()) {
  const signature = method.getSignature().toString();
  if (methodPattern && !signature.toLowerCase().includes(methodPattern)) continue;
  const cfg = method.getCfg();
  if (!cfg) continue;

  console.log(`\nMETHOD ${signature}`);
  for (const block of cfg.getBlocks()) {
    const exceptional = block.getExceptionalSuccessorBlocks() || [];
    console.log(`  BLOCK ${block.getId()} exceptional=[${exceptional.map(item => item.getId()).join(',')}]`);
    for (const stmt of block.getStmts()) {
      const def = stmt.getDef();
      const uses = stmt.getUses();
      console.log(`    ${stmt.constructor.name}: ${stmt.toString()}`);
      console.log(`      def=${def ? `${def.constructor.name}:${def.toString()}` : '<none>'}`);
      console.log(`      uses=${uses.map(value => `${value.constructor.name}:${value.toString()}`).join(' | ')}`);
      if (stmt.getLeftOp && stmt.getRightOp) {
        const left = stmt.getLeftOp();
        const right = stmt.getRightOp();
        console.log(`      assign=${left.constructor.name} <- ${right.constructor.name}`);
      }
    }
  }
}
