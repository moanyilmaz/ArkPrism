const fs = require('fs');
const path = require('path');

function parseArgs(argv) {
  const args = {
    reportsDir: 'out_argus_1015_final_20260703',
    annotationsPath: path.join('docs', 'generated_argus1015_source_annotations_final', 'source_sensitive_api_annotations.json'),
    aggregatePath: path.join('out_argus_1015_final_20260703', 'aggregate_summary.json'),
    outputDir: path.join('docs', 'generated_argus1015_final'),
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--reports') args.reportsDir = argv[++i];
    else if (arg === '--annotations') args.annotationsPath = argv[++i];
    else if (arg === '--aggregate') args.aggregatePath = argv[++i];
    else if (arg === '--output-dir') args.outputDir = argv[++i];
    else if (arg === '--help' || arg === '-h') {
      console.log([
        'Usage:',
        '  node scripts/analyze_argus1015_experiment.js --reports out_argus_1015_final_20260703 \\',
        '    --annotations docs/generated_argus1015_source_annotations_final/source_sensitive_api_annotations.json \\',
        '    --aggregate out_argus_1015_final_20260703/aggregate_summary.json \\',
        '    --output-dir docs/generated_argus1015_final',
        '',
        'Generates paper-style metrics from final ArkPrism benchmark outputs.',
      ].join('\n'));
      process.exit(0);
    }
  }

  return args;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, ''));
}

function walkReports(rootDir) {
  const reports = [];
  const stack = [rootDir];
  while (stack.length > 0) {
    const current = stack.pop();
    let entries = [];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(fullPath);
      else if (entry.isFile() && entry.name.endsWith('-arkprism-report.json')) reports.push(fullPath);
    }
  }
  return reports.sort();
}

function pct(value) {
  if (!Number.isFinite(value)) return 'n/a';
  return `${(value * 100).toFixed(2)}%`;
}

function ratio(numerator, denominator) {
  return denominator === 0 ? 0 : numerator / denominator;
}

function quantiles(values) {
  if (values.length === 0) {
    return { min: 0, p25: 0, median: 0, p75: 0, p90: 0, p95: 0, max: 0, mean: 0 };
  }
  const sorted = [...values].sort((a, b) => a - b);
  const pick = q => sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * q))];
  const sum = sorted.reduce((acc, value) => acc + value, 0);
  return {
    min: sorted[0],
    p25: pick(0.25),
    median: pick(0.5),
    p75: pick(0.75),
    p90: pick(0.9),
    p95: pick(0.95),
    max: sorted[sorted.length - 1],
    mean: Number((sum / sorted.length).toFixed(2)),
  };
}

function inc(map, key, amount = 1) {
  const safeKey = key || '(unknown)';
  map.set(safeKey, (map.get(safeKey) || 0) + amount);
}

function topN(map, n = 10) {
  return Array.from(map.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, n)
    .map(([name, count]) => ({ name, count }));
}

function apiKey(item) {
  return [
    item.systemPackage || item.apiPackage || '',
    item.namespace || '',
    item.method || '',
  ].join('|');
}

function normalizedNamespace(namespace) {
  const value = String(namespace || '');
  if (value === 'geolocation') return 'geolocationmanager';
  if (value === 'deviceinfo') return 'deviceinfo';
  const lower = value.toLowerCase();
  if (lower === 'devicemanager' || lower === 'distributeddevicemanager') return 'distributeddevicemanager';
  return lower;
}

function normalizedMethod(method) {
  const base = String(method || '').replace(/\(\)\s*$/, '').replace(/\s*\(.*/, '');
  return base.split('.').filter(Boolean).pop() || base;
}

function apiCompareKey(item) {
  return `${normalizedNamespace(item.namespace)}|${normalizedMethod(item.method)}`;
}

function buildSet(items, keyFn) {
  const set = new Set();
  for (const item of items || []) {
    const key = keyFn(item);
    if (key) set.add(key);
  }
  return set;
}

function intersectSize(a, b) {
  let count = 0;
  for (const item of a) if (b.has(item)) count++;
  return count;
}

function methodNameFromSignature(signature) {
  if (!signature) return '';
  const afterColon = signature.includes(':') ? signature.split(':').pop().trim() : signature;
  const beforeArgs = afterColon.split('(')[0];
  return beforeArgs.split('.').pop() || beforeArgs;
}

function classifyChain(chainInfo, usage) {
  const entry = chainInfo.entryMethod || {};
  const edges = chainInfo.chain || [];
  const entryType = typeof entry === 'string' ? 'string-entry' : entry.type || '(unknown)';

  if (entryType === 'initialization') {
    return 'initialization';
  }
  if (entryType === 'component_lifecycle' || entryType === 'app_lifecycle' || entryType === 'user_interaction') {
    return 'framework-entry';
  }
  if (entryType === 'unknown' && edges.length === 1) {
    return 'local-fallback';
  }
  if (entryType === 'unknown') {
    return 'unknown-entry';
  }
  return entryType;
}

function bucketCount(value) {
  if (value === 0) return '0';
  if (value === 1) return '1';
  if (value <= 3) return '2-3';
  if (value <= 5) return '4-5';
  if (value <= 10) return '6-10';
  return '>10';
}

function analyze(args) {
  const aggregate = fs.existsSync(args.aggregatePath) ? readJson(args.aggregatePath) : null;
  const annotations = readJson(args.annotationsPath);
  const annotationByProject = new Map(annotations.projects.map(project => [project.projectName, project]));
  const reportPaths = walkReports(args.reportsDir);

  const packageCounts = new Map();
  const methodCounts = new Map();
  const profilingCounts = new Map();
  const permissionCounts = new Map();
  const detectorCategoryCounts = new Map();
  const entryTypeCounts = new Map();
  const chainClassCounts = new Map();
  const sinkTypeCounts = new Map();
  const sinkApiCounts = new Map();
  const taintSinkApiCounts = new Map();
  const apiKeyCounts = new Map();

  const chainLengths = [];
  const chainSinkCounts = [];
  const taintPathLengths = [];
  const apisPerProject = [];
  const taintsPerProject = [];
  const methodsPerProject = [];
  const filesPerProject = [];

  const projects = [];
  let totalFiles = 0;
  let totalMethods = 0;
  let totalApis = 0;
  let totalChains = 0;
  let chainsWithPath = 0;
  let chainsWithoutPath = 0;
  let totalSinks = 0;
  let chainsWithSinks = 0;
  let totalTaintFlows = 0;
  let taintFlowsWithPath = 0;

  let benchmarkProjects = 0;
  let benchmarkDetectedProjects = 0;
  let methodTp = 0;
  let methodFpAgainstQualified = 0;
  let methodFn = 0;
  let methodPredicted = 0;
  let methodGold = 0;
  let methodExactProjects = 0;
  let apiTp = 0;
  let apiFpAgainstQualified = 0;
  let apiFn = 0;
  let apiPredicted = 0;
  let apiGold = 0;
  let methodMacroPrecisionSum = 0;
  let methodMacroRecallSum = 0;
  let apiMacroPrecisionSum = 0;
  let apiMacroRecallSum = 0;

  for (const reportPath of reportPaths) {
    const report = readJson(reportPath);
    const projectName = report.projectName || path.basename(path.dirname(reportPath));
    const usages = report.privacyApiUsages || [];
    const chains = report.callChains || [];
    const taintFlows = report.taintFlows || [];
    const annotation = annotationByProject.get(projectName) || {};
    const qualifiedHits = annotation.qualifiedHits || [];
    const benchmarkHits = annotation.presenceHits || qualifiedHits;

    const detectedMethods = buildSet(usages, apiCompareKey);
    const qualifiedMethods = buildSet(benchmarkHits, apiCompareKey);
    const detectedApis = buildSet(usages, apiKey);
    const qualifiedApis = buildSet(qualifiedHits, apiKey);

    const projectMethodTp = intersectSize(detectedMethods, qualifiedMethods);
    const projectMethodFp = Math.max(0, detectedMethods.size - projectMethodTp);
    const projectMethodFn = Math.max(0, qualifiedMethods.size - projectMethodTp);
    const projectApiTp = intersectSize(detectedApis, qualifiedApis);
    const projectApiFp = Math.max(0, detectedApis.size - projectApiTp);
    const projectApiFn = Math.max(0, qualifiedApis.size - projectApiTp);

    const projectMethodPrecision = detectedMethods.size === 0 ? (qualifiedMethods.size === 0 ? 1 : 0) : projectMethodTp / detectedMethods.size;
    const projectMethodRecall = qualifiedMethods.size === 0 ? 1 : projectMethodTp / qualifiedMethods.size;
    const projectApiPrecision = detectedApis.size === 0 ? (qualifiedApis.size === 0 ? 1 : 0) : projectApiTp / detectedApis.size;
    const projectApiRecall = qualifiedApis.size === 0 ? 1 : projectApiTp / qualifiedApis.size;

    methodTp += projectMethodTp;
    methodFpAgainstQualified += projectMethodFp;
    methodFn += projectMethodFn;
    methodPredicted += detectedMethods.size;
    methodGold += qualifiedMethods.size;
    apiTp += projectApiTp;
    apiFpAgainstQualified += projectApiFp;
    apiFn += projectApiFn;
    apiPredicted += detectedApis.size;
    apiGold += qualifiedApis.size;
    methodMacroPrecisionSum += projectMethodPrecision;
    methodMacroRecallSum += projectMethodRecall;
    apiMacroPrecisionSum += projectApiPrecision;
    apiMacroRecallSum += projectApiRecall;

    if (qualifiedMethods.size > 0) benchmarkProjects++;
    if (qualifiedMethods.size > 0 && detectedMethods.size > 0) benchmarkDetectedProjects++;
    if (projectMethodFp === 0 && projectMethodFn === 0) methodExactProjects++;

    const projectSinks = chains.reduce((acc, chain) => acc + (chain.dataSinks || []).length, 0);
    const projectChainsWithPath = chains.filter(chain => (chain.chain || []).length > 0 || chain.entryMethod).length;
    const projectChainsWithoutPath = chains.length - projectChainsWithPath;
    const stats = report.statistics || {};
    totalFiles += stats.totalFilesAnalyzed || 0;
    totalMethods += stats.totalMethodsAnalyzed || 0;
    totalApis += usages.length;
    totalChains += chains.length;
    chainsWithPath += projectChainsWithPath;
    chainsWithoutPath += projectChainsWithoutPath;
    totalSinks += projectSinks;
    totalTaintFlows += taintFlows.length;
    taintFlowsWithPath += taintFlows.filter(flow => (flow.path || []).length > 0).length;
    apisPerProject.push(usages.length);
    taintsPerProject.push(taintFlows.length);
    methodsPerProject.push(stats.totalMethodsAnalyzed || 0);
    filesPerProject.push(stats.totalFilesAnalyzed || 0);

    for (const usage of usages) {
      inc(packageCounts, usage.apiPackage);
      inc(methodCounts, usage.method);
      inc(profilingCounts, usage.profilingCategory);
      inc(permissionCounts, usage.permission || 'permissionless_or_manifest_unknown');
      inc(detectorCategoryCounts, usage.category);
      inc(apiKeyCounts, `${usage.apiPackage || ''}.${usage.namespace || ''}.${usage.method || ''}`);
    }

    for (const chain of chains) {
      const usage = usages[chain.apiUsageIndex] || {};
      const entry = chain.entryMethod || {};
      inc(entryTypeCounts, typeof entry === 'string' ? 'string-entry' : entry.type || '(unknown)');
      inc(chainClassCounts, classifyChain(chain, usage));
      const length = (chain.chain || []).length;
      chainLengths.push(length);
      const sinkCount = (chain.dataSinks || []).length;
      chainSinkCounts.push(sinkCount);
      if (sinkCount > 0) chainsWithSinks++;
      for (const sink of chain.dataSinks || []) {
        inc(sinkTypeCounts, sink.sinkType);
        inc(sinkApiCounts, sink.sinkApi);
      }
    }

    for (const flow of taintFlows) {
      taintPathLengths.push((flow.path || []).length);
      inc(taintSinkApiCounts, flow.sinkApi);
    }

    projects.push({
      projectName,
      files: stats.totalFilesAnalyzed || 0,
      methods: stats.totalMethodsAnalyzed || 0,
      privacyApiUsages: usages.length,
      callChains: chains.length,
      chainsWithPath: projectChainsWithPath,
      chainsWithoutPath: projectChainsWithoutPath,
      dataSinks: projectSinks,
      taintFlows: taintFlows.length,
      benchmarkMethods: qualifiedMethods.size,
      qualifiedMethods: buildSet(qualifiedHits, apiCompareKey).size,
      detectedMethods: detectedMethods.size,
      methodPrecisionAgainstQualified: projectMethodPrecision,
      methodRecallAgainstQualified: projectMethodRecall,
      qualifiedApis: qualifiedApis.size,
      detectedApis: detectedApis.size,
      apiPrecisionAgainstQualified: projectApiPrecision,
      apiRecallAgainstQualified: projectApiRecall,
    });
  }

  const methodMicroPrecision = ratio(methodTp, methodTp + methodFpAgainstQualified);
  const methodMicroRecall = ratio(methodTp, methodTp + methodFn);
  const methodMicroF1 = ratio(2 * methodMicroPrecision * methodMicroRecall, methodMicroPrecision + methodMicroRecall);
  const apiMicroPrecision = ratio(apiTp, apiTp + apiFpAgainstQualified);
  const apiMicroRecall = ratio(apiTp, apiTp + apiFn);
  const apiMicroF1 = ratio(2 * apiMicroPrecision * apiMicroRecall, apiMicroPrecision + apiMicroRecall);

  const summary = {
    generatedAt: new Date().toISOString(),
    inputs: {
      reportsDir: path.resolve(args.reportsDir),
      annotationsPath: path.resolve(args.annotationsPath),
      aggregatePath: path.resolve(args.aggregatePath),
    },
    aggregate,
    dataset: {
      projects: reportPaths.length,
      projectsWithDetectedApis: projects.filter(project => project.privacyApiUsages > 0).length,
      projectsWithBenchmarkSourceApis: benchmarkProjects,
      projectsWithBothBenchmarkAndDetectedApis: benchmarkDetectedProjects,
      totalFilesAnalyzed: totalFiles,
      totalMethodsAnalyzed: totalMethods,
      totalPrivacyApiUsages: totalApis,
      totalCallChains: totalChains,
      totalTaintFlows,
    },
    sourceBenchmark: {
      primaryBenchmark: 'presence',
      rawMethodHits: annotations.totalRawMethodHits,
      presenceSourceHits: annotations.totalPresenceHits || annotations.totalQualifiedHits,
      presenceSourceMethods: annotations.totalPresenceMethods || annotations.totalQualifiedMethods,
      presenceMissingInReport: annotations.totalPresenceMissingInReport ?? annotations.totalQualifiedMissingInReport,
      qualifiedSourceHits: annotations.totalQualifiedHits,
      qualifiedSourceMethods: annotations.totalQualifiedMethods,
      qualifiedMissingInReport: annotations.totalQualifiedMissingInReport,
      rawToQualifiedRatio: ratio(annotations.totalQualifiedHits, annotations.totalRawMethodHits),
      rawToPresenceRatio: ratio(annotations.totalPresenceHits || annotations.totalQualifiedHits, annotations.totalRawMethodHits),
    },
    localization: {
      namespaceMethodLevel: {
        truePositive: methodTp,
        falsePositiveAgainstQualified: methodFpAgainstQualified,
        falseNegative: methodFn,
        predicted: methodPredicted,
        gold: methodGold,
        exactMatchProjects: methodExactProjects,
        microPrecisionAgainstQualified: methodMicroPrecision,
        microRecall: methodMicroRecall,
        microF1AgainstQualified: methodMicroF1,
        macroPrecisionAgainstQualified: methodMacroPrecisionSum / reportPaths.length,
        macroRecall: methodMacroRecallSum / reportPaths.length,
      },
      strictPackageSignatureLevel: {
        truePositive: apiTp,
        falsePositiveAgainstQualified: apiFpAgainstQualified,
        falseNegative: apiFn,
        predicted: apiPredicted,
        gold: apiGold,
        microPrecisionAgainstQualified: apiMicroPrecision,
        microRecall: apiMicroRecall,
        microF1AgainstQualified: apiMicroF1,
        macroPrecisionAgainstQualified: apiMacroPrecisionSum / reportPaths.length,
        macroRecall: apiMacroRecallSum / reportPaths.length,
      },
      note: 'Primary localization metrics use project-level presence evidence: the source file imports a related Harmony package and contains the configured sensitive API method/property token. This intentionally does not require proving that the API is invoked in IR. Qualified invocation-like evidence is reported separately.',
    },
    callChains: {
      total: totalChains,
      withPath: chainsWithPath,
      withoutPath: chainsWithoutPath,
      coverage: ratio(chainsWithPath, totalChains),
      chainClassCounts: Object.fromEntries(chainClassCounts),
      entryTypeCounts: Object.fromEntries(entryTypeCounts),
      length: quantiles(chainLengths),
      lengthBuckets: Object.fromEntries(Array.from(chainLengths.reduce((map, value) => {
        inc(map, bucketCount(value));
        return map;
      }, new Map())).sort()),
      chainsWithSinks,
      chainsWithSinksRatio: ratio(chainsWithSinks, totalChains),
      sinksPerChain: quantiles(chainSinkCounts),
    },
    sinks: {
      total: totalSinks,
      sinkTypeCounts: Object.fromEntries(sinkTypeCounts),
      topSinkApis: topN(sinkApiCounts, 15),
    },
    taint: {
      totalFlows: totalTaintFlows,
      flowsWithPath: taintFlowsWithPath,
      pathCoverage: ratio(taintFlowsWithPath, totalTaintFlows),
      flowsPerApiUsage: ratio(totalTaintFlows, totalApis),
      flowsPerProject: quantiles(taintsPerProject),
      pathLength: quantiles(taintPathLengths),
      pathLengthBuckets: Object.fromEntries(Array.from(taintPathLengths.reduce((map, value) => {
        inc(map, bucketCount(value));
        return map;
      }, new Map())).sort()),
      topTaintSinkApis: topN(taintSinkApiCounts, 15),
    },
    distributions: {
      filesPerProject: quantiles(filesPerProject),
      methodsPerProject: quantiles(methodsPerProject),
      apisPerProject: quantiles(apisPerProject),
      apiPackages: topN(packageCounts, 20),
      methods: topN(methodCounts, 20),
      profilingCategories: topN(profilingCounts, 20),
      permissions: topN(permissionCounts, 20),
      detectorCategories: topN(detectorCategoryCounts, 20),
      apiSignatures: topN(apiKeyCounts, 20),
    },
    topProjects: {
      byApiUsages: [...projects].sort((a, b) => b.privacyApiUsages - a.privacyApiUsages || a.projectName.localeCompare(b.projectName)).slice(0, 20),
      byTaintFlows: [...projects].sort((a, b) => b.taintFlows - a.taintFlows || a.projectName.localeCompare(b.projectName)).slice(0, 20),
      byMethodsAnalyzed: [...projects].sort((a, b) => b.methods - a.methods || a.projectName.localeCompare(b.projectName)).slice(0, 20),
    },
    projects,
  };

  summary.computedAggregate = {
    generatedAt: summary.generatedAt,
    outDir: path.resolve(args.reportsDir),
    projects: reportPaths.length,
    reports: reportPaths.length,
    missing: [],
    readErrors: [],
    projectsWithApis: summary.dataset.projectsWithDetectedApis,
    totalApis,
    totalChainEntries: totalChains,
    withPath: chainsWithPath,
    withoutPath: chainsWithoutPath,
    sinks: totalSinks,
    taintFlows: totalTaintFlows,
    noPath: chainsWithoutPath,
    localFallbackChains: chainClassCounts.get('local-fallback') || 0,
    frameworkEntryChains: (entryTypeCounts.get('component_lifecycle') || 0) +
      (entryTypeCounts.get('app_lifecycle') || 0) +
      (entryTypeCounts.get('user_interaction') || 0) +
      (entryTypeCounts.get('initialization') || 0),
    initializationChains: chainClassCounts.get('initialization') || 0,
  };

  return summary;
}

function markdownTable(headers, rows) {
  return [
    `| ${headers.join(' |')} |`,
    `|${headers.map(() => '---').join('|')}|`,
    ...rows.map(row => `| ${row.join(' | ')} |`),
  ].join('\n');
}

function writeMarkdown(summary, outputPath) {
  const lines = [];
  const loc = summary.localization;
  const chains = summary.callChains;
  const taint = summary.taint;
  const primaryLoc = loc.namespaceMethodLevel;
  const strictLoc = loc.strictPackageSignatureLevel;

  lines.push('# ARGUS-1015 Paper-Style Experiment Analysis');
  lines.push('');
  lines.push(`- Generated at: ${summary.generatedAt}`);
  lines.push(`- Projects: ${summary.dataset.projects}`);
  lines.push(`- Files analyzed: ${summary.dataset.totalFilesAnalyzed}`);
  lines.push(`- Methods analyzed: ${summary.dataset.totalMethodsAnalyzed}`);
  lines.push(`- Privacy API usages: ${summary.dataset.totalPrivacyApiUsages}`);
  lines.push(`- Call chains: ${summary.dataset.totalCallChains}`);
  lines.push(`- Taint flows: ${summary.dataset.totalTaintFlows}`);
  lines.push('');
  lines.push('## Localization Metrics');
  lines.push('');
  lines.push(markdownTable(
    ['Level', 'TP', 'FP*', 'FN', 'Micro Precision*', 'Micro Recall', 'Micro F1*', 'Macro Precision*', 'Macro Recall'],
    [
      [
        'Namespace+method',
        primaryLoc.truePositive,
        primaryLoc.falsePositiveAgainstQualified,
        primaryLoc.falseNegative,
        pct(primaryLoc.microPrecisionAgainstQualified),
        pct(primaryLoc.microRecall),
        pct(primaryLoc.microF1AgainstQualified),
        pct(primaryLoc.macroPrecisionAgainstQualified),
        pct(primaryLoc.macroRecall),
      ],
      [
        'Strict package signature',
        strictLoc.truePositive,
        strictLoc.falsePositiveAgainstQualified,
        strictLoc.falseNegative,
        pct(strictLoc.microPrecisionAgainstQualified),
        pct(strictLoc.microRecall),
        pct(strictLoc.microF1AgainstQualified),
        pct(strictLoc.macroPrecisionAgainstQualified),
        pct(strictLoc.macroRecall),
      ],
    ]
  ));
  lines.push('');
  lines.push('*Namespace+method is the primary localization metric. Its ground truth is source presence, meaning the application imports a related Harmony package and contains the configured API method/property token; it does not require proving an IR call.');
  lines.push('*Strict package signature is an alias-sensitivity diagnostic, not the main recall metric.');
  lines.push('');
  lines.push('## Coverage and Flow Metrics');
  lines.push('');
  lines.push(markdownTable(
    ['Metric', 'Value'],
    [
      ['Qualified source missing in report', summary.sourceBenchmark.qualifiedMissingInReport],
      ['Presence source missing in report', summary.sourceBenchmark.presenceMissingInReport],
      ['Raw-to-presence source ratio', pct(summary.sourceBenchmark.rawToPresenceRatio)],
      ['Raw-to-qualified source ratio', pct(summary.sourceBenchmark.rawToQualifiedRatio)],
      ['Call-chain coverage', pct(chains.coverage)],
      ['Chains with sinks', `${chains.chainsWithSinks}/${chains.total} (${pct(chains.chainsWithSinksRatio)})`],
      ['Taint path coverage', pct(taint.pathCoverage)],
      ['Taint flows per API usage', taint.flowsPerApiUsage.toFixed(2)],
    ]
  ));
  lines.push('');
  lines.push('## Distribution Highlights');
  lines.push('');
  lines.push(markdownTable(
    ['Distribution', 'Min', 'P25', 'Median', 'P75', 'P90', 'P95', 'Max', 'Mean'],
    [
      ['Files/project', summary.distributions.filesPerProject.min, summary.distributions.filesPerProject.p25, summary.distributions.filesPerProject.median, summary.distributions.filesPerProject.p75, summary.distributions.filesPerProject.p90, summary.distributions.filesPerProject.p95, summary.distributions.filesPerProject.max, summary.distributions.filesPerProject.mean],
      ['Methods/project', summary.distributions.methodsPerProject.min, summary.distributions.methodsPerProject.p25, summary.distributions.methodsPerProject.median, summary.distributions.methodsPerProject.p75, summary.distributions.methodsPerProject.p90, summary.distributions.methodsPerProject.p95, summary.distributions.methodsPerProject.max, summary.distributions.methodsPerProject.mean],
      ['APIs/project', summary.distributions.apisPerProject.min, summary.distributions.apisPerProject.p25, summary.distributions.apisPerProject.median, summary.distributions.apisPerProject.p75, summary.distributions.apisPerProject.p90, summary.distributions.apisPerProject.p95, summary.distributions.apisPerProject.max, summary.distributions.apisPerProject.mean],
      ['Chain length', chains.length.min, chains.length.p25, chains.length.median, chains.length.p75, chains.length.p90, chains.length.p95, chains.length.max, chains.length.mean],
      ['Taint path length', taint.pathLength.min, taint.pathLength.p25, taint.pathLength.median, taint.pathLength.p75, taint.pathLength.p90, taint.pathLength.p95, taint.pathLength.max, taint.pathLength.mean],
    ]
  ));
  lines.push('');
  lines.push('## Top API Packages');
  lines.push('');
  lines.push(markdownTable(['Package', 'Count'], summary.distributions.apiPackages.slice(0, 10).map(item => [item.name, item.count])));
  lines.push('');
  lines.push('## Top Privacy Categories');
  lines.push('');
  lines.push(markdownTable(['Category', 'Count'], summary.distributions.profilingCategories.slice(0, 10).map(item => [item.name, item.count])));
  lines.push('');
  lines.push('## Top Projects by API Usages');
  lines.push('');
  lines.push(markdownTable(
    ['Project', 'Files', 'Methods', 'APIs', 'Chains', 'Sinks', 'Taint Flows'],
    summary.topProjects.byApiUsages.slice(0, 15).map(project => [
      project.projectName,
      project.files,
      project.methods,
      project.privacyApiUsages,
      project.callChains,
      project.dataSinks,
      project.taintFlows,
    ])
  ));
  lines.push('');
  lines.push('## Top Projects by Taint Flows');
  lines.push('');
  lines.push(markdownTable(
    ['Project', 'APIs', 'Sinks', 'Taint Flows'],
    summary.topProjects.byTaintFlows.slice(0, 15).map(project => [
      project.projectName,
      project.privacyApiUsages,
      project.dataSinks,
      project.taintFlows,
    ])
  ));
  lines.push('');

  fs.writeFileSync(outputPath, `${lines.join('\n')}\n`, 'utf8');
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const summary = analyze(args);
  fs.mkdirSync(args.outputDir, { recursive: true });
  fs.mkdirSync(path.dirname(args.aggregatePath), { recursive: true });
  fs.writeFileSync(args.aggregatePath, `${JSON.stringify(summary.computedAggregate, null, 2)}\n`, 'utf8');
  const jsonPath = path.join(args.outputDir, 'paper_experiment_analysis.json');
  const markdownPath = path.join(args.outputDir, 'paper_experiment_analysis.md');
  fs.writeFileSync(jsonPath, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
  writeMarkdown(summary, markdownPath);
  console.log(`Wrote ${jsonPath}`);
  console.log(`Wrote ${markdownPath}`);
  console.log(`Namespace+method recall: ${pct(summary.localization.namespaceMethodLevel.microRecall)}`);
  console.log(`Strict package-signature agreement recall: ${pct(summary.localization.strictPackageSignatureLevel.microRecall)}`);
  console.log(`Call-chain coverage: ${pct(summary.callChains.coverage)}`);
}

if (require.main === module) {
  main();
}
