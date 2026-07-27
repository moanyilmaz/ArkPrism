#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const STRICT_NEGATIVE_CASES = new Set([
  'Lifecycle_Modeling__ActivityLifecycle4',
  'Lifecycle_Modeling__BackupExtensionAbility',
  'Lifecycle_Modeling__Button1',
]);

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) continue;
    const name = token.slice(2);
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) {
      args[name] = true;
      continue;
    }
    args[name] = value;
    index += 1;
  }
  return args;
}

function divide(numerator, denominator) {
  return denominator === 0 ? 0 : numerator / denominator;
}

function metrics(confusion) {
  const { tp, tn, fp, fn } = confusion;
  const precision = divide(tp, tp + fp);
  const recall = divide(tp, tp + fn);
  const specificity = divide(tn, tn + fp);
  const f1 = divide(2 * precision * recall, precision + recall);
  const balancedAccuracy = (recall + specificity) / 2;
  const denominator = Math.sqrt(
    (tp + fp) * (tp + fn) * (tn + fp) * (tn + fn),
  );
  const mcc = denominator === 0 ? 0 : ((tp * tn) - (fp * fn)) / denominator;

  return {
    ...confusion,
    precision,
    recall,
    specificity,
    f1,
    balancedAccuracy,
    mcc,
  };
}

function evaluateCases(cases, relabelStrictCases) {
  const confusion = { tp: 0, tn: 0, fp: 0, fn: 0 };
  const outcomes = [];

  for (const benchmarkCase of cases) {
    const expected = relabelStrictCases && STRICT_NEGATIVE_CASES.has(benchmarkCase.id)
      ? false
      : Boolean(benchmarkCase.expected);
    const predicted = Boolean(benchmarkCase.predicted);
    const classification = expected
      ? (predicted ? 'TP' : 'FN')
      : (predicted ? 'FP' : 'TN');
    confusion[classification.toLowerCase()] += 1;
    outcomes.push({
      id: benchmarkCase.id,
      expected,
      predicted,
      classification,
    });
  }

  return {
    metrics: metrics(confusion),
    outcomes,
  };
}

function exactTwoSidedMcNemar(firstCases, secondCases) {
  const secondById = new Map(secondCases.map((item) => [item.id, item]));
  let firstOnlyCorrect = 0;
  let secondOnlyCorrect = 0;

  for (const first of firstCases) {
    const second = secondById.get(first.id);
    if (!second) throw new Error(`Missing paired case: ${first.id}`);
    const firstCorrect = first.expected === first.predicted;
    const secondCorrect = second.expected === second.predicted;
    if (firstCorrect && !secondCorrect) firstOnlyCorrect += 1;
    if (!firstCorrect && secondCorrect) secondOnlyCorrect += 1;
  }

  const discordant = firstOnlyCorrect + secondOnlyCorrect;
  if (discordant === 0) {
    return { firstOnlyCorrect, secondOnlyCorrect, discordant, pValue: 1 };
  }

  const smaller = Math.min(firstOnlyCorrect, secondOnlyCorrect);
  let cumulative = 0;
  for (let successes = 0; successes <= smaller; successes += 1) {
    let combination = 1;
    for (let factor = 1; factor <= successes; factor += 1) {
      combination *= (discordant - factor + 1) / factor;
    }
    cumulative += combination * (0.5 ** discordant);
  }

  return {
    firstOnlyCorrect,
    secondOnlyCorrect,
    discordant,
    pValue: Math.min(1, 2 * cumulative),
  };
}

function selectTool(results, pattern) {
  const tool = results.tools.find((candidate) => pattern.test(candidate.name));
  if (!tool) throw new Error(`Unable to find tool matching ${pattern}`);
  return tool;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.input || !args.output) {
    throw new Error(
      'Usage: node scripts/analyze_hapbench_oracle_sensitivity.js '
      + '--input <hapbench_results.json> --output <oracle_sensitivity.json>',
    );
  }

  const inputPath = path.resolve(args.input);
  const outputPath = path.resolve(args.output);
  const results = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
  const hapflow = selectTool(results, /^HapFlow artifact reproduction$/);
  const arkprism = selectTool(results, /^ArkPrism full$/);
  const unboundedLifecycle = results.tools.find(
    (candidate) => /^ArkPrism unbounded[_-]lifecycle$/.test(candidate.name),
  );

  const published = {
    hapflow: evaluateCases(hapflow.cases, false),
    arkprism: evaluateCases(arkprism.cases, false),
  };
  if (unboundedLifecycle) {
    published.unboundedLifecycle = evaluateCases(unboundedLifecycle.cases, false);
  }
  published.mcnemar = exactTwoSidedMcNemar(
    published.arkprism.outcomes,
    published.hapflow.outcomes,
  );
  if (published.unboundedLifecycle) {
    published.boundedVsUnbounded = exactTwoSidedMcNemar(
      published.arkprism.outcomes,
      published.unboundedLifecycle.outcomes,
    );
  }

  const strictExecutedOrder = {
    hapflow: evaluateCases(hapflow.cases, true),
    arkprism: evaluateCases(arkprism.cases, true),
  };
  if (unboundedLifecycle) {
    strictExecutedOrder.unboundedLifecycle = evaluateCases(
      unboundedLifecycle.cases,
      true,
    );
  }
  strictExecutedOrder.mcnemar = exactTwoSidedMcNemar(
    strictExecutedOrder.arkprism.outcomes,
    strictExecutedOrder.hapflow.outcomes,
  );
  if (strictExecutedOrder.unboundedLifecycle) {
    strictExecutedOrder.boundedVsUnbounded = exactTwoSidedMcNemar(
      strictExecutedOrder.arkprism.outcomes,
      strictExecutedOrder.unboundedLifecycle.outcomes,
    );
  }

  const output = {
    generatedAt: new Date().toISOString(),
    input: inputPath,
    primaryOracle: 'published HapBench source annotations',
    secondaryOracle: {
      name: 'strict executed-order sensitivity',
      scope: 'post-hoc sensitivity analysis; not the primary benchmark result',
      relabeledAsNegative: [...STRICT_NEGATIVE_CASES],
      contract: [
        'An overridden lifecycle method does not execute its parent body without an explicit super call.',
        'Instance fields do not transfer across framework-created instances without an explicit same-object witness.',
        'A UI callback that occurs after initial ability creation does not feed an earlier onCreate without an explicit later-creation edge.',
      ],
    },
    published,
    strictExecutedOrder,
  };

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8');

  console.log(JSON.stringify({
    output: outputPath,
    published: {
      hapflow: published.hapflow.metrics,
      arkprism: published.arkprism.metrics,
      unboundedLifecycle: published.unboundedLifecycle?.metrics,
      mcnemar: published.mcnemar,
      boundedVsUnbounded: published.boundedVsUnbounded,
    },
    strictExecutedOrder: {
      hapflow: strictExecutedOrder.hapflow.metrics,
      arkprism: strictExecutedOrder.arkprism.metrics,
      unboundedLifecycle: strictExecutedOrder.unboundedLifecycle?.metrics,
      mcnemar: strictExecutedOrder.mcnemar,
      boundedVsUnbounded: strictExecutedOrder.boundedVsUnbounded,
    },
  }, null, 2));
}

if (require.main === module) {
  main();
}

module.exports = {
  STRICT_NEGATIVE_CASES,
  evaluateCases,
  exactTwoSidedMcNemar,
  metrics,
};
