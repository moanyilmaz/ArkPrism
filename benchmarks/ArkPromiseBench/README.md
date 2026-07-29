# ArkPromiseBench

ArkPromiseBench is a source-level semantic boundary suite for Promise
continuations. A case is positive only when a configured Promise payload is
explicitly data-dependent on the argument passed to `console.info`.

The 16 cases contain six positives and ten adversarial negatives across:

- Promise success-handler binding;
- Promise and alias identity;
- success versus rejection handler position;
- custom/non-Promise `then` ownership;
- `catch` and `finally`;
- ignored, constant, and sanitized values;
- sequential continuation return dependence; and
- Promise flattening.

The benchmark is generated deterministically:

```powershell
npm run generate:arkpromisebench
```

Run the full configuration and the T4 ablation with the API-20 SDK:

```powershell
$env:OPENHARMONY_SDK_PATH='E:\OpenHarmony_SDK\20\ets'
node scripts/run_full_dataset.js `
  --dataset benchmarks\ArkPromiseBench `
  --output experiments\arkpromisebench_full `
  --sdk $env:OPENHARMONY_SDK_PATH `
  --no-pta --callback-analysis false

$env:ARKPRISM_DISABLE_CONTINUATION_FLOW='1'
node scripts/run_full_dataset.js `
  --dataset benchmarks\ArkPromiseBench `
  --output experiments\arkpromisebench_no_t4 `
  --sdk $env:OPENHARMONY_SDK_PATH `
  --no-pta --callback-analysis false
Remove-Item Env:ARKPRISM_DISABLE_CONTINUATION_FLOW

node scripts/evaluate_arkasyncbench.js `
  --oracle benchmarks\ArkPromiseBench\oracle.json `
  --full experiments\arkpromisebench_full `
  --continuation-off experiments\arkpromisebench_no_t4 `
  --output-dir experiments\arkpromisebench_evaluation
```

The optional callback supplement is disabled so that the comparison isolates
IFDS continuation semantics.
