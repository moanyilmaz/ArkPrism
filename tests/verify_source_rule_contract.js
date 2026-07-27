const assert = require('assert');

const {
  hasConcreteSourceCarrierType,
  validateSourceRuleObject,
} = require('../dist/hapflow/Source');
const {
  sourceParameterTypeCompatible,
} = require('../dist/hapflow/Util');

const privacyReturn = {
  api_name: 'getOAID',
  module: '@ohos.identifier.oaid',
  namespace: 'identifier',
  parameters: [],
  returnType: 'Promise<string>',
  source_type: 'return',
  tainted_param_index: -1,
  reason: 'Returns an advertising identifier.',
  sensitivity: 'high',
  source_kind: 'privacy_data',
};
assert.strictEqual(
  validateSourceRuleObject(privacyReturn, 'fixture.json', 0),
  'privacy_data',
);

const frameworkInput = {
  api_name: 'onCreate',
  module: '@ohos.app.ability.UIAbility',
  namespace: '',
  parameters: [{ name: 'want', type: 'Want' }],
  returnType: 'void',
  source_type: 'ArgIn',
  tainted_param_index: 1,
  reason: 'The framework-provided Want may carry data.',
  sensitivity: 'medium',
  source_kind: 'framework_input',
};
assert.strictEqual(
  validateSourceRuleObject(frameworkInput, 'fixture.json', 1),
  'framework_input',
);

assert.throws(
  () => validateSourceRuleObject({
    ...privacyReturn,
    api_name: 'publishReminder',
    returnType: '',
    reason: '',
  }, 'fixture.json', 2),
  /return sources require a concrete non-void returnType/,
);

for (const returnType of [
  'any',
  'unknown',
  'object',
  'Promise<any>',
  'Promise<unknown>',
  'Promise<void>',
  'string | unknown',
]) {
  assert.strictEqual(hasConcreteSourceCarrierType(returnType), false);
  assert.throws(
    () => validateSourceRuleObject({
      ...privacyReturn,
      returnType,
    }, 'fixture.json', 3),
    /return sources require a concrete non-void returnType/,
  );
}
assert.strictEqual(hasConcreteSourceCarrierType('Promise<string>'), true);
assert.strictEqual(hasConcreteSourceCarrierType('Array<Calendar>'), true);
assert.strictEqual(
  sourceParameterTypeCompatible(
    'import("${OPENHARMONY_SDK_PATH}/api/@ohos.base").Callback<Location>',
    'Callback<Location>',
  ),
  true,
);
assert.strictEqual(
  sourceParameterTypeCompatible('"locationChange"', "'locationChange'"),
  true,
);
assert.strictEqual(
  sourceParameterTypeCompatible('"locationChange"', "'nmeaMessage'"),
  false,
);
assert.strictEqual(
  sourceParameterTypeCompatible('(keyof Event)[]', 'keyof Event[]'),
  true,
);
assert.strictEqual(
  sourceParameterTypeCompatible(
    'import("${OPENHARMONY_SDK_PATH}/api/application/Context").default',
    'Context',
  ),
  true,
);

assert.throws(
  () => validateSourceRuleObject({
    ...privacyReturn,
    source_kind: 'framework_input',
  }, 'fixture.json', 4),
  /return sources must use source_kind=privacy_data/,
);

console.log('Source-rule carrier contract verified.');
