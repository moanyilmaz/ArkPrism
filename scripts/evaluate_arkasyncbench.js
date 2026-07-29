const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

function usage() {
  return [
    'Usage: node scripts/evaluate_arkasyncbench.js',
    '  --oracle <oracle.json> --full <reports-dir>',
    '  (--continuation-off <reports-dir> | --post-ifds <reports-dir>',
    '   | --callback-off <reports-dir>) --output-dir <dir>',
  ].join('\n');
}

function parseArgs(argv) {
  const args = {
    oracle: '',
    full: '',
    callbackOff: '',
    continuationOff: '',
    postIfds: '',
    outputDir: '',
  };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') {
      console.log(usage());
      process.exit(0);
    } else if (arg === '--oracle') args.oracle = argv[++index] || '';
    else if (arg === '--full') args.full = argv[++index] || '';
    else if (arg === '--callback-off') args.callbackOff = argv[++index] || '';
    else if (arg === '--continuation-off') args.continuationOff = argv[++index] || '';
    else if (arg === '--post-ifds') args.postIfds = argv[++index] || '';
    else if (arg === '--output-dir') args.outputDir = argv[++index] || '';
    else throw new Error(`Unknown argument: ${arg}`);
  }
  for (const key of ['oracle', 'full', 'outputDir']) {
    if (!args[key]) {
      throw new Error(`--${key.replace(/[A-Z]/g, x => `-${x.toLowerCase()}`)} is required`);
    }
  }
  const comparisons = [args.continuationOff, args.postIfds, args.callbackOff].filter(Boolean);
  if (comparisons.length !== 1) {
    throw new Error('Use exactly one of --continuation-off, --post-ifds, or --callback-off');
  }
  return args;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, ''));
}

function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function callbackAnalysisEnabled(manifest) {
  const args = manifest.execution?.arkArgs || [];
  let enabled = true;
  for (let index = 0; index < args.length; index++) {
    if (args[index] !== '--callback-analysis') continue;
    const value = String(args[index + 1] || '').toLowerCase();
    if (!['true', 'false'].includes(value)) throw new Error('Invalid --callback-analysis value');
    enabled = value === 'true';
  }
  return enabled;
}

function continuationFlowDisabled(manifest) {
  return Boolean(
    manifest.execution?.disableContinuationFlow
    ?? manifest.environment?.analysisFeatureFlags?.disableContinuationFlow
    ?? false,
  );
}

function inspectRun(root) {
  const manifestPath = path.join(path.resolve(root), 'run_manifest.json');
  if (!fs.existsSync(manifestPath)) throw new Error(`Missing run manifest: ${path.basename(root)}`);
  const manifest = readJson(manifestPath);
  if (manifest.status !== 'complete') throw new Error(`${path.basename(root)} is not complete`);
  if (Number(manifest.progress?.errors) !== 0) throw new Error(`${path.basename(root)} has errors`);
  if (manifest.execution?.resume === true) throw new Error(`${path.basename(root)} used resume mode`);
  return {
    runId: path.basename(path.resolve(root)),
    manifestSha256: sha256File(manifestPath),
    disableContinuationFlow: continuationFlowDisabled(manifest),
    callbackAnalysis: callbackAnalysisEnabled(manifest),
  };
}

function validateRunConfiguration(mode, full, comparison) {
  const expected = {
    continuation_off: {
      full: [false, false],
      comparison: [true, false],
    },
    post_ifds: {
      full: [false, false],
      comparison: [true, true],
    },
    callback_off: {
      full: [false, true],
      comparison: [false, false],
    },
  }[mode];
  if (!expected) throw new Error(`Unknown comparison mode: ${mode}`);
  for (const [name, run, values] of [
    ['full', full, expected.full],
    [mode, comparison, expected.comparison],
  ]) {
    const [disableContinuationFlow, callbackAnalysis] = values;
    if (run.disableContinuationFlow !== disableContinuationFlow
      || run.callbackAnalysis !== callbackAnalysis) {
      throw new Error(
        `${name} has incompatible flags: continuationOff=${run.disableContinuationFlow}, `
        + `callbackAnalysis=${run.callbackAnalysis}`,
      );
    }
  }
}

function reportFiles(root) {
  const files = [];
  const pending = [path.resolve(root)];
  while (pending.length > 0) {
    const current = pending.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const target = path.join(current, entry.name);
      if (entry.isDirectory() && entry.name !== 'logs') pending.push(target);
      else if (entry.isFile() && entry.name.endsWith('-arkprism-report.json')) files.push(target);
    }
  }
  return files.sort();
}

function reportIndex(root) {
  const result = new Map();
  for (const filePath of reportFiles(root)) {
    const report = readJson(filePath);
    if (result.has(report.projectName)) throw new Error(`Duplicate report: ${report.projectName}`);
    result.set(report.projectName, report);
  }
  return result;
}

function ratio(numerator, denominator) {
  return denominator === 0 ? null : numerator / denominator;
}

function metrics(records) {
  const tp = records.filter(item => item.expected && item.predicted).length;
  const tn = records.filter(item => !item.expected && !item.predicted).length;
  const fp = records.filter(item => !item.expected && item.predicted).length;
  const fn = records.filter(item => item.expected && !item.predicted).length;
  const precision = ratio(tp, tp + fp);
  const recall = ratio(tp, tp + fn);
  return {
    cases: records.length,
    tp,
    tn,
    fp,
    fn,
    precision,
    recall,
    specificity: ratio(tn, tn + fp),
    f1: precision == null || recall == null || precision + recall === 0
      ? null
      : (2 * precision * recall) / (precision + recall),
    accuracy: ratio(tp + tn, records.length),
  };
}

function evaluateConfiguration(name, reports, oracleCases) {
  if (reports.size !== oracleCases.length) {
    throw new Error(`${name}: expected ${oracleCases.length} reports, found ${reports.size}`);
  }
  const records = oracleCases.map(item => {
    const report = reports.get(item.id);
    if (!report) throw new Error(`${name}: missing report ${item.id}`);
    const privacyFlows = (report.taintFlows || []).filter(
      flow => flow.sourceKind === 'privacy_data',
    );
    return {
      ...item,
      predicted: privacyFlows.length > 0,
      privacyFlows: privacyFlows.length,
      frameworkInputFlows: (report.taintFlows || []).filter(
        flow => flow.sourceKind === 'framework_input',
      ).length,
      provenance: Object.fromEntries(
        ['ifds', 'async_supplement', 'both'].map(tag => [
          tag,
          privacyFlows.filter(flow => flow.provenance === tag).length,
        ]),
      ),
      derivations: Object.fromEntries(
        ['promise_then', 'promise_return'].map(tag => [
          tag,
          privacyFlows.filter(
            flow => (flow.analysisDerivations || []).includes(tag),
          ).length,
        ]),
      ),
      carrierStates: Object.fromEntries(
        [...new Set(privacyFlows.map(flow => flow.carrierState || 'untyped'))]
          .sort()
          .map(tag => [
            tag,
            privacyFlows.filter(flow => (flow.carrierState || 'untyped') === tag).length,
          ]),
      ),
    };
  });
  const groups = key => Object.fromEntries(
    [...new Set(records.map(item => item[key]))].sort().map(value => [
      value,
      metrics(records.filter(item => item[key] === value)),
    ]),
  );
  return {
    name,
    overall: metrics(records),
    byConstruct: groups('construct'),
    byApi: groups('api'),
    byCategory: records.some(item => item.category)
      ? groups('category')
      : {},
    records,
  };
}

function exactMcNemar(leftOnly, rightOnly) {
  const discordant = leftOnly + rightOnly;
  if (discordant === 0) return 1;
  const tail = Math.min(leftOnly, rightOnly);
  let probability = 0;
  for (let value = 0; value <= tail; value++) {
    let combinations = 1;
    for (let index = 1; index <= value; index++) {
      combinations *= (discordant - index + 1) / index;
    }
    probability += combinations * Math.pow(0.5, discordant);
  }
  return Math.min(1, 2 * probability);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const oracle = readJson(args.oracle);
  const comparisonRoot = args.continuationOff || args.postIfds || args.callbackOff;
  const ablationName = args.continuationOff
    ? 'continuation_off'
    : args.postIfds
      ? 'post_ifds'
      : 'callback_off';
  const runs = {
    full: inspectRun(args.full),
    comparison: inspectRun(comparisonRoot),
  };
  validateRunConfiguration(ablationName, runs.full, runs.comparison);
  const full = evaluateConfiguration(
    'full',
    reportIndex(args.full),
    oracle.cases,
  );
  const ablation = evaluateConfiguration(
    ablationName,
    reportIndex(comparisonRoot),
    oracle.cases,
  );
  const fullOnlyCorrect = oracle.cases.filter((item, index) =>
    full.records[index].predicted === item.expected
    && ablation.records[index].predicted !== item.expected).map(item => item.id);
  const ablationOnlyCorrect = oracle.cases.filter((item, index) =>
    ablation.records[index].predicted === item.expected
    && full.records[index].predicted !== item.expected).map(item => item.id);
  const result = {
    schemaVersion: 3,
    generatedAt: new Date().toISOString(),
    oracle: {
      file: path.basename(args.oracle),
      sha256: sha256File(path.resolve(args.oracle)),
    },
    runs,
    definition: oracle.definition,
    full,
    ablation,
    paired: {
      fullOnlyCorrect,
      ablationOnlyCorrect,
      exactMcNemarP: exactMcNemar(
        fullOnlyCorrect.length,
        ablationOnlyCorrect.length,
      ),
    },
  };
  fs.mkdirSync(path.resolve(args.outputDir), { recursive: true });
  fs.writeFileSync(
    path.join(path.resolve(args.outputDir), 'arkasyncbench_results.json'),
    `${JSON.stringify(result, null, 2)}\n`,
    'utf8',
  );
  const percent = value => value == null ? 'N/A' : `${(value * 100).toFixed(2)}%`;
  const rows = [full, ablation].map(configuration => {
    const metric = configuration.overall;
    return `| ${configuration.name} | ${metric.tp} | ${metric.tn} | ${metric.fp} | ${metric.fn} | ${percent(metric.precision)} | ${percent(metric.recall)} | ${percent(metric.specificity)} | ${percent(metric.f1)} |`;
  });
  const markdown = [
    '# ArkAsyncBench',
    '',
    `Oracle: ${oracle.cases.length} cases; ${oracle.cases.filter(item => item.expected).length} positive and ${oracle.cases.filter(item => !item.expected).length} negative.`,
    '',
    '| Configuration | TP | TN | FP | FN | Precision | Recall | Specificity | F1 |',
    '|---|---:|---:|---:|---:|---:|---:|---:|---:|',
    ...rows,
    '',
    `Full-only correct cases: ${result.paired.fullOnlyCorrect.length}.`,
    `Ablation-only correct cases: ${result.paired.ablationOnlyCorrect.length}.`,
    `Exact McNemar p: ${result.paired.exactMcNemarP}.`,
  ].join('\n');
  fs.writeFileSync(
    path.join(path.resolve(args.outputDir), 'arkasyncbench_results.md'),
    `${markdown}\n`,
    'utf8',
  );
  console.log(markdown);
}

if (require.main === module) main();

module.exports = {
  callbackAnalysisEnabled,
  continuationFlowDisabled,
  evaluateConfiguration,
  exactMcNemar,
  metrics,
  validateRunConfiguration,
};
