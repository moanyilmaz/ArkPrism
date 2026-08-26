'use strict';

const assert = require('assert');
const {
  ArkInvokeStmt,
  CONSTRUCTOR_NAME,
  Local,
  THIS_NAME,
} = require('../dist/arkanalyzer');
const {
  addInitInConstructor,
} = require('../dist/arkanalyzer/core/model/builder/ArkMethodBuilder');

function createConstructor(blocks) {
  const thisLocal = new Local(THIS_NAME);
  return {
    getName: () => CONSTRUCTOR_NAME,
    getBody: () => ({
      getLocals: () => new Map([[THIS_NAME, thisLocal]]),
    }),
    getCfg: () => ({ getBlocks: () => blocks }),
  };
}

function createClass(method) {
  return {
    getMethods: () => [method],
    getInstanceInitMethod: () => ({ getSignature: () => ({}) }),
  };
}

const statements = [];
const block = { getStmts: () => statements };
addInitInConstructor(createClass(createConstructor(new Set([block]))));
assert.strictEqual(statements.length, 1);
assert.ok(statements[0] instanceof ArkInvokeStmt);

assert.doesNotThrow(() => {
  addInitInConstructor(createClass(createConstructor(new Set())));
});

console.log('ArkAnalyzer empty-constructor initialization verified.');
