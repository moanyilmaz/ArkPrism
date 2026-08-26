'use strict';

const assert = require('assert');
const path = require('path');
const { spawnSync } = require('child_process');
const {
  DEFAULT_MAX_OLD_SPACE_SIZE_MB,
  getRequiredHeapMb,
} = require('../dist/runtimeHeap');

assert.strictEqual(getRequiredHeapMb({}), DEFAULT_MAX_OLD_SPACE_SIZE_MB);
assert.strictEqual(getRequiredHeapMb({ ARKPRISM_MAX_OLD_SPACE_SIZE_MB: '0' }), 0);
assert.strictEqual(getRequiredHeapMb({ ARKPRISM_MAX_OLD_SPACE_SIZE_MB: '8192' }), 8192);
assert.throws(
  () => getRequiredHeapMb({ ARKPRISM_MAX_OLD_SPACE_SIZE_MB: 'invalid' }),
  /HEAP_CONFIG_INVALID/,
);

const result = spawnSync(process.execPath, [
  path.join('dist', 'arkprism.js'),
  '--help',
], {
  cwd: path.resolve('.'),
  encoding: 'utf8',
  env: {
    ...process.env,
    ARKPRISM_MAX_OLD_SPACE_SIZE_MB: '4608',
  },
});

assert.strictEqual(
  result.status,
  0,
  `heap relaunch failed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
);
assert.match(result.stdout, /\[RUNTIME\] Relaunching ArkPrism/);
assert.match(result.stdout, /Usage:/);

console.log('Automatic V8 heap relaunch verified.');
