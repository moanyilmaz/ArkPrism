# ArkPrism Minimal Runtime

## Environment

- Node.js 20.x or 24.x
- OpenHarmony SDK `ets` directory. The retained benchmark used API 26 (`26.0.0.38`).

```powershell
npm ci
$env:OPENHARMONY_SDK_PATH = "E:\OpenHarmony_SDK\26.0.0\ets"

node dist\arkprism.js `
  "E:\Projects\MyHarmonyApp" `
  --output-dir "E:\ArkPrismResults" `
  --sdkPath $env:OPENHARMONY_SDK_PATH
```

Use `npm run build` after changing files under `src/`. The `benchmark/` directory contains the PAC-v2 Top-120 annotations and retained metrics.
