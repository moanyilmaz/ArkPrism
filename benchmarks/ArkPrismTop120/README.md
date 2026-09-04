# ArkPrism Top-120 Benchmark

`pac_v2/` is the current source-first benchmark for the reviewed PAC catalog. It contains 120 ArkTS projects, 1,242 reviewed source candidates, 496 accepted call sites, and 576 gold API occurrences. The complete project trees are delivered separately under `sources/` or in the source archive.

## Files

- `pac_v2/selection_manifest.json`: fixed project list, build-module scope, and source hashes.
- `pac_v2/review_queue.json`: source candidates presented for review.
- `pac_v2/manual_review_decisions.json`: accept/reject decisions for every candidate.
- `pac_v2/gold.json`: occurrence-level gold labels with PAC `dataType` and `label`.
- `pac_v2/evaluation-api26-verified-20260904/`: retained metrics for the final API 26 run.
- `sources/`: complete source projects and their hash manifest. Generated dependencies, build output, caches, and Git metadata are excluded.
- `results/`: ArkPrism reports, DOT graphs, run manifest, and evaluation metrics.

The earlier `annotations.json` remains for compatibility with the previous project-key benchmark.

## Scope

Gold labels cover executable `.ets` and `.ts` files under each project's declared build-module roots. Candidate collection reads source and the reviewed catalog, not ArkPrism reports. Reports are used only after labeling to calculate detector metrics.

## Verify gold

```powershell
$env:ARGUS_DATASET = "E:\Path\To\ARGUS-successful-1015-samples-20260617"
node tests\verify_top120_pac_gold.js
```

## Run and evaluate

Create the complete benchmark source corpus when it is not already present:

```powershell
node scripts\package_top120_sources.js `
  --benchmark benchmarks\ArkPrismTop120\pac_v2\selection_manifest.json `
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
  --benchmark benchmarks\ArkPrismTop120\pac_v2\selection_manifest.json `
  --dataset benchmarks\ArkPrismTop120\sources `
  --sdkPath "E:\OpenHarmony_SDK\26.0.0\ets" `
  --output-dir benchmarks\ArkPrismTop120\results

node scripts\evaluate_source_first_gold.js `
  --gold benchmarks\ArkPrismTop120\pac_v2\gold.json `
  --reports benchmarks\ArkPrismTop120\results `
  --rules config\sensitive_apis.json `
  --output benchmarks\ArkPrismTop120\pac_v2\evaluation
```

The runner uses the compiled analyzer, the real SDK path, process isolation, and detector-only mode. JSON and DOT outputs are retained. Accuracy values describe this fixed benchmark rather than unseen projects.
