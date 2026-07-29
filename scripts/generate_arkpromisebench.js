const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const OUTPUT = path.join(ROOT, 'benchmarks', 'ArkPromiseBench');

const CASES = [
  {
    id: 'direct_success',
    category: 'success-handler',
    expected: true,
    body: `identifier.getOAID().then((value) => {
      console.info('privacy', String(value));
    });`,
  },
  {
    id: 'same_promise_alias',
    category: 'alias-identity',
    expected: true,
    body: `const pending = identifier.getOAID();
    const alias = pending;
    alias.then((value) => {
      console.info('privacy', String(value));
    });`,
  },
  {
    id: 'success_with_rejection_handler',
    category: 'handler-position',
    expected: true,
    body: `identifier.getOAID().then((value) => {
      console.info('privacy', String(value));
    }, (error) => {
      console.info('diagnostic', String(error));
    });`,
  },
  {
    id: 'sequential_value',
    category: 'sequential-chain',
    expected: true,
    body: `identifier.getOAID()
      .then((value) => value)
      .then((value) => {
        console.info('privacy', String(value));
      });`,
  },
  {
    id: 'sequential_property',
    category: 'sequential-chain',
    expected: true,
    body: `identifier.getOAID()
      .then((value) => value.length)
      .then((length) => {
        console.info('privacy', String(length));
      });`,
  },
  {
    id: 'promise_flattening',
    category: 'promise-flattening',
    expected: true,
    body: `identifier.getOAID()
      .then((value) => Promise.resolve(value))
      .then((value) => {
        console.info('privacy', String(value));
      });`,
  },
  {
    id: 'custom_then_constant',
    category: 'promise-owner',
    expected: false,
    helpers: `class TaskQueue {
  private ignored: Promise<string>;

  constructor(ignored: Promise<string>) {
    this.ignored = ignored;
  }

  then(callback: (value: string) => void): void {
    callback('constant');
  }
}
`,
    body: `const queue = new TaskQueue(identifier.getOAID());
    queue.then((value) => {
      console.info('diagnostic', String(value));
    });`,
  },
  {
    id: 'rejection_argument',
    category: 'handler-position',
    expected: false,
    body: `identifier.getOAID().then((value) => {
      console.info('diagnostic', 'success');
    }, (error) => {
      console.info('diagnostic', String(error));
    });`,
  },
  {
    id: 'catch_handler',
    category: 'rejection-operator',
    expected: false,
    body: `identifier.getOAID().catch((error) => {
      console.info('diagnostic', String(error));
    });`,
  },
  {
    id: 'finally_handler',
    category: 'rejection-operator',
    expected: false,
    body: `identifier.getOAID().finally(() => {
      console.info('diagnostic', 'completed');
    });`,
  },
  {
    id: 'ignored_success_value',
    category: 'value-dependence',
    expected: false,
    body: `identifier.getOAID().then((value) => {
      console.info('diagnostic', 'completed');
    });`,
  },
  {
    id: 'constant_in_success',
    category: 'value-dependence',
    expected: false,
    body: `identifier.getOAID().then((value) => {
      const safe = 'constant';
      console.info('diagnostic', safe);
    });`,
  },
  {
    id: 'independent_promise',
    category: 'alias-identity',
    expected: false,
    body: `const sensitive = identifier.getOAID();
    const independent = Promise.resolve('constant');
    independent.then((value) => {
      console.info('diagnostic', String(value));
    });
    void sensitive;`,
  },
  {
    id: 'reassigned_alias',
    category: 'alias-identity',
    expected: false,
    body: `const sensitive = identifier.getOAID();
    let alias = sensitive;
    alias = Promise.resolve('constant');
    alias.then((value) => {
      console.info('diagnostic', String(value));
    });`,
  },
  {
    id: 'constant_sanitizer',
    category: 'sanitizer-return',
    expected: false,
    helpers: `function redact(value: string): string {
  void value;
  return 'redacted';
}
`,
    body: `identifier.getOAID().then((value) => {
      console.info('diagnostic', redact(value));
    });`,
  },
  {
    id: 'sequential_constant',
    category: 'sequential-chain',
    expected: false,
    body: `identifier.getOAID()
      .then((value) => {
        void value;
        return 'constant';
      })
      .then((value) => {
        console.info('diagnostic', String(value));
      });`,
  },
];

function source(testCase) {
  return `import { AbilityConstant, UIAbility, Want } from '@kit.AbilityKit';
import { identifier } from '@kit.AdsKit';

${testCase.helpers || ''}export default class EntryAbility extends UIAbility {
  onCreate(want: Want, launchParam: AbilityConstant.LaunchParam): void {
    this.execute();
  }

  private execute(): void {
    ${testCase.body}
  }
}
`;
}

function main() {
  fs.rmSync(OUTPUT, { recursive: true, force: true });
  fs.mkdirSync(OUTPUT, { recursive: true });
  for (const testCase of CASES) {
    const directory = path.join(OUTPUT, testCase.id, 'entryability');
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(
      path.join(directory, 'EntryAbility.ets'),
      source(testCase),
      'utf8',
    );
  }
  const oracle = {
    schemaVersion: 1,
    definition:
      'A positive case requires explicit dependence from a configured Promise payload to console.info. Rejection values, constants, independent Promise payloads, and constant-returning transforms are negative.',
    cases: CASES.map(testCase => ({
      id: testCase.id,
      construct: 'Promise',
      category: testCase.category,
      expected: testCase.expected,
      sourceFile: 'entryability/EntryAbility.ets',
    })),
  };
  fs.writeFileSync(
    path.join(OUTPUT, 'oracle.json'),
    `${JSON.stringify(oracle, null, 2)}\n`,
    'utf8',
  );
  console.log(
    `Generated ${CASES.length} cases: `
      + `${CASES.filter(item => item.expected).length} positive, `
      + `${CASES.filter(item => !item.expected).length} negative.`,
  );
}

if (require.main === module) main();

module.exports = { CASES, source };
