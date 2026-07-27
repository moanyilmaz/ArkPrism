const fs = require('fs');
const path = require('path');

function parseArgs(argv) {
  const args = { reports: '', output: '', requireProvenance: false };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === '--reports') args.reports = argv[++index] || '';
    else if (arg === '--output') args.output = argv[++index] || '';
    else if (arg === '--require-provenance') args.requireProvenance = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!args.reports || !args.output) {
    throw new Error('--reports and --output are required');
  }
  return args;
}

function reportPaths(root) {
  const reports = [];
  const pending = [path.resolve(root)];
  while (pending.length > 0) {
    const current = pending.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const target = path.join(current, entry.name);
      if (entry.isDirectory()) pending.push(target);
      else if (entry.isFile() && entry.name.endsWith('-arkprism-report.json')) {
        reports.push(target);
      }
    }
  }
  return reports.sort();
}

function auditReport(report, requireProvenance = false) {
  const usages = Array.isArray(report.privacyApiUsages) ? report.privacyApiUsages : [];
  const chains = Array.isArray(report.callChains) ? report.callChains : [];
  const flows = Array.isArray(report.taintFlows) ? report.taintFlows : [];
  const links = Array.isArray(report.taintFlowLinks) ? report.taintFlowLinks : [];
  const detectorSinks = chains.reduce(
    (sum, chain) => sum + (Array.isArray(chain.dataSinks) ? chain.dataSinks.length : 0),
    0,
  );
  const errors = [];
  const provenance = { ifds: 0, async_supplement: 0, both: 0, missing: 0, invalid: 0 };
  const sourceKinds = { privacy_data: 0, framework_input: 0, missing: 0, invalid: 0 };
  const configuredSourceEndpoints = new Set();
  const configuredSinkEndpoints = new Set();

  const endpointKey = (api, file, line) => JSON.stringify([
    String(api || '').trim(),
    String(file || '').replace(/\\/g, '/').trim().toLowerCase(),
    Number(line),
  ]);

  flows.forEach((flow, flowIndex) => {
    const tag = flow.provenance;
    if (tag === 'ifds' || tag === 'async_supplement' || tag === 'both') provenance[tag]++;
    else if (tag === undefined) provenance.missing++;
    else provenance.invalid++;

    const sourceKind = flow.sourceKind;
    if (sourceKind === 'privacy_data' || sourceKind === 'framework_input') {
      sourceKinds[sourceKind]++;
    } else if (sourceKind === undefined) {
      sourceKinds.missing++;
    } else {
      sourceKinds.invalid++;
    }

    if (!Array.isArray(flow.path) || flow.path.length === 0) {
      errors.push(`flow ${flowIndex}: empty path`);
    }
    if (!flow.sourceFile || !flow.sinkFile || !flow.sourceApi || !flow.sinkApi) {
      errors.push(`flow ${flowIndex}: missing endpoint file`);
    } else {
      configuredSourceEndpoints.add(endpointKey(flow.sourceApi, flow.sourceFile, flow.sourceLine));
      configuredSinkEndpoints.add(endpointKey(flow.sinkApi, flow.sinkFile, flow.sinkLine));
    }
    if (!flow.sourceIdentity || typeof flow.sourceIdentity !== 'object') {
      errors.push(`flow ${flowIndex}: missing source identity`);
    }
    const finalStatement = flow.path?.[flow.path.length - 1]?.statement;
    if (finalStatement && String(finalStatement).trim() !== String(flow.sinkApi || '').trim()) {
      errors.push(`flow ${flowIndex}: sink endpoint differs from final path statement`);
    }
  });

  if (requireProvenance && (provenance.missing > 0 || provenance.invalid > 0)) {
    errors.push(`flow provenance missing=${provenance.missing}, invalid=${provenance.invalid}`);
  }
  if (requireProvenance && (sourceKinds.missing > 0 || sourceKinds.invalid > 0)) {
    errors.push(`flow source kind missing=${sourceKinds.missing}, invalid=${sourceKinds.invalid}`);
  }

  const linkedFlowIndexes = new Set();
  links.forEach((link, linkIndex) => {
    const usageIndex = Number(link.apiUsageIndex);
    const flowIndex = Number(link.taintFlowIndex);
    if (!Number.isInteger(usageIndex) || usageIndex < 0 || usageIndex >= usages.length) {
      errors.push(`link ${linkIndex}: invalid API usage index ${link.apiUsageIndex}`);
    }
    if (!Number.isInteger(flowIndex) || flowIndex < 0 || flowIndex >= flows.length) {
      errors.push(`link ${linkIndex}: invalid taint flow index ${link.taintFlowIndex}`);
    } else {
      linkedFlowIndexes.add(flowIndex);
      if (flows[flowIndex]?.sourceKind !== 'privacy_data') {
        errors.push(`link ${linkIndex}: non-privacy source kind ${flows[flowIndex]?.sourceKind}`);
      }
    }
    if (link.evidence !== 'exact_statement' && link.evidence !== 'source_location') {
      errors.push(`link ${linkIndex}: invalid evidence ${link.evidence}`);
    }
  });

  return {
    projectName: report.projectName || '(unknown)',
    detectorApiUsages: usages.length,
    detectorLocalSinks: detectorSinks,
    ifdsQueryFlows: flows.length,
    configuredSourceEndpoints: configuredSourceEndpoints.size,
    configuredSinkEndpoints: configuredSinkEndpoints.size,
    endpointLinks: links.length,
    linkedFlows: linkedFlowIndexes.size,
    provenance,
    sourceKinds,
    errors,
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const projects = reportPaths(args.reports).map(reportPath => {
    const report = JSON.parse(fs.readFileSync(reportPath, 'utf8').replace(/^\uFEFF/, ''));
    return auditReport(report, args.requireProvenance);
  });
  const count = predicate => projects.filter(predicate).length;
  const sum = key => projects.reduce((total, project) => total + project[key], 0);
  const errors = projects.flatMap(project => project.errors.map(error => ({
    project: project.projectName,
    error,
  })));
  const result = {
    generatedAt: new Date().toISOString(),
    reportsDirectory: path.resolve(args.reports),
    definitions: {
      detectorLocalSinks: 'Sinks attached to detector usages by report-local tracing.',
      ifdsQueryFlows: 'Flows from the independent IFDS query and asynchronous supplement.',
      configuredSourceEndpoints: 'Unique configured-query source endpoints represented by a path.',
      configuredSinkEndpoints: 'Unique configured-query sink endpoints represented by a path.',
      privacyDataFlows: 'Configured-query paths seeded by a typed privacy-data carrier.',
      frameworkInputFlows: 'Configured-query paths seeded by an explicitly modeled framework input.',
      endpointLinks: 'Conservative joins between the two evidence universes.',
      invariant: 'Every configured-query flow has one retained source endpoint and one retained sink endpoint; detector-local sink projects remain a separate set.',
    },
    projects: projects.length,
    projectSets: {
      detectorApiPositive: count(project => project.detectorApiUsages > 0),
      detectorSinkPositive: count(project => project.detectorLocalSinks > 0),
      ifdsFlowPositive: count(project => project.ifdsQueryFlows > 0),
      configuredSourceEndpointPositive: count(project => project.configuredSourceEndpoints > 0),
      configuredSinkEndpointPositive: count(project => project.configuredSinkEndpoints > 0),
      privacyDataFlowPositive: count(project => project.sourceKinds.privacy_data > 0),
      frameworkInputFlowPositive: count(project => project.sourceKinds.framework_input > 0),
      linkedFlowPositive: count(project => project.linkedFlows > 0),
    },
    totals: {
      detectorApiUsages: sum('detectorApiUsages'),
      detectorLocalSinks: sum('detectorLocalSinks'),
      ifdsQueryFlows: sum('ifdsQueryFlows'),
      configuredSourceEndpoints: sum('configuredSourceEndpoints'),
      configuredSinkEndpoints: sum('configuredSinkEndpoints'),
      privacyDataFlows: projects.reduce(
        (total, project) => total + project.sourceKinds.privacy_data,
        0,
      ),
      frameworkInputFlows: projects.reduce(
        (total, project) => total + project.sourceKinds.framework_input,
        0,
      ),
      endpointLinks: sum('endpointLinks'),
      linkedFlows: sum('linkedFlows'),
    },
    provenance: projects.reduce((totals, project) => {
      for (const key of Object.keys(totals)) totals[key] += project.provenance[key];
      return totals;
    }, { ifds: 0, async_supplement: 0, both: 0, missing: 0, invalid: 0 }),
    sourceKinds: projects.reduce((totals, project) => {
      for (const key of Object.keys(totals)) totals[key] += project.sourceKinds[key];
      return totals;
    }, { privacy_data: 0, framework_input: 0, missing: 0, invalid: 0 }),
    valid: errors.length === 0,
    errors,
  };
  if (result.projectSets.ifdsFlowPositive !== result.projectSets.configuredSourceEndpointPositive
      || result.projectSets.ifdsFlowPositive !== result.projectSets.configuredSinkEndpointPositive) {
    result.errors.push({
      project: '(corpus)',
      error: 'configured-query flow/source/sink endpoint project sets differ',
    });
    result.valid = false;
  }
  fs.mkdirSync(path.dirname(path.resolve(args.output)), { recursive: true });
  fs.writeFileSync(path.resolve(args.output), `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify(result, null, 2));
  if (!result.valid) process.exitCode = 1;
}

if (require.main === module) main();

module.exports = { auditReport };
