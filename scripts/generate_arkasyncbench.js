const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const OUTPUT = path.join(ROOT, 'benchmarks', 'ArkAsyncBench');

const APIS = [
  {
    id: 'oaid',
    importLine: "import { identifier } from '@kit.AdsKit';",
    promiseCall: 'identifier.getOAID()',
    callbackCall: callback => `identifier.getOAID(${callback})`,
    propertyUse: value => `${value}.length`,
  },
  {
    id: 'sim_account',
    importLine: "import sim from '@ohos.telephony.sim';",
    promiseCall: 'sim.getSimAccountInfo(0)',
    callbackCall: callback => `sim.getSimAccountInfo(0, ${callback})`,
    propertyUse: value => `${value}.simId`,
  },
  {
    id: 'reverse_geocode',
    importLine: "import { geoLocationManager } from '@kit.LocationKit';",
    promiseCall:
      'geoLocationManager.getAddressesFromLocation({ latitude: 31.2, longitude: 121.5, maxItems: 1 })',
    callbackCall: callback =>
      'geoLocationManager.getAddressesFromLocation('
      + `{ latitude: 31.2, longitude: 121.5, maxItems: 1 }, ${callback})`,
    propertyUse: value => `${value}.length`,
  },
];

const PATTERNS = [
  {
    id: 'callback_inline_data',
    construct: 'T1-callback',
    expected: true,
    rationale: 'Inline callback sends the configured data parameter to the sink.',
    body: api => `${api.callbackCall(`(error, value) => {
      console.info('privacy', String(value));
    }`)};`,
  },
  {
    id: 'callback_alias_data',
    construct: 'T1-callback',
    expected: true,
    rationale: 'Inline callback aliases the configured data parameter before the sink.',
    body: api => `${api.callbackCall(`(error, value) => {
      const alias = value;
      console.info('privacy', String(alias));
    }`)};`,
  },
  {
    id: 'callback_named_data',
    construct: 'T1-callback',
    expected: true,
    rationale: 'Definition-backed callback sends the configured data parameter to the sink.',
    body: api => `const handler = (error, value) => {
      console.info('privacy', String(value));
    };
    ${api.callbackCall('handler')};`,
  },
  {
    id: 'callback_error_only',
    construct: 'T1-callback',
    expected: false,
    rationale: 'Only the callback error parameter reaches the sink.',
    body: api => `${api.callbackCall(`(error, value) => {
      console.info('diagnostic', String(error));
    }`)};`,
  },
  {
    id: 'callback_constant_only',
    construct: 'T1-callback',
    expected: false,
    rationale: 'The callback executes, but the sensitive parameter is ignored.',
    body: api => `${api.callbackCall(`(error, value) => {
      console.info('diagnostic', 'completed');
    }`)};`,
  },
  {
    id: 'callback_named_error',
    construct: 'T1-callback',
    expected: false,
    rationale: 'A definition-backed callback sends only the error parameter.',
    body: api => `const handler = (error, value) => {
      console.info('diagnostic', String(error));
    };
    ${api.callbackCall('handler')};`,
  },
  {
    id: 'then_direct_data',
    construct: 'T4-then',
    expected: true,
    rationale: 'A direct then handler sends the resolved value to the sink.',
    body: api => `${api.promiseCall}.then((value) => {
      console.info('privacy', String(value));
    });`,
  },
  {
    id: 'then_property_data',
    construct: 'T4-then',
    expected: true,
    rationale: 'A direct then handler sends a property derived from the resolved value.',
    body: api => `${api.promiseCall}.then((value) => {
      console.info('privacy', String(${api.propertyUse('value')}));
    });`,
  },
  {
    id: 'then_variable_alias',
    construct: 'T4-then',
    expected: true,
    rationale: 'A Promise local is consumed by a then handler through an alias.',
    body: api => `const pending = ${api.promiseCall};
    pending.then((value) => {
      const alias = value;
      console.info('privacy', String(alias));
    });`,
  },
  {
    id: 'then_ignore_data',
    construct: 'T4-then',
    expected: false,
    rationale: 'The resolved value is ignored and only a constant reaches the sink.',
    body: api => `${api.promiseCall}.then((value) => {
      console.info('diagnostic', 'completed');
    });`,
  },
  {
    id: 'then_catch_only',
    construct: 'T4-then',
    expected: false,
    rationale: 'Only the rejection error reaches the sink.',
    body: api => `${api.promiseCall}.catch((error) => {
      console.info('diagnostic', String(error));
    });`,
  },
  {
    id: 'then_variable_constant',
    construct: 'T4-then',
    expected: false,
    rationale: 'The Promise is stored, but its resolved value does not reach the sink.',
    body: api => `const pending = ${api.promiseCall};
    pending.then((value) => {
      const safe = 'constant';
      console.info('diagnostic', safe);
    });`,
  },
  {
    id: 'await_direct_data',
    construct: 'T5-await',
    expected: true,
    rationale: 'An awaited sensitive result reaches the sink directly.',
    body: api => `const value = await ${api.promiseCall};
    console.info('privacy', String(value));`,
  },
  {
    id: 'await_alias_data',
    construct: 'T5-await',
    expected: true,
    rationale: 'An awaited sensitive result reaches the sink through an alias.',
    body: api => `const value = await ${api.promiseCall};
    const alias = value;
    console.info('privacy', String(alias));`,
  },
  {
    id: 'await_similar_local',
    construct: 'T5-await',
    expected: false,
    rationale: 'A similarly named but independent local reaches the sink.',
    body: api => `const value8 = await ${api.promiseCall};
    const value85 = 'constant';
    console.info('diagnostic', value85);`,
  },
  {
    id: 'await_ignored',
    construct: 'T5-await',
    expected: false,
    rationale: 'The awaited value is discarded and only a constant reaches the sink.',
    body: api => `await ${api.promiseCall};
    console.info('diagnostic', 'completed');`,
  },
];

function source(api, body) {
  return `import { AbilityConstant, UIAbility, Want } from '@kit.AbilityKit';
${api.importLine}

export default class EntryAbility extends UIAbility {
  onCreate(want: Want, launchParam: AbilityConstant.LaunchParam): void {
    this.execute();
  }

  private async execute(): Promise<void> {
    ${body}
  }
}
`;
}

function main() {
  fs.rmSync(OUTPUT, { recursive: true, force: true });
  fs.mkdirSync(OUTPUT, { recursive: true });
  const cases = [];
  for (const api of APIS) {
    for (const pattern of PATTERNS) {
      const id = `${pattern.construct.replace(/[^A-Za-z0-9]+/g, '_')}__${api.id}__${pattern.id}`;
      const directory = path.join(OUTPUT, id, 'entryability');
      fs.mkdirSync(directory, { recursive: true });
      fs.writeFileSync(
        path.join(directory, 'EntryAbility.ets'),
        source(api, pattern.body(api)),
        'utf8',
      );
      cases.push({
        id,
        api: api.id,
        construct: pattern.construct,
        expected: pattern.expected,
        rationale: pattern.rationale,
        sourceFile: 'entryability/EntryAbility.ets',
      });
    }
  }
  const oracle = {
    schemaVersion: 1,
    definition:
      'A positive case has an explicit value dependence from the configured privacy-data carrier to console.info. Framework-input paths do not satisfy the oracle.',
    cases,
  };
  fs.writeFileSync(
    path.join(OUTPUT, 'oracle.json'),
    `${JSON.stringify(oracle, null, 2)}\n`,
    'utf8',
  );
  console.log(
    `Generated ${cases.length} cases: `
      + `${cases.filter(item => item.expected).length} positive, `
      + `${cases.filter(item => !item.expected).length} negative.`,
  );
}

if (require.main === module) main();

module.exports = { APIS, PATTERNS, source };
