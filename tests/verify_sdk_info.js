'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { readOpenHarmonySdkInfo } = require('../dist/sdkInfo');

assert.throws(() => readOpenHarmonySdkInfo(''), /OpenHarmony SDK is required/);
assert.throws(
  () => readOpenHarmonySdkInfo(path.join(os.tmpdir(), 'arkprism-sdk-does-not-exist')),
  /does not exist/,
);

const emptySdk = fs.mkdtempSync(path.join(os.tmpdir(), 'arkprism-empty-sdk-'));
try {
  assert.throws(() => readOpenHarmonySdkInfo(emptySdk), /missing oh-uni-package\.json/);
} finally {
  fs.rmSync(emptySdk, { recursive: true, force: true });
}

const sdkPath = process.env.OPENHARMONY_SDK_PATH;
assert.ok(sdkPath, 'OPENHARMONY_SDK_PATH is required for delivery checks');
const expected = JSON.parse(fs.readFileSync(path.join(sdkPath, 'oh-uni-package.json')));
const actual = readOpenHarmonySdkInfo(sdkPath);
assert.strictEqual(actual.apiVersion, String(expected.apiVersion));
assert.strictEqual(actual.version, String(expected.version));

console.log(`Strict OpenHarmony SDK metadata verified: API ${actual.apiVersion}, ${actual.version}.`);
