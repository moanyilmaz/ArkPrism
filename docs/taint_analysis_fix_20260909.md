# 大项目污点分析修复

本轮修复代码位于 `E:\arkprism-taint-fix-20260909`，基于 `a539811` 建立独立工作目录。输入为 MusicForOpenHarmony 与 AppGalleryForOpenHarmony-master，使用 OpenHarmony API 26 SDK。原始结果保留在 `E:\APWithTaint0926`，本轮最终复测输出位于 `E:\APWithTaintFixed20260909\completed`。

## 修复内容

| 问题 | 处理方式 | 主要文件 |
|---|---|---|
| API 检出结果没有完整接入 IFDS，字段读取、管理器调用等使用旧 source 清单时丢失 | 将已接受的 API occurrence 绑定到对应 IR 语句及返回值、字段值或 callback 参数，保留 API 身份和 PAC 信息 | `src/hapflow/CatalogSourceBindings.ts`、`src/hapflowRunner.ts`、`src/arkprism.ts` |
| SDK 中 sink 的命名空间、所属类及重载配置错误 | 按 SDK 声明修正 24 条规则，解析出 36 个 sink 签名；显式限定文件写入等接口的数据参数 | `config/hapflow_sinks.json`、`src/hapflow/Util.ts` |
| 可选参数导致合法 callback 调用匹配失败 | 区分必需参数、可选参数和可变参数；保留传感器事件类型，排除错误参数位置 | `src/hapflow/Util.ts` |
| 普通 `on` 等方法误匹配 sink，保存的结果被后续传播修改 | 去掉方法名子串匹配的旁路；报告保存独立路径快照 | `src/hapflow/TaintAnalysis.ts` |
| 无关静态字段被传播到其他对象字面量 | 检查字段所属类；对有明确对象字面量证据的字段恢复正确所属类 | `src/hapflow/TaintAnalysis.ts` |
| 命中一个缓存返回结果后丢掉其他返回值和后续传播 | 回放全部匹配返回摘要，并执行 call-to-return transfer | `src/hapflow/DataflowSolver.ts` |
| 字段引用反复创建导致同一分析状态被重复处理 | 对字段及访问路径进行结构化去重，同时保留 receiver、source 和 Promise 状态的区别 | `src/hapflow/DataflowSolver.ts`、`src/hapflow/Util.ts` |
| 大量队列移动、全局摘要扫描及 PTA 调用边重复查询 | 保留原有调度次序，使用专用工作队列及按语句、调用者建立的索引 | `src/hapflow/AnalysisWorklist.ts`、`src/hapflow/DataflowSolver.ts`、`src/callGraphBuilder.ts` |

分析不会在失败后自动关闭 PTA 或污点分析。默认使用单次 IFDS 求解，不通过减少输入工程文件提高完成率。超过资源预算或存在未绑定的 API 时，报告保留 `PARTIAL_SUCCESS`。

## 两个项目的完整复测

使用 Node.js 20.18.0、`--max-old-space-size=12288`、API 26 SDK，两个项目顺序执行，保留默认 900 秒 IFDS 时间预算与 1,000 万条分析边预算。总耗时包含 Scene、调用链、PTA、IFDS 和报告生成；这是本机单次复测时长，不是多轮性能基准。

| 指标 | MusicForOpenHarmony | AppGalleryForOpenHarmony-master |
|---|---:|---:|
| 分析文件 / 方法 | 5,741 / 95,149 | 1,709 / 21,723 |
| API occurrence / 调用链 | 39 / 39 | 57 / 57 |
| 已绑定 API / 已检出 API | 39 / 39 | 57 / 57 |
| 其中字段读取 | 8 | 9 |
| SDK 可解析 sink 签名 | 36 | 36 |
| IFDS 分析边 | 4,336,219 | 1,559,703 |
| IFDS 用时（秒） | 592.542 | 209.851 |
| 完整流程用时（秒） | 753.48 | 267.44 |
| IFDS / 回调预算超限 | 否 / 否 | 否 / 否 |
| 分析状态 | SUCCESS | SUCCESS |
| 污点流 | 1 | 0 |
| 其中 privacy_data / framework_input | 0 / 1 | 0 / 0 |

原先两个报告均为 `PARTIAL_SUCCESS`，且 sink 签名只解析出 1 个；修复后均在原有预算内结束。新旧结果的 source/sink 端点及路径对比没有新增或删除记录。`SUCCESS` 表示当前模型下的求解正常结束，并不表示第三方依赖已补齐或真实行为零漏检。

完整结果文件：

- `E:\APWithTaintFixed20260909\completed\Music\MusicForOpenHarmony\MusicForOpenHarmony-arkprism-report.json`
- `E:\APWithTaintFixed20260909\completed\AppGallery\AppGalleryForOpenHarmony-master\AppGalleryForOpenHarmony-master-arkprism-report.json`
- 各报告同目录保留 DOT；`completed` 根目录保留 `Music.log`、`AppGallery.log`、两个 `*-run.json`、`summary.json` 和 `comparison.json`。

单项目复现命令如下；替换输入及输出目录即可运行另一个工程：

```powershell
cd E:\arkprism-taint-fix-20260909
node --max-old-space-size=12288 dist\arkprism.js `
  E:\APNoTaint0926\MusicForOpenHarmony `
  --output-dir E:\APWithTaintFixed20260909\rerun-Music `
  --sdkPath E:\OpenHarmony_SDK\26.0.0\ets
```

## 回归检查

TypeScript 编译通过，37 项交付检查通过。其中本轮的 `tests/verify_catalog_taint.js` 覆盖 14 个端到端正负例，包括字段读取、覆盖清除、传感器 callback、错误参数、HTTP 请求与工厂区分、文件数据参数、对象字段以及多个调用点的多返回值传播。

另有队列调度等价测试、PTA 调用查询测试、sink 路径快照测试、不同 source/receiver/Promise 状态隔离测试，以及重复构造字段引用的循环收敛测试。Top-120 检查验证现有标注文件及源码对应关系，本轮没有重新全量运行 120 个应用，也不据此给出新的准确率或召回率。

```powershell
cd E:\arkprism-taint-fix-20260909
$env:OPENHARMONY_SDK_PATH = 'E:\OpenHarmony_SDK\26.0.0\ets'
$env:ARGUS_DATASET = 'E:\Projects\ARGUS\release_20260617\ARGUS-successful-1015-samples-20260617'
npm run build
node scripts\run_delivery_checks.js
```

## 结果解读

`privacyApiUsages` 表示已识别的敏感 API；`catalogBindings` 表示这些 occurrence 是否绑定到污点分析所需的程序值。这项绑定覆盖率不是 API 召回率。

`callChains` 中的结构性数据去向与 `taintFlows` 不是同一集合。后者要求在当前 source/sink 模型下恢复数据传播路径。`sourceKind=framework_input` 表示显式建模的框架入参，不应当作敏感清单中的数据采集 API。

原版 Music 中的一条流来自 `test_common/src/ohosTest/ets/testability/TestAbility.ets`：`onCreate(want)` 的参数经 `JSON.stringify` 到达第 13 行 `hilog.info`。它是框架入参流，而非新清单 API 的隐私数据流。

两个源码包存在第三方依赖实现缺失的情况。例如：

- AppGallery：`presentation/globalCommonInit/src/default/ets/educationspace/EducationSpaceManager.ets:72` 读取 `settings.getValue(...)`，第 74 行传给 `Logger.info`；`Logger` 导入自 `@hw-ae-foundation/essential-toolkit/src/api/Logger`，输入包内未找到对应实现。
- Music：`lib_ability/ability_cadence/src/main/ets/service/stepcount/StepSensorCounter.ets:28` 注册计步回调，结果进入 `this.curTotalStepCount`，随后传给 `logger.debug`；`Logger` 导入自 `@hw-hmf/audioengine-util-ohos`，输入包内未找到对应实现。

这些调用可以保留为下游审查线索。若需继续确认进入系统日志、网络或存储的具体路径，应补齐相应依赖源码，或提供经审核的、包含包名及数据参数位置的第三方接口模型。不能仅凭 `Logger`、`info` 等名字将其计作已经确认的系统 sink。
