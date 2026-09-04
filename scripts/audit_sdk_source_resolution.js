const fs = require('fs');
const path = require('path');

const {
  Scene,
  SceneConfig,
} = require('../dist/arkanalyzer');
const {
  Json2ArkMethodSignature,
  sourceParameterTypeCompatible,
} = require('../dist/hapflow/Util');

const ROOT = path.resolve(__dirname, '..');

function parseArgs(argv) {
  const options = {
    sdkPath: process.env.OPENHARMONY_SDK_PATH || '',
    sourcePath: path.join(ROOT, 'config', 'hapflow_sources.json'),
    output: path.join(
      ROOT,
      'docs',
      'rule_set_audit',
      'source_rule_sdk_resolution_audit.json',
    ),
    allowUnresolved: false,
  };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--sdkPath') options.sdkPath = path.resolve(argv[++i]);
    else if (argv[i] === '--sources') options.sourcePath = path.resolve(argv[++i]);
    else if (argv[i] === '--output') options.output = path.resolve(argv[++i]);
    else if (argv[i] === '--allow-unresolved') options.allowUnresolved = true;
  }
  return options;
}

function buildSdkScene(sdkPath) {
  const fixture = path.join(ROOT, 'tests', 'fixtures', 'manager_receiver');
  const config = new SceneConfig();
  config.buildFromProjectDir(fixture);
  const scene = new Scene();
  scene.buildBasicInfo(config);
  scene.genArkFiles();
  scene.inferTypes();
  scene.buildSdk('@ohosSdk', sdkPath);
  return scene;
}

function ruleId(rule, index) {
  return {
    index,
    module: rule.module || '',
    namespace: rule.namespace || '',
    className: rule.class || '',
    apiName: rule.api_name || '',
    sourceType: rule.source_type || '',
  };
}

function audit(options) {
  if (!options.sdkPath || !fs.existsSync(options.sdkPath)) {
    throw new Error(`SDK path does not exist: ${options.sdkPath}`);
  }
  const sdkManifestPath = path.join(options.sdkPath, 'oh-uni-package.json');
  if (!fs.existsSync(sdkManifestPath)) {
    throw new Error(`Invalid OpenHarmony ets SDK: missing ${sdkManifestPath}`);
  }
  const sdkManifest = JSON.parse(fs.readFileSync(sdkManifestPath, 'utf8'));
  const rules = JSON.parse(
    fs.readFileSync(options.sourcePath, 'utf8').replace(/^\uFEFF/, ''),
  );
  const scene = buildSdkScene(options.sdkPath);
  const resolutions = [];
  const signatureOwners = new Map();
  const carrierMismatches = [];

  for (const [index, rule] of rules.entries()) {
    const signatures = Json2ArkMethodSignature(
      rule.module,
      rule.namespace || '',
      rule.class || '',
      rule.api_name,
      scene,
      rule.parameters,
    );
    const id = ruleId(rule, index);
    resolutions.push({
      ...id,
      signatureCount: signatures.length,
      signatures: signatures.map(signature => signature.toString()),
    });

    for (const signature of signatures) {
      const signatureText = signature.toString();
      if (!signatureOwners.has(signatureText)) signatureOwners.set(signatureText, []);
      signatureOwners.get(signatureText).push(id);

      const subSignature = signature.getMethodSubSignature();
      if (rule.source_type === 'return') {
        const actual = subSignature.getReturnType().toString();
        if (!sourceParameterTypeCompatible(rule.returnType, actual)) {
          carrierMismatches.push({
            ...id,
            signature: signatureText,
            configuredCarrier: rule.returnType,
            sdkCarrier: actual,
          });
        }
      } else if (rule.source_type === 'callback') {
        const callbackIndex = Number(rule.tainted_param_index) - 1;
        const actual = subSignature.getParameters()[callbackIndex]?.getType().toString();
        const configured = rule.parameters?.[callbackIndex]?.type;
        if (!actual || !sourceParameterTypeCompatible(configured, actual)) {
          carrierMismatches.push({
            ...id,
            signature: signatureText,
            configuredCarrier: configured || '',
            sdkCarrier: actual || '',
          });
        }
      } else if (rule.source_type === 'ArgIn') {
        const sourceIndex = Number(rule.tainted_param_index) - 1;
        const actual = subSignature.getParameters()[sourceIndex]?.getType().toString();
        const configured = rule.parameters?.[sourceIndex]?.type;
        if (!actual || !sourceParameterTypeCompatible(configured, actual)) {
          carrierMismatches.push({
            ...id,
            signature: signatureText,
            configuredCarrier: configured || '',
            sdkCarrier: actual || '',
          });
        }
      }
    }
  }

  const unresolved = resolutions.filter(item => item.signatureCount === 0);
  const ambiguous = resolutions.filter(item => item.signatureCount > 1);
  const collisions = [...signatureOwners.entries()]
    .filter(([, owners]) => owners.length > 1)
    .map(([signature, owners]) => ({ signature, owners }));
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    sdk: {
      path: options.sdkPath,
      apiVersion: String(sdkManifest.apiVersion || ''),
      version: String(sdkManifest.version || ''),
      releaseType: String(sdkManifest.releaseType || ''),
      loadedDeclarationFiles: scene.getSdkArkFiles().length,
    },
    sources: {
      path: options.sourcePath,
      rules: rules.length,
      resolvedRules: rules.length - unresolved.length,
      resolvedSignatures: signatureOwners.size,
      unresolvedRules: unresolved.length,
      ambiguousRules: ambiguous.length,
      signatureCollisions: collisions.length,
      carrierMismatches: carrierMismatches.length,
    },
    unresolved,
    ambiguous,
    collisions,
    carrierMismatches,
    resolutions,
  };
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const result = audit(options);
  fs.mkdirSync(path.dirname(options.output), { recursive: true });
  fs.writeFileSync(options.output, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify(result.sources, null, 2));

  const failed =
    (!options.allowUnresolved && result.sources.unresolvedRules > 0) ||
    result.sources.ambiguousRules > 0 ||
    result.sources.signatureCollisions > 0 ||
    result.sources.carrierMismatches > 0;
  if (failed) process.exitCode = 1;
}

if (require.main === module) main();

module.exports = {
  audit,
  parseArgs,
};
