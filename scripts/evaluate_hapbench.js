const fs = require('fs');
const path = require('path');

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i];
    if (!key.startsWith('--')) throw new Error(`Unexpected argument: ${key}`);
    args[key.slice(2)] = argv[++i];
  }
  if (!args.oracle || !args.output) {
    throw new Error('Usage: node scripts/evaluate_hapbench.js --oracle <json> --output <dir> [--arkprism <dir>] [--hapflow <txt>] [--arkprism-ablation <name=dir>]');
  }
  return args;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, ''));
}

function divide(numerator, denominator) {
  return denominator === 0 ? null : numerator / denominator;
}

function wilsonInterval(successes, trials, z = 1.959963984540054) {
  if (trials === 0) return null;
  const estimate = successes / trials;
  const z2 = z * z;
  const denominator = 1 + z2 / trials;
  const center = (estimate + z2 / (2 * trials)) / denominator;
  const margin = z * Math.sqrt(
    estimate * (1 - estimate) / trials + z2 / (4 * trials * trials),
  ) / denominator;
  return [Math.max(0, center - margin), Math.min(1, center + margin)];
}

function metricSummary(rows) {
  const available = rows.filter(row => row.predicted !== null);
  const tp = available.filter(row => row.expected && row.predicted).length;
  const tn = available.filter(row => !row.expected && !row.predicted).length;
  const fp = available.filter(row => !row.expected && row.predicted).length;
  const fn = available.filter(row => row.expected && !row.predicted).length;
  const precision = divide(tp, tp + fp);
  const recall = divide(tp, tp + fn);
  const specificity = divide(tn, tn + fp);
  const f1 = precision === null || recall === null || precision + recall === 0
    ? null
    : 2 * precision * recall / (precision + recall);
  const mccDenominator = Math.sqrt((tp + fp) * (tp + fn) * (tn + fp) * (tn + fn));
  return {
    evaluated: available.length,
    missing: rows.length - available.length,
    tp,
    tn,
    fp,
    fn,
    precision,
    recall,
    specificity,
    balancedAccuracy: specificity === null || recall === null ? null : (specificity + recall) / 2,
    f1,
    accuracy: divide(tp + tn, available.length),
    mcc: mccDenominator === 0 ? null : (tp * tn - fp * fn) / mccDenominator,
    confidence95: {
      precision: wilsonInterval(tp, tp + fp),
      recall: wilsonInterval(tp, tp + fn),
      specificity: wilsonInterval(tn, tn + fp),
      accuracy: wilsonInterval(tp + tn, available.length),
    },
  };
}

function byCategory(rows) {
  const groups = new Map();
  for (const row of rows) {
    if (!groups.has(row.category)) groups.set(row.category, []);
    groups.get(row.category).push(row);
  }
  return Object.fromEntries([...groups].map(([category, categoryRows]) => [
    category,
    metricSummary(categoryRows),
  ]));
}

function findReport(outputDir, id) {
  const exact = path.join(outputDir, id, `${id}-arkprism-report.json`);
  if (fs.existsSync(exact)) return exact;
  const sampleDir = path.join(outputDir, id);
  if (!fs.existsSync(sampleDir)) return '';
  const reports = fs.readdirSync(sampleDir).filter(name => name.endsWith('-arkprism-report.json'));
  return reports.length === 1 ? path.join(sampleDir, reports[0]) : '';
}

function loadArkPrism(outputDir, cases) {
  const predictions = new Map();
  for (const testCase of cases) {
    const reportPath = findReport(outputDir, testCase.id);
    if (!reportPath) {
      predictions.set(testCase.id, { predicted: null, count: null, evidence: 'report missing' });
      continue;
    }
    const report = readJson(reportPath);
    const flows = Array.isArray(report.taintFlows) ? report.taintFlows : [];
    predictions.set(testCase.id, {
      predicted: flows.length > 0,
      count: flows.length,
      evidence: path.relative(outputDir, reportPath),
    });
  }
  return predictions;
}

function loadHapFlow(filePath, cases) {
  const byBaseName = new Map(cases.map(testCase => [testCase.id.split('__').at(-1), testCase.id]));
  const predictions = new Map();
  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/).filter(Boolean);
  for (const line of lines) {
    const match = line.match(/[\\/]([^\\/]+)\s*,\s*(\d+)\s*$/);
    if (!match) continue;
    const baseName = match[1].trim();
    const id = byBaseName.get(baseName);
    if (!id) throw new Error(`Cannot map HapFlow output line to oracle: ${line}`);
    const count = Number(match[2]);
    predictions.set(id, { predicted: count > 0, count, evidence: line.trim() });
  }
  for (const testCase of cases) {
    if (!predictions.has(testCase.id)) {
      predictions.set(testCase.id, { predicted: null, count: null, evidence: 'output line missing' });
    }
  }
  return predictions;
}

function runtimeSummary(outputDir) {
  const summaryPath = path.join(outputDir, 'batch_summary.json');
  if (!fs.existsSync(summaryPath)) return null;
  const rows = readJson(summaryPath);
  const durations = rows
    .filter(row => !row.error && Number.isFinite(row.durationMs) && row.durationMs > 0)
    .map(row => row.durationMs)
    .sort((a, b) => a - b);
  if (durations.length === 0) return null;
  const quantile = probability => durations[Math.min(
    durations.length - 1,
    Math.floor(probability * durations.length),
  )];
  return {
    cases: durations.length,
    totalMs: durations.reduce((sum, value) => sum + value, 0),
    medianMs: quantile(0.5),
    p95Ms: quantile(0.95),
    maxMs: durations.at(-1),
  };
}

function evaluateTool(name, cases, predictions, runtime = null) {
  const rows = cases.map(testCase => ({
    ...testCase,
    ...predictions.get(testCase.id),
  }));
  const categories = byCategory(rows);
  const categoryF1 = Object.values(categories)
    .map(category => category.f1)
    .filter(value => value !== null);
  return {
    name,
    overall: metricSummary(rows),
    categories,
    categoryAggregate: {
      macroF1: categoryF1.length === 0
        ? null
        : categoryF1.reduce((sum, value) => sum + value, 0) / categoryF1.length,
      worstCategoryF1: categoryF1.length === 0 ? null : Math.min(...categoryF1),
    },
    errors: rows.filter(row => row.predicted !== null && row.expected !== row.predicted),
    missing: rows.filter(row => row.predicted === null).map(row => row.id),
    runtime,
    cases: rows,
  };
}

function choose(n, k) {
  let result = 1;
  for (let index = 1; index <= k; index++) {
    result *= (n - k + index) / index;
  }
  return result;
}

function mcnemarExact(left, right) {
  const leftRows = new Map(left.cases.map(row => [row.id, row]));
  let leftOnlyCorrect = 0;
  let rightOnlyCorrect = 0;
  let paired = 0;
  for (const rightRow of right.cases) {
    const leftRow = leftRows.get(rightRow.id);
    if (!leftRow || leftRow.predicted === null || rightRow.predicted === null) continue;
    paired++;
    const leftCorrect = leftRow.predicted === leftRow.expected;
    const rightCorrect = rightRow.predicted === rightRow.expected;
    if (leftCorrect && !rightCorrect) leftOnlyCorrect++;
    if (!leftCorrect && rightCorrect) rightOnlyCorrect++;
  }
  const discordant = leftOnlyCorrect + rightOnlyCorrect;
  const tail = Math.min(leftOnlyCorrect, rightOnlyCorrect);
  let probability = 0;
  for (let index = 0; index <= tail; index++) {
    probability += choose(discordant, index) * (0.5 ** discordant);
  }
  return {
    left: left.name,
    right: right.name,
    paired,
    leftOnlyCorrect,
    rightOnlyCorrect,
    discordant,
    exactTwoSidedP: Math.min(1, 2 * probability),
  };
}

function formatPercent(value) {
  return value === null ? 'N/A' : `${(value * 100).toFixed(2)}%`;
}

function formatSeconds(value) {
  return value === null ? 'N/A' : `${(value / 1000).toFixed(1)} s`;
}

function formatInterval(interval) {
  return interval === null
    ? 'N/A'
    : `[${(interval[0] * 100).toFixed(1)}, ${(interval[1] * 100).toFixed(1)}]`;
}

function markdown(results, oracle, comparisons = []) {
  const lines = [
    '# HapBench Reproduction',
    '',
    `Oracle: ${oracle.cases.length} cases (${oracle.cases.filter(item => item.expected).length} positive, ${oracle.cases.filter(item => !item.expected).length} negative).`,
    '',
    '## Overall',
    '',
    '| Tool/configuration | Complete | TP | TN | FP | FN | Precision | Recall | F1 | Balanced acc. | MCC |',
    '|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|',
  ];
  for (const result of results) {
    const m = result.overall;
    lines.push(`| ${result.name} | ${m.evaluated}/${oracle.cases.length} | ${m.tp} | ${m.tn} | ${m.fp} | ${m.fn} | ${formatPercent(m.precision)} | ${formatPercent(m.recall)} | ${formatPercent(m.f1)} | ${formatPercent(m.balancedAccuracy)} | ${m.mcc === null ? 'N/A' : m.mcc.toFixed(3)} |`);
  }
  lines.push('', 'Wilson 95% confidence intervals are reported for binomial metrics.', '');
  lines.push('| Tool/configuration | Precision CI | Recall CI | Specificity CI | Accuracy CI | Macro-category F1 | Worst-category F1 |');
  lines.push('|---|---:|---:|---:|---:|---:|---:|');
  for (const result of results) {
    const ci = result.overall.confidence95;
    lines.push(`| ${result.name} | ${formatInterval(ci.precision)} | ${formatInterval(ci.recall)} | ${formatInterval(ci.specificity)} | ${formatInterval(ci.accuracy)} | ${formatPercent(result.categoryAggregate.macroF1)} | ${formatPercent(result.categoryAggregate.worstCategoryF1)} |`);
  }
  const runtimeRows = results.filter(result => result.runtime);
  if (runtimeRows.length > 0) {
    lines.push('', '## Runtime', '');
    lines.push('| Tool/configuration | Timed cases | Total | Median/case | P95/case | Max/case |');
    lines.push('|---|---:|---:|---:|---:|---:|');
    for (const result of runtimeRows) {
      const runtime = result.runtime;
      lines.push(`| ${result.name} | ${runtime.cases} | ${formatSeconds(runtime.totalMs)} | ${formatSeconds(runtime.medianMs)} | ${formatSeconds(runtime.p95Ms)} | ${formatSeconds(runtime.maxMs)} |`);
    }
  }
  if (comparisons.length > 0) {
    lines.push('', '## Paired comparison', '');
    lines.push('| Left | Right | Paired | Left-only correct | Right-only correct | McNemar exact p |');
    lines.push('|---|---|---:|---:|---:|---:|');
    for (const comparison of comparisons) {
      lines.push(`| ${comparison.left} | ${comparison.right} | ${comparison.paired} | ${comparison.leftOnlyCorrect} | ${comparison.rightOnlyCorrect} | ${comparison.exactTwoSidedP.toPrecision(3)} |`);
    }
  }
  lines.push('', '## Per-category F1', '');
  const categories = [...new Set(oracle.cases.map(item => item.category))];
  lines.push(`| Tool/configuration | ${categories.join(' | ')} |`);
  lines.push(`|---|${categories.map(() => '---:').join('|')}|`);
  for (const result of results) {
    lines.push(`| ${result.name} | ${categories.map(category => formatPercent(result.categories[category].f1)).join(' | ')} |`);
  }
  lines.push('', '## Errors and incomplete cases', '');
  for (const result of results) {
    lines.push(`### ${result.name}`, '');
    if (result.errors.length === 0) lines.push('No classification errors among completed cases.');
    for (const item of result.errors) {
      lines.push(`- ${item.expected ? 'FN' : 'FP'} \`${item.id}\`: reported flows=${item.count}`);
    }
    if (result.missing.length > 0) {
      lines.push(`- Incomplete (${result.missing.length}): ${result.missing.map(id => `\`${id}\``).join(', ')}`);
    }
    lines.push('');
  }
  return `${lines.join('\n')}\n`;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const oracle = readJson(path.resolve(args.oracle));
  if (oracle.cases.length !== 67) throw new Error(`Expected 67 oracle cases, found ${oracle.cases.length}`);
  if (new Set(oracle.cases.map(item => item.id)).size !== oracle.cases.length) {
    throw new Error('Duplicate HapBench case IDs in oracle');
  }

  const tools = [];
  if (args.hapflow) {
    const runtime = args['hapflow-runtime-ms']
      ? {
        cases: oracle.cases.length,
        totalMs: Number(args['hapflow-runtime-ms']),
        medianMs: null,
        p95Ms: null,
        maxMs: null,
      }
      : null;
    tools.push(evaluateTool('HapFlow artifact reproduction', oracle.cases, loadHapFlow(path.resolve(args.hapflow), oracle.cases), runtime));
  }
  if (args.arkprism) {
    const outputDir = path.resolve(args.arkprism);
    tools.push(evaluateTool('ArkPrism full', oracle.cases, loadArkPrism(outputDir, oracle.cases), runtimeSummary(outputDir)));
  }
  const ablations = Object.entries(args)
    .filter(([key]) => key.startsWith('arkprism-ablation-'))
    .map(([key, value]) => [key.slice('arkprism-ablation-'.length), value]);
  for (const [name, outputDir] of ablations) {
    const resolved = path.resolve(outputDir);
    tools.push(evaluateTool(`ArkPrism ${name}`, oracle.cases, loadArkPrism(resolved, oracle.cases), runtimeSummary(resolved)));
  }
  const comparisons = [];
  for (let left = 0; left < tools.length; left++) {
    for (let right = left + 1; right < tools.length; right++) {
      comparisons.push(mcnemarExact(tools[left], tools[right]));
    }
  }

  const outputDir = path.resolve(args.output);
  fs.mkdirSync(outputDir, { recursive: true });
  const result = {
    generatedAt: new Date().toISOString(),
    oracle: {
      path: path.resolve(args.oracle),
      cases: oracle.cases.length,
      positives: oracle.cases.filter(item => item.expected).length,
      negatives: oracle.cases.filter(item => !item.expected).length,
    },
    tools,
    comparisons,
  };
  fs.writeFileSync(path.join(outputDir, 'hapbench_results.json'), `${JSON.stringify(result, null, 2)}\n`);
  fs.writeFileSync(path.join(outputDir, 'hapbench_results.md'), markdown(tools, oracle, comparisons));
  console.log(markdown(tools, oracle, comparisons));
}

main();
