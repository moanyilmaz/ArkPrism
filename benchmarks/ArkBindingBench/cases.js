// Labels follow SDK 20 contracts and explicit data dependence, before any runs.
const cases = [
  {
    id: 'factory_callback', split: 'development', expected: true,
    imports: "import pasteboard from '@ohos.pasteboard';",
    body: `const manager = pasteboard.getSystemPasteboard();
    manager.getData((error, payload) => console.info(String(payload)));`,
    binding: { api: 'getData', module: '@ohos.pasteboard', type: 'callback', carrier: 'payload' },
    reason: 'The factory returns SystemPasteboard and AsyncCallback delivers PasteData in its second parameter.'
  },
  {
    id: 'callback_error_only', split: 'development', expected: false,
    imports: "import pasteboard from '@ohos.pasteboard';",
    body: `const manager = pasteboard.getSystemPasteboard();
    manager.getData((error, payload) => console.info(String(error)));`,
    binding: { api: 'getData', module: '@ohos.pasteboard', type: 'callback', carrier: 'payload' },
    reason: 'Only the error parameter is logged; the configured PasteData payload is unused.'
  },
  {
    id: 'factory_promise_alias', split: 'development', expected: true,
    imports: "import board from '@ohos.pasteboard';",
    body: `const manager = board.getSystemPasteboard();
    const alias = manager;
    const pending = alias.getData();
    pending.then(payload => console.info(String(payload)));`,
    binding: { api: 'getData', module: '@ohos.pasteboard', type: 'return', carrier: 'pending' },
    reason: 'A receiver alias preserves factory ownership and the Promise fulfillment payload reaches the log.'
  },
  {
    id: 'renamed_import_callback', split: 'development', expected: true,
    imports: "import { identifier as ads } from '@kit.AdsKit';",
    body: `ads.getOAID((error, payload) => console.info(payload));`,
    binding: { api: 'getOAID', module: '@ohos.identifier.oaid', type: 'callback', carrier: 'payload' },
    reason: 'Renaming the imported SDK namespace does not change its callback contract.'
  },
  {
    id: 'direct_wifi', split: 'development', expected: true,
    imports: "import wifiManager from '@ohos.wifiManager';",
    body: `const info = wifiManager.getIpInfo();
    console.info(String(info));`,
    binding: { api: 'getIpInfo', module: '@ohos.wifiManager', type: 'return', carrier: 'info' },
    reason: 'getIpInfo returns the modeled privacy value directly.'
  },
  {
    id: 'application_owner', split: 'development', expected: false,
    helpers: `class LocalStore {
  getData(): Promise<string> { return Promise.resolve('public'); }
}`,
    body: `const manager = new LocalStore();
    manager.getData().then(payload => console.info(payload));`,
    binding: null,
    reason: 'The application-defined method returns a public constant, not platform data.'
  },
  {
    id: 'namespace_shadow', split: 'development', expected: false,
    helpers: `class LocalIdentifier {
  getOAID(): Promise<string> { return Promise.resolve('public'); }
}`,
    body: `const identifier = new LocalIdentifier();
    identifier.getOAID().then(payload => console.info(payload));`,
    binding: null,
    reason: 'A local variable named identifier does not establish SDK ownership.'
  },
  {
    id: 'unrelated_object_callback', split: 'development', expected: false,
    body: `const store = {
      getData: (callback: (error: string, data: string) => void): void => {
        callback('none', 'public');
      }
    };
    store.getData((error, payload) => console.info(payload));`,
    binding: null,
    reason: 'The object-literal method invokes its callback with public constants.'
  },
  {
    id: 'promise_constant_return', split: 'development', expected: false,
    imports: "import { identifier } from '@kit.AdsKit';",
    body: `const pending = identifier.getOAID();
    pending.then(payload => 'public').then(value => console.info(value));`,
    binding: { api: 'getOAID', module: '@ohos.identifier.oaid', type: 'return', carrier: 'pending' },
    reason: 'The first handler replaces the payload with an independent constant.'
  },
  {
    id: 'promise_reused_handler', split: 'development', expected: false,
    imports: "import { identifier } from '@kit.AdsKit';",
    helpers: `function identity(value: string): string { return value; }`,
    body: `const pending = identifier.getOAID();
    pending.then(identity);
    Promise.resolve('public').then(identity).then(value => console.info(value));`,
    binding: { api: 'getOAID', module: '@ohos.identifier.oaid', type: 'return', carrier: 'pending' },
    reason: 'The same handler is used by two independent chains; only the public chain is logged.'
  },
  {
    id: 'promise_return_object', split: 'development', expected: true,
    imports: "import { identifier } from '@kit.AdsKit';",
    body: `const pending = identifier.getOAID();
    pending.then(payload => ({ content: payload })).then(box => console.info(box.content));`,
    binding: { api: 'getOAID', module: '@ohos.identifier.oaid', type: 'return', carrier: 'pending' },
    reason: 'The returned object contains the source payload in a field used by the next handler.'
  },
  {
    id: 'promise_return_public_field', split: 'development', expected: false,
    imports: "import { identifier } from '@kit.AdsKit';",
    body: `const pending = identifier.getOAID();
    pending.then(payload => ({ secret: payload, label: 'public' })).then(box => console.info(box.label));`,
    binding: { api: 'getOAID', module: '@ohos.identifier.oaid', type: 'return', carrier: 'pending' },
    reason: 'Only the public field is logged; the field containing the source value is not read.'
  },
  {
    id: 'contact_callback_overload', split: 'validation', expected: true,
    imports: "import contact from '@ohos.contact';",
    body: `contact.selectContacts((error, payload) => console.info(String(payload)));`,
    binding: { api: 'selectContacts', module: '@ohos.contact', type: 'callback', carrier: 'payload' },
    reason: 'The function argument selects the callback overload, not the options-to-Promise overload.'
  },
  {
    id: 'contact_callback_error', split: 'validation', expected: false,
    imports: "import contact from '@ohos.contact';",
    body: `contact.selectContacts((error, payload) => console.info(String(error)));`,
    binding: { api: 'selectContacts', module: '@ohos.contact', type: 'callback', carrier: 'payload' },
    reason: 'The error argument is separate from the Contact array supplied as the second callback argument.'
  },
  {
    id: 'contact_application_object', split: 'validation', expected: false,
    body: `const picker = { selectContacts: (): Promise<string> => Promise.resolve('public') };
    picker.selectContacts().then(value => console.info(value));`,
    binding: null,
    reason: 'The application object returns a constant and has no platform owner.'
  },
  {
    id: 'wifi_await_renamed', split: 'validation', expected: true,
    imports: "import wireless from '@ohos.wifiManager';",
    async: true,
    body: `const pending = wireless.getLinkedInfo();
    const info = await pending;
    console.info(String(info));`,
    binding: { api: 'getLinkedInfo', module: '@ohos.wifiManager', type: 'return', carrier: 'pending' },
    reason: 'await obtains the fulfillment payload even when the namespace import is renamed.'
  },
  {
    id: 'factory_helper', split: 'validation', expected: true,
    imports: "import { pasteboard } from '@kit.BasicServicesKit';",
    helpers: `function boardManager(): pasteboard.SystemPasteboard {
  return pasteboard.getSystemPasteboard();
}`,
    body: `const manager = boardManager();
    manager.getData((error, payload) => console.info(String(payload)));`,
    binding: { api: 'getData', module: '@ohos.pasteboard', type: 'callback', carrier: 'payload' },
    reason: 'The helper return type and platform factory identify SystemPasteboard.'
  },
  {
    id: 'wifi_callback_error', split: 'validation', expected: false,
    imports: "import wifiManager from '@ohos.wifiManager';",
    body: `wifiManager.getLinkedInfo((error, payload) => console.info(String(error)));`,
    binding: { api: 'getLinkedInfo', module: '@ohos.wifiManager', type: 'callback', carrier: 'payload' },
    reason: 'The logged error is not the configured WifiLinkedInfo callback payload.'
  },
  {
    id: 'promise_helper_return', split: 'validation', expected: true,
    imports: "import { identifier } from '@kit.AdsKit';",
    helpers: `function decorate(value: string): string { return 'id=' + value; }`,
    body: `const pending = identifier.getOAID();
    pending.then(decorate).then(result => console.info(result));`,
    binding: { api: 'getOAID', module: '@ohos.identifier.oaid', type: 'return', carrier: 'pending' },
    reason: 'An application helper returns a string derived from the incoming payload.'
  },
  {
    id: 'promise_flatten_public', split: 'validation', expected: false,
    imports: "import { identifier } from '@kit.AdsKit';",
    body: `const pending = identifier.getOAID();
    pending.then(payload => Promise.resolve('public')).then(result => console.info(result));`,
    binding: { api: 'getOAID', module: '@ohos.identifier.oaid', type: 'return', carrier: 'pending' },
    reason: 'Flattening unwraps a public constant, not the incoming sensitive payload.'
  }
];

function source(testCase) {
  return `import { AbilityConstant, UIAbility, Want } from '@kit.AbilityKit';
${testCase.imports || ''}
${testCase.helpers || ''}
export default class EntryAbility extends UIAbility {
  onCreate(want: Want, launchParam: AbilityConstant.LaunchParam): void {
    this.execute();
  }
  private ${testCase.async ? 'async ' : ''}execute(): ${testCase.async ? 'Promise<void>' : 'void'} {
    ${testCase.body}
  }
}
`;
}

module.exports = { cases, source };
