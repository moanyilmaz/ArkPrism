# ArkPrism

ArkPrism 是面向 HarmonyOS ArkTS 工程的静态分析工具，用于定位隐私敏感 API、恢复调用链上下文、识别 sink，并输出 source-to-sink 的 may-flow 证据。结果包含 JSON 报告和 DOT 图。

English documentation: [README.md](README.md)

## 环境要求

- 64 位 Windows、Linux 或 macOS
- Node.js 20.x 与 npm
- 包含 ArkTS 声明的 OpenHarmony SDK；分析工程时使用与工程匹配的版本，完整核验 API 目录时使用本机最新稳定版本
- 大型工程建议预留 16 GB 系统内存
- Graphviz 仅用于渲染 DOT

`--sdkPath` 必须指向真实 SDK 的 `ets` 目录。ArkPrism 会读取其中的
`oh-uni-package.json`，将实际 API/SDK 版本写入报告；不会回退到代码内置
路径，也不能用工程内 stub 代替 SDK。

Windows 检查示例：

```powershell
$sdk = $env:OPENHARMONY_SDK_PATH
Test-Path $sdk
Get-Content (Join-Path $sdk "oh-uni-package.json")
Get-ChildItem $sdk -Recurse -Filter *.d.ts | Select-Object -First 1
```

## 安装

```powershell
git clone https://github.com/moanyilmaz/ArkPrism.git
cd ArkPrism
npm ci
npm run build
node dist\arkprism.js --help
```

正式运行使用编译后的 `dist/arkprism.js`。

## Windows 长路径

ArkPrism 会在访问文件系统前，将工程、SDK、配置和输出目录自动转换为 Windows Extended-Length Path。源码发现、ArkTS 解析和报告生成不再受传统 260 字符路径限制；JSON 和 DOT 中仍保存不带 `\\?\` 前缀的普通路径。

接收或解压工程的上游服务必须先完整保留源码文件，尤其应使用支持长路径的方式解压 ZIP。若文件已被上游解压程序遗漏，ArkPrism 无法恢复该文件。工具不会以限制扫描深度或跳过源码作为路径问题的降级方案。

## 分析单个工程

```powershell
$env:ARKPRISM_MAX_OLD_SPACE_SIZE_MB = "12288"

node dist\arkprism.js `
  "E:\Projects\MyHarmonyApp" `
  --output-dir "E:\ArkPrismResults\MyHarmonyApp" `
  --sdkPath $env:OPENHARMONY_SDK_PATH `
  --ifds-max-edges 30000000 `
  --ifds-max-worklist 8000000 `
  --ifds-timeout-ms 1800000 `
  --callback-analysis true `
  --callback-max-methods 200000 `
  --callback-max-sources 20000 `
  --callback-max-states 50000 `
  --callback-max-path-len 160
```

准确率优先配置默认让所有 source 在同一次 IFDS 中运行。除非明确作为资源兜底，不要设置 `--ifds-batch-size`。

## 分析数据集

数据集根目录的每个直接子目录对应一个工程：

```powershell
node scripts\run_argus_batch_isolated.js `
  --dataset "E:\Datasets\HarmonyApps" `
  --output-dir "E:\ArkPrismResults\batch" `
  --log-dir "E:\ArkPrismResults\batch\logs" `
  --sdkPath $env:OPENHARMONY_SDK_PATH `
  --engine compiled `
  --concurrency 2 `
  --timeout-ms 3600000 `
  --node-options "--max-old-space-size=8192" `
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

隔离 runner 会在 `run_manifest.json` 和 `batch_summary.json` 中记录工程集合、SDK/构建/规则哈希、参数、完成状态和逐工程错误。

## Top-120 benchmark

交付 benchmark 位于 `benchmarks/ArkPrismTop120/`，包含 120 个工程中的 848 个源码人工确认 project--API key，并保留源码文件、行列、片段和证据类型。

交付包同时在 `benchmarks/ArkPrismTop120/sources/` 中提供这 120 个工程的完整源码。仅排除依赖目录、构建产物、缓存和 Git 元数据。

检查标注：

```powershell
node scripts\audit_source_audit_artifact.js `
  --benchmark benchmarks\ArkPrismTop120\annotations.json `
  --dataset "E:\Datasets\ARGUS-successful-1015-samples-20260617" `
  --rules config\sensitive_apis.json `
  --output benchmarks\ArkPrismTop120\integrity.json
```

以 detector-only 模式运行 120 个工程，并保留 JSON 与 DOT：

```powershell
node scripts\run_top120_benchmark.js `
  --dataset benchmarks\ArkPrismTop120\sources `
  --sdkPath $env:OPENHARMONY_SDK_PATH `
  --output-dir benchmarks\ArkPrismTop120\results
```

计算指标：

```powershell
node scripts\evaluate_top120_benchmark.js `
  --benchmark benchmarks\ArkPrismTop120\annotations.json `
  --reports benchmarks\ArkPrismTop120\results `
  --rules config\sensitive_apis.json `
  --output benchmarks\ArkPrismTop120\results\metrics
```

该 benchmark 支持人工确认 project-key 精度和 gold-key 复现覆盖率。由于候选来自早期 ArkPrism 输出，且重复 occurrence 被归并为 project-key，因此不用于声明 occurrence-level recall。

## 输出

每个工程生成：

```text
<output>/<project>/
  <project>-arkprism-report.json
  <project>-privacy-graph.dot
```

主要 JSON 字段：

| 字段 | 内容 |
|---|---|
| `sdk` | 实际 OpenHarmony API 版本、SDK 构建版本和 SDK 路径 |
| `privacyApiUsages` | API 身份、PAC `dataType`/`label`、包、源码位置、权限及匹配证据 |
| `callChains` | 入口到 API 的上下文与边来源 |
| `dataSinks` | detector-local sink 结果 |
| `taintFlows` | 配置查询下的 source-to-sink may-path；目录支持的 source 同时带 PAC 元数据 |
| `taintAnalysis` | PTA/IFDS 状态、资源上限与去重统计 |
| `statistics` | 工程级汇总 |

API 或 may-flow 检出结果是审计证据，不直接等同于违规结论。

## 配置文件

| 文件 | 作用 |
|---|---|
| `config/sensitive_apis.json` | 审核后的扁平 API 目录，包含签名、说明、权限、PAC `dataType` 和 `label` |
| `config/package_aliases.json` | `@ohos`/`@kit` 迁移映射 |
| `config/data_sinks.json` | detector-local sink 规则 |
| `config/hapflow_sources.json` | 带明确 carrier 的 IFDS 隐私 source |
| `config/lifecycle_sources.json` | 显式 framework-input source |
| `config/hapflow_sinks.json` | IFDS sink |

`sensitive_apis.json` 是 detector 唯一的敏感 API 清单。IFDS source 是与该
目录同步、且具有明确返回值或 callback carrier 的子集。

使用任意已安装 SDK 核验目录，并记录实际 SDK 版本：

```powershell
npm run audit:sdk-sensitive-apis -- --sdkPath $env:OPENHARMONY_SDK_PATH
```

只检查 IFDS source 是否与目录一致，不写文件：

```powershell
npm run sync:ifds-sources
```

## 常用参数

| 参数 | 作用 |
|---|---|
| `--sdkPath <dir>` | OpenHarmony SDK 的 `ets` 目录 |
| `--output-dir <dir>` | 输出目录 |
| `--no-dot` | 不生成 DOT |
| `--no-taint` | 只运行 detector、调用链和 sink 分析 |
| `--no-pta` | 关闭指针分析，仅用于消融 |
| `--ifds-max-edges <n>` | IFDS 边上限 |
| `--ifds-max-worklist <n>` | IFDS worklist 上限 |
| `--ifds-timeout-ms <n>` | IFDS 超时 |

`--no-taint` 和 `--no-pta` 只能显式启用；分析失败后不会静默切换到这些模式。

## 验证

```powershell
$env:OPENHARMONY_SDK_PATH = "<OpenHarmony SDK ets directory>"
npm run build
npm test
```

正式交付运行应检查：manifest 状态为 `complete`、请求的每个工程均有报告、`errors` 为 0，且没有将资源受限结果当作零结果。

## 仓库结构

| 路径 | 内容 |
|---|---|
| `src/` | ArkPrism、ArkAnalyzer 与 HapFlow 实现 |
| `config/` | API/source/sink 与包迁移规则 |
| `benchmarks/` | 人工及受控 benchmark |
| `scripts/` | runner、指标计算和完整性检查 |
| `tests/` | 回归及 artifact 检查 |
| `docs/` | 报告和补充文档 |

## 分析边界

ArkPrism 分析 ArkTS/TypeScript 源码。Native C/C++、运行时加载代码、服务端逻辑、加密或反射式间接调用以及运行时授权状态，需要结合其他分析方法。报告中的路径是在固定 SDK、规则和可达性模型下的 may-flow 证据。

## 许可证

MIT。第三方组件及 benchmark 工程沿用各自许可证。
