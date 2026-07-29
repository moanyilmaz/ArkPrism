# ArkPromiseBench

ArkPromiseBench is a source-level semantic boundary suite for Promise
continuations. A case is positive only when a configured Promise payload is
explicitly data-dependent on the argument passed to `console.info`.
The oracle records this decision as a case-specific `oracleReason`, allowing
each label to be checked directly against its retained ArkTS source.

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
node scripts/run_argus_batch_isolated.js `
  --dataset benchmarks\ArkPromiseBench `
  --output-dir experiments\arkpromisebench_full `
  --sdkPath $env:OPENHARMONY_SDK_PATH `
  --engine compiled --concurrency 1 --timeout-ms 600000 --max-attempts 1 `
  -- --no-dot --no-pta --callback-analysis false --ifds-timeout-ms 300000

node scripts/run_argus_batch_isolated.js `
  --dataset benchmarks\ArkPromiseBench `
  --output-dir experiments\arkpromisebench_no_t4 `
  --sdkPath $env:OPENHARMONY_SDK_PATH `
  --engine compiled --concurrency 1 --timeout-ms 600000 --max-attempts 1 `
  --disable-continuation-flow `
  -- --no-dot --no-pta --callback-analysis false --ifds-timeout-ms 300000

node scripts/run_argus_batch_isolated.js `
  --dataset benchmarks\ArkPromiseBench `
  --output-dir experiments\arkpromisebench_post_ifds `
  --sdkPath $env:OPENHARMONY_SDK_PATH `
  --engine compiled --concurrency 1 --timeout-ms 600000 --max-attempts 1 `
  --disable-continuation-flow `
  -- --no-dot --no-pta --callback-analysis true --ifds-timeout-ms 300000

node scripts/evaluate_arkasyncbench.js `
  --oracle benchmarks\ArkPromiseBench\oracle.json `
  --full experiments\arkpromisebench_full `
  --continuation-off experiments\arkpromisebench_no_t4 `
  --output-dir experiments\arkpromisebench_evaluation
```

The full versus no-T4 comparison disables the optional callback supplement so
that it isolates IFDS continuation semantics. The third run reproduces the
bounded post-IFDS recovery baseline. Every run manifest records the
continuation-flow switch explicitly.
