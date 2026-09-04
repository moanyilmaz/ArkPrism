'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const sdkPath = process.env.OPENHARMONY_SDK_PATH;
if (!sdkPath || !fs.existsSync(sdkPath)) {
  throw new Error('Set OPENHARMONY_SDK_PATH to a real OpenHarmony SDK ets directory before running delivery checks.');
}

const checks = [
  'verify_arkanalyzer_empty_constructor.js',
  'verify_api_usage_dedup.js',
  'verify_call_chain_dominators.js',
  'verify_corpus_summary.js',
  'verify_detector_domain_migration.js',
  'verify_evidence_linker.js',
  'verify_evidence_universe_audit.js',
  'verify_fuzzy_source_identity.js',
  'verify_ifds_incoming_identity.js',
  'verify_ifds_malformed_cfg.js',
  'verify_ifds_parameter_mapping.js',
  'verify_manager_receiver.js',
  'verify_package_aliases.js',
  'verify_pta_container_edges.js',
  'verify_rule_deduplication.js',
  'verify_runtime_heap.js',
  'verify_runner_strictness.js',
  'verify_sdk_info.js',
  'verify_sensitive_api_catalog.js',
  'verify_sensitive_api_detectability.js',
  'verify_semantic_path_audit_evaluator.js',
  'verify_semantic_path_audit_queue.js',
  'verify_source_audit_export.js',
  'verify_source_catalog_sync.js',
  'verify_source_rule_contract.js',
  'verify_taint_flow_dedup.js',
  'verify_taint_report_comparison.js',
  'verify_taint_source_evidence.js',
  'verify_taint_value_dependency.js',
  'verify_top120_benchmark.js',
  'verify_top120_source_packager.js',
  'verify_windows_long_paths.js',
];

for (const check of checks) {
  console.log(`[CHECK] ${check}`);
  const result = spawnSync(process.execPath, [path.join('tests', check)], {
    cwd: path.resolve('.'),
    stdio: 'inherit',
    env: process.env,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

console.log(`[CHECK] ${checks.length} delivery checks passed.`);
