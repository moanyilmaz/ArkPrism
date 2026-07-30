const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const OUTPUT = path.join(ROOT, 'benchmarks', 'ArkPromiseBench');

const CASES = [
  {
    id: 'direct_success',
    category: 'success-handler',
    expected: true,
    oracleReason:
      'The configured Promise resolved payload is bound to the first then-handler parameter and that parameter reaches console.info.',
    body: `identifier.getOAID().then((value) => {
      console.info('privacy', String(value));
    });`,
  },
  {
    id: 'same_promise_alias',
    category: 'alias-identity',
    expected: true,
    oracleReason:
      'The alias denotes the same configured Promise, so its resolved payload is bound to the success-handler parameter and reaches console.info.',
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
    oracleReason:
      'The sensitive resolved payload reaches the first then argument; the presence of a separate rejection handler does not change that dependence.',
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
    oracleReason:
      'The first success handler returns its input unchanged, making the next Promise payload data-dependent on the configured source.',
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
    oracleReason:
      'The first success handler returns a property derived from its input, so the next Promise payload remains data-dependent on the configured source.',
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
    oracleReason:
      'Promise.resolve wraps the sensitive handler input and Promise flattening carries that resolved value to the next success handler.',
    body: `identifier.getOAID()
      .then((value) => Promise.resolve(value))
      .then((value) => {
        console.info('privacy', String(value));
      });`,
  },
  {
    id: 'promise_flattening_alias',
    category: 'promise-flattening',
    expected: true,
    oracleReason:
      'The handler returns Promise.resolve of an exact local alias of its payload, so flattening preserves dependence into the following continuation.',
    body: `identifier.getOAID()
      .then((value) => {
        const alias = value;
        return Promise.resolve(alias);
      })
      .then((value) => {
        console.info('privacy', String(value));
      });`,
  },
  {
    id: 'custom_then_constant',
    category: 'promise-owner',
    expected: false,
    oracleReason:
      'The then receiver is a user-defined TaskQueue whose callback argument is a constant, not the configured Promise resolved payload.',
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
    id: 'custom_then_ignored_return',
    category: 'promise-owner',
    expected: false,
    oracleReason:
      'The user-defined then invokes a source-capturing callback but discards its return and produces an independent constant Promise.',
    helpers: `class IgnoringTaskQueue {
  then(callback: () => Promise<string>): Promise<string> {
    callback();
    return Promise.resolve('constant');
  }
}
`,
    body: `const sensitive = identifier.getOAID();
    const queue = new IgnoringTaskQueue();
    const output = queue.then(() => sensitive);
    output.then((value) => {
      console.info('diagnostic', String(value));
    });`,
  },
  {
    id: 'rejection_argument',
    category: 'handler-position',
    expected: false,
    oracleReason:
      'Only the rejection-handler parameter reaches console.info; it is not the configured Promise resolved payload.',
    body: `identifier.getOAID().then((value) => {
      console.info('diagnostic', 'success');
    }, (error) => {
      console.info('diagnostic', String(error));
    });`,
  },
  {
    id: 'undefined_success_handler',
    category: 'handler-position',
    expected: false,
    oracleReason:
      'The fulfillment handler is absent and only the rejection handler reaches the sink, so no resolved privacy payload is bound to that callback.',
    body: `identifier.getOAID().then(undefined, (error) => {
      console.info('diagnostic', String(error));
    });`,
  },
  {
    id: 'catch_handler',
    category: 'rejection-operator',
    expected: false,
    oracleReason:
      'The catch callback receives a rejection reason, whereas the configured source is the Promise resolved payload.',
    body: `identifier.getOAID().catch((error) => {
      console.info('diagnostic', String(error));
    });`,
  },
  {
    id: 'finally_handler',
    category: 'rejection-operator',
    expected: false,
    oracleReason:
      'The finally callback receives no resolved payload and the sink argument is a constant.',
    body: `identifier.getOAID().finally(() => {
      console.info('diagnostic', 'completed');
    });`,
  },
  {
    id: 'ignored_success_value',
    category: 'value-dependence',
    expected: false,
    oracleReason:
      'The success-handler parameter is never used and the sink argument is a constant independent of the resolved payload.',
    body: `identifier.getOAID().then((value) => {
      console.info('diagnostic', 'completed');
    });`,
  },
  {
    id: 'constant_in_success',
    category: 'value-dependence',
    expected: false,
    oracleReason:
      'The success handler receives the resolved payload but console.info consumes a separately created constant.',
    body: `identifier.getOAID().then((value) => {
      const safe = 'constant';
      console.info('diagnostic', safe);
    });`,
  },
  {
    id: 'independent_promise',
    category: 'alias-identity',
    expected: false,
    oracleReason:
      'The observed handler belongs to an independent constant Promise; the configured Promise is never attached to that continuation.',
    body: `const sensitive = identifier.getOAID();
    const independent = Promise.resolve('constant');
    independent.then((value) => {
      console.info('diagnostic', String(value));
    });
    void sensitive;`,
  },
  {
    id: 'two_promise_cross_binding',
    category: 'alias-identity',
    expected: false,
    oracleReason:
      'The sink observes a distinct constant Promise while the configured Promise is attached to a separate handler that does not use its payload.',
    body: `const sensitive = identifier.getOAID();
    const independent = Promise.resolve('constant');
    sensitive.then((_value) => {
      console.info('diagnostic', 'source completed');
    });
    independent.then((value) => {
      console.info('diagnostic', String(value));
    });`,
  },
  {
    id: 'reassigned_alias',
    category: 'alias-identity',
    expected: false,
    oracleReason:
      'The alias is overwritten with an independent constant Promise before then is invoked, killing identity with the configured Promise.',
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
    oracleReason:
      'The helper consumes its input but returns the same constant for every input, so the sink value is not data-dependent on the resolved payload.',
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
    oracleReason:
      'The first success handler replaces the resolved payload with a constant, so the following Promise payload has no source dependence.',
    body: `identifier.getOAID()
      .then((value) => {
        void value;
        return 'constant';
      })
      .then((value) => {
        console.info('diagnostic', String(value));
      });`,
  },
  {
    id: 'flattening_constant_promise',
    category: 'promise-flattening',
    expected: false,
    oracleReason:
      'The first handler replaces its input with an independently resolved constant Promise, so Promise flattening carries no source dependence.',
    body: `identifier.getOAID()
      .then((value) => {
        void value;
        return Promise.resolve('constant');
      })
      .then((value) => {
        console.info('diagnostic', String(value));
      });`,
  },
  {
    id: 'registered_callback_without_emit',
    category: 'callback-execution',
    expected: false,
    oracleReason:
      'Registering an emitter callback does not execute it, and the program contains no matching emit operation that could reach the captured Promise.',
    imports: `import emitter from '@ohos.events.emitter';\n`,
    body: `const pending = identifier.getOAID();
    emitter.on('arkpromisebench.never-emitted', () => {
      pending.then((value) => {
        console.info('diagnostic', String(value));
      });
    });`,
  },
  {
    id: 'registered_source_without_emit',
    category: 'callback-execution',
    expected: false,
    oracleReason:
      'The emitter callback contains a configured Promise source, but registration alone does not execute that callback and no matching emit operation exists.',
    imports: `import emitter from '@ohos.events.emitter';\n`,
    body: `emitter.on('arkpromisebench.source-never-emitted', () => {
      identifier.getOAID().then((value) => {
        console.info('diagnostic', String(value));
      });
    });`,
  },
  {
    id: 'registered_once_without_emit',
    category: 'callback-execution',
    expected: false,
    oracleReason:
      'A one-shot emitter registration remains dormant without a matching emit operation, so its captured configured Promise cannot reach the sink.',
    imports: `import emitter from '@ohos.events.emitter';\n`,
    body: `const pending = identifier.getOAID();
    emitter.once('arkpromisebench.once-never-emitted', () => {
      pending.then((value) => {
        console.info('diagnostic', String(value));
      });
    });`,
  },
];

const BOUNDARY_OPERATOR_BY_CATEGORY = {
  'success-handler': 'fulfillment-binding',
  'alias-identity': 'receiver-identity',
  'handler-position': 'handler-position',
  'sequential-chain': 'return-dependence',
  'promise-flattening': 'promise-assimilation',
  'promise-owner': 'receiver-owner',
  'rejection-operator': 'rejection-channel',
  'value-dependence': 'sink-dependence',
  'sanitizer-return': 'return-dependence',
  'callback-execution': 'callback-execution',
};

function source(testCase) {
  return `import { AbilityConstant, UIAbility, Want } from '@kit.AbilityKit';
import { identifier } from '@kit.AdsKit';
${testCase.imports || ''}
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
  fs.mkdirSync(OUTPUT, { recursive: true });
  const oraclePath = path.join(OUTPUT, 'oracle.json');
  let previousIds = [];
  if (fs.existsSync(oraclePath)) {
    const previousOracle = JSON.parse(fs.readFileSync(oraclePath, 'utf8'));
    previousIds = previousOracle.cases.map(testCase => testCase.id);
  }
  const generatedIds = new Set([...previousIds, ...CASES.map(testCase => testCase.id)]);
  for (const id of generatedIds) {
    if (!/^[a-z0-9_]+$/.test(id)) {
      throw new Error(`Unsafe benchmark case identifier: ${id}`);
    }
    const generatedDirectory = path.resolve(OUTPUT, id);
    if (path.dirname(generatedDirectory) !== OUTPUT) {
      throw new Error(`Generated case escapes benchmark root: ${generatedDirectory}`);
    }
    fs.rmSync(generatedDirectory, { recursive: true, force: true });
  }
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
    schemaVersion: 3,
    definition:
      'A positive case requires explicit dependence from a configured Promise payload to console.info. Rejection values, constants, independent Promise payloads, and constant-returning transforms are negative.',
    cases: CASES.map(testCase => ({
      id: testCase.id,
      construct: 'Promise',
      category: testCase.category,
      boundaryOperator: BOUNDARY_OPERATOR_BY_CATEGORY[testCase.category],
      expected: testCase.expected,
      oracleReason: testCase.oracleReason,
      sourceFile: 'entryability/EntryAbility.ets',
    })),
  };
  fs.writeFileSync(
    oraclePath,
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
