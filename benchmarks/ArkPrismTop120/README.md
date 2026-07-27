# ArkPrism Top-120 Benchmark

This benchmark contains manual source review for 666 project--API keys in 120 ArkTS projects.

## Files

- `annotations.json`: manual labels and source evidence.
- `integrity.json`: source/rule integrity check generated for the delivery dataset.
- `sources/`: complete source projects and their hash manifest. Generated dependencies, build output, caches, and Git metadata are excluded.
- `results/`: ArkPrism reports, DOT graphs, run manifest, and evaluation metrics.

Each annotation records the project, normalized API identity, source file, line, column, matched text, source snippet, evidence kind, and review decision.

## Scope

The 120 projects were selected from high-output ArkPrism results. The benchmark therefore measures:

- whether the current tool reproduces the 666 manually confirmed project--API keys;
- whether every current output key is covered by the reviewed set;
- project-level and evidence-kind recovery.

It does not define occurrence-level recall because repeated detections were canonicalized to project--API keys and unreported keys were not exhaustively enumerated.

## Verify annotations

```powershell
node scripts\audit_source_audit_artifact.js `
  --benchmark benchmarks\ArkPrismTop120\annotations.json `
  --dataset "E:\Path\To\ARGUS-successful-1015-samples-20260617" `
  --rules config\sensitive_apis.json `
  --output benchmarks\ArkPrismTop120\integrity.json
```

## Run and evaluate

Create the complete benchmark source corpus when it is not already present:

```powershell
node scripts\package_top120_sources.js `
  --benchmark benchmarks\ArkPrismTop120\annotations.json `
  --dataset "E:\Path\To\ARGUS-successful-1015-samples-20260617" `
  --output benchmarks\ArkPrismTop120\sources
```

Verify the copied project trees:

```powershell
node scripts\verify_top120_source_package.js `
  --sources benchmarks\ArkPrismTop120\sources `
  --output benchmarks\ArkPrismTop120\source_integrity.json
```

```powershell
npm run build

node scripts\run_top120_benchmark.js `
  --dataset benchmarks\ArkPrismTop120\sources `
  --sdkPath "E:\OpenHarmony_SDK\20\ets" `
  --output-dir benchmarks\ArkPrismTop120\results

node scripts\evaluate_top120_benchmark.js `
  --benchmark benchmarks\ArkPrismTop120\annotations.json `
  --reports benchmarks\ArkPrismTop120\results `
  --rules config\sensitive_apis.json `
  --output benchmarks\ArkPrismTop120\results\metrics
```

The runner uses the compiled analyzer, the real SDK path, process isolation, and detector-only mode. JSON and DOT outputs are retained.
