const fs = require('fs');
const path = require('path');

function parseArgs(argv) {
  const args = { oracle: '', full: '', callbackOff: '', outputDir: '' };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === '--oracle') args.oracle = argv[++index] || '';
    else if (arg === '--full') args.full = argv[++index] || '';
    else if (arg === '--callback-off') args.callbackOff = argv[++index] || '';
    else if (arg === '--output-dir') args.outputDir = argv[++index] || '';
    else throw new Error(`Unknown argument: ${arg}`);
  }
  for (const [key, value] of Object.entries(args)) {
    if (!value) throw new Error(`--${key.replace(/[A-Z]/g, x => `-${x.toLowerCase()}`)} is required`);
  }
  return args;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, ''));
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
  const full = evaluateConfiguration(
    'full',
    reportIndex(args.full),
    oracle.cases,
  );
  const callbackOff = evaluateConfiguration(
    'callback_off',
    reportIndex(args.callbackOff),
    oracle.cases,
  );
  const fullOnlyCorrect = oracle.cases.filter((item, index) =>
    full.records[index].predicted === item.expected
    && callbackOff.records[index].predicted !== item.expected).map(item => item.id);
  const callbackOffOnlyCorrect = oracle.cases.filter((item, index) =>
    callbackOff.records[index].predicted === item.expected
    && full.records[index].predicted !== item.expected).map(item => item.id);
  const result = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    oracle: path.resolve(args.oracle),
    definition: oracle.definition,
    full,
    callbackOff,
    paired: {
      fullOnlyCorrect,
      callbackOffOnlyCorrect,
      exactMcNemarP: exactMcNemar(
        fullOnlyCorrect.length,
        callbackOffOnlyCorrect.length,
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
  const rows = [full, callbackOff].map(configuration => {
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
    `Callback-off-only correct cases: ${result.paired.callbackOffOnlyCorrect.length}.`,
    `Exact McNemar p: ${result.paired.exactMcNemarP}.`,
    '',
  ].join('\n');
  fs.writeFileSync(
    path.join(path.resolve(args.outputDir), 'arkasyncbench_results.md'),
    `${markdown}\n`,
    'utf8',
  );
  console.log(markdown);
}

if (require.main === module) main();

module.exports = { evaluateConfiguration, exactMcNemar, metrics };
