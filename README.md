# ArkPrism

ArkPrism is a static-analysis tool for HarmonyOS ArkTS projects. It locates privacy-sensitive API usages, recovers call-chain context, classifies sinks, and reports source-to-sink may-flows as JSON and DOT artifacts.

Chinese documentation: [README.zh-CN.md](README.zh-CN.md)

## Requirements

- 64-bit Windows, Linux, or macOS
- Node.js 20.x or 24.x and npm
- OpenHarmony SDK with ArkTS declarations
- 16 GB system memory is recommended for large-project PTA/IFDS runs
- Graphviz only when rendering DOT files

The SDK argument must point to the real `ets` directory. Do not use project stubs as an SDK substitute.

Windows example:

```powershell
$sdk = "E:\OpenHarmony_SDK\20\ets"
Test-Path $sdk
Get-ChildItem $sdk -Recurse -Filter *.d.ts | Select-Object -First 1
```

## Install

```powershell
git clone https://github.com/moanyilmaz/ArkPrism.git
cd ArkPrism
npm ci
npm run build
node dist\arkprism.js --help
```

Use the compiled entry `dist/arkprism.js` for delivery runs.

## Windows long paths

ArkPrism keeps logical and report paths in ordinary absolute form and uses Windows-native path resolution at filesystem boundaries. Source discovery, ArkTS parsing, and report generation therefore do not use the legacy 260-character limit, while JSON and DOT artifacts remain free of the `\\?\` prefix.

The service that receives or extracts a project must preserve the files before ArkPrism starts. In particular, ZIP extraction must use long-path-aware filesystem operations; ArkPrism cannot analyze a source file that an upstream extractor silently omitted. No scan-depth limit or source-file skipping is used as a path-length fallback.

## Analyze one project

ArkPrism checks the V8 heap before analysis and automatically relaunches itself
with a 12 GB heap when Node's default limit is smaller. This is an upper bound,
not a pre-allocation. Override it when required by the deployment environment:

```powershell
$env:ARKPRISM_MAX_OLD_SPACE_SIZE_MB = "12288"  # 0 disables automatic relaunch

node dist\arkprism.js `
  "E:\Projects\MyHarmonyApp" `
  --output-dir "E:\ArkPrismResults\MyHarmonyApp" `
  --sdkPath "E:\OpenHarmony_SDK\20\ets" `
  --ifds-max-edges 30000000 `
  --ifds-max-worklist 8000000 `
  --ifds-timeout-ms 1800000 `
  --callback-analysis true `
  --callback-max-methods 200000 `
  --callback-max-sources 20000 `
  --callback-max-states 50000 `
  --callback-max-path-len 160
```

The accuracy-oriented configuration runs all sources in one IFDS solver. Do not set `--ifds-batch-size` unless a documented resource fallback is required.

## Analyze a dataset

The dataset directory must contain one project per direct child directory.

```powershell
node scripts\run_argus_batch_isolated.js `
  --dataset "E:\Datasets\HarmonyApps" `
  --output-dir "E:\ArkPrismResults\batch" `
  --log-dir "E:\ArkPrismResults\batch\logs" `
  --sdkPath "E:\OpenHarmony_SDK\20\ets" `
  --engine compiled `
  --concurrency 2 `
  --timeout-ms 3600000 `
  --node-options "--max-old-space-size=12288" `
  --max-attempts 1 `
  -- `
  --ifds-max-edges 30000000 `
  --ifds-max-worklist 8000000 `
  --ifds-timeout-ms 1800000 `
  --callback-max-methods 200000 `
  --callback-max-sources 20000 `
  --callback-max-states 50000 `
  --callback-max-path-len 160
```

The isolated runner records the exact project set, SDK/build/configuration hashes, arguments, completion state, and per-project errors in `run_manifest.json` and `batch_summary.json`.

## Top-120 benchmark

The delivery benchmark is under `benchmarks/ArkPrismTop120/`. It contains 848 manually confirmed project--API keys from 120 projects, with source files, lines, snippets, and evidence types.

The delivery package also contains the complete source projects under `benchmarks/ArkPrismTop120/sources/`. Generated dependencies, build output, caches, and Git metadata are excluded.

Verify the annotations:

```powershell
node scripts\audit_source_audit_artifact.js `
  --benchmark benchmarks\ArkPrismTop120\annotations.json `
  --dataset "E:\Datasets\ARGUS-successful-1015-samples-20260617" `
  --rules config\sensitive_apis.json `
  --output benchmarks\ArkPrismTop120\integrity.json
```

Run the exact 120 projects in detector-only mode and retain JSON plus DOT output:

```powershell
node scripts\run_top120_benchmark.js `
  --dataset benchmarks\ArkPrismTop120\sources `
  --sdkPath "E:\OpenHarmony_SDK\20\ets" `
  --output-dir benchmarks\ArkPrismTop120\results
```

Calculate metrics:

```powershell
node scripts\evaluate_top120_benchmark.js `
  --benchmark benchmarks\ArkPrismTop120\annotations.json `
  --reports benchmarks\ArkPrismTop120\results `
  --rules config\sensitive_apis.json `
  --output benchmarks\ArkPrismTop120\results\metrics
```

This benchmark reports manually confirmed project-key precision and gold-key reproduction coverage. It does not claim occurrence-level recall because its candidates were selected from an earlier ArkPrism output.

## Output

Each analyzed project produces:

```text
<output>/<project>/
  <project>-arkprism-report.json
  <project>-privacy-graph.dot
```

Important JSON sections:

| Field | Content |
|---|---|
| `privacyApiUsages` | API identity, package, source location, permission, and match evidence |
| `callChains` | recovered entry-to-API context and edge provenance |
| `dataSinks` | detector-local sink observations |
| `taintFlows` | configured-query source-to-sink may-paths and source provenance |
| `taintAnalysis` | PTA/IFDS status, limits, and deduplication statistics |
| `statistics` | project-level counts |

A detected API or may-flow is analysis evidence, not an automatic policy-violation verdict.

## Configuration

| File | Purpose |
|---|---|
| `config/sensitive_apis.json` | detector API rules |
| `config/package_aliases.json` | namespace-constrained `@ohos`/`@kit` migration |
| `config/data_sinks.json` | detector-local sink rules |
| `config/hapflow_sources.json` | typed IFDS privacy-data sources |
| `config/lifecycle_sources.json` | explicit framework-input sources |
| `config/hapflow_sinks.json` | IFDS sinks |

Detector rules and IFDS source rules are intentionally separate. A permission-bearing operation is not a taint source unless the source rule identifies a concrete return or callback carrier.

## Useful options

| Option | Meaning |
|---|---|
| `--sdkPath <dir>` | OpenHarmony SDK `ets` directory |
| `--output-dir <dir>` | output directory |
| `--no-dot` | skip DOT generation |
| `--no-taint` | detector/call-chain/sink analysis only |
| `--no-pta` | disable pointer analysis; use for ablation only |
| `--ifds-max-edges <n>` | IFDS edge limit |
| `--ifds-max-worklist <n>` | IFDS worklist limit |
| `--ifds-timeout-ms <n>` | IFDS timeout |

`--no-taint` and `--no-pta` are explicit modes; ArkPrism does not silently switch to them after a failure.

## Validation

```powershell
$env:OPENHARMONY_SDK_PATH = "E:\OpenHarmony_SDK\20\ets"
npm run build
npm test
```

For a delivery run, check that the manifest is `complete`, every requested project has a report, `errors` is zero, and no retained result is resource-bounded.

## Repository layout

| Path | Purpose |
|---|---|
| `src/` | ArkPrism, bundled ArkAnalyzer, and HapFlow implementation |
| `config/` | API/source/sink and package rules |
| `benchmarks/` | manual and controlled benchmarks |
| `scripts/` | batch runners, evaluators, and integrity checks |
| `tests/` | regression and artifact checks |
| `docs/` | reports and supporting documentation |

## Analysis boundaries

ArkPrism analyzes ArkTS/TypeScript source. Native C/C++ code, runtime-loaded code, server-side behavior, encrypted/reflection-like indirection, and runtime consent state require complementary analysis. Reported paths are may-flow evidence under the configured SDK, rules, and reachability model.

## License

MIT. Third-party components and benchmark projects retain their original licenses.
