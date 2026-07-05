# ArkPrism ARGUS-1015 全量实验报告

## 实验设置

- 测试日期: 2026-07-05
- 样本集: `E:\Projects\ARGUS\release_20260617\ARGUS-successful-1015-samples-20260617`
- 样本数量: 1015
- SDK: `E:\OpenHarmony_SDK\20\ets`
- ArkPrism 输出: `out_argus_1015_validated_20260704`
- 源码 benchmark: `docs/generated_argus1015_source_annotations_validated_20260705/source_sensitive_api_annotations.md`
- 论文式指标: `docs/generated_argus1015_validated_20260705_analysis/paper_experiment_analysis.md`
- Top-50 人工复核 benchmark: `docs/generated_argus1015_top50_manual_audit/manual_top50_benchmark_20260705.md`
- 运行稳定性: `docs/generated_argus1015_validated_20260704_analysis/runtime_stability_analysis.json`

本轮使用真实 OpenHarmony SDK 运行，不启用 SDK fallback。由于内置 `--batch` 单进程模式在第 20 个样本附近出现跨项目内存累积，正式全量实验改用样本级隔离 runner：每个样本独立 ArkPrism 进程、同一套 detector/IFDS/callback 参数、支持 resume，并发度为 2。该调整只改变实验执行方式，不改变分析算法。

## 可复现命令

```powershell
node scripts\run_argus_batch_isolated.js `
  --dataset "E:\Projects\ARGUS\release_20260617\ARGUS-successful-1015-samples-20260617" `
  --output-dir out_argus_1015_validated_20260704 `
  --sdkPath E:\OpenHarmony_SDK\20\ets `
  --log-dir logs\argus1015_validated_20260704_isolated `
  --timeout-ms 2700000 `
  --node-options "--max-old-space-size=12288" `
  --concurrency 2 `
  --resume `
  --prior-log logs\argus1015_validated_20260704.log `
  -- `
  --ifds-max-edges 30000000 `
  --ifds-max-worklist 8000000 `
  --ifds-timeout-ms 900000 `
  --callback-analysis true `
  --callback-max-methods 200000 `
  --callback-max-sources 20000 `
  --callback-max-states 50000 `
  --callback-max-path-len 160

node scripts\annotate_sensitive_api_source.js `
  --dataset "E:\Projects\ARGUS\release_20260617\ARGUS-successful-1015-samples-20260617" `
  --reports out_argus_1015_validated_20260704 `
  --output-dir docs\generated_argus1015_source_annotations_validated_20260705

node scripts\analyze_argus1015_experiment.js `
  --reports out_argus_1015_validated_20260704 `
  --annotations docs\generated_argus1015_source_annotations_validated_20260705\source_sensitive_api_annotations.json `
  --aggregate out_argus_1015_validated_20260704\aggregate_summary_20260705.json `
  --output-dir docs\generated_argus1015_validated_20260705_analysis
```

## Benchmark 标注口径

本轮不把裸字符串命中当成真实敏感 API。`scripts/annotate_sensitive_api_source.js` 从 `config/sensitive_apis.json` 读取规则，生成三层证据：

- `raw`: 去注释后只搜索方法名字符串，仅用于说明噪声规模。
- `presence`: 同一源码文件存在相关 Harmony package import，并出现配置中的敏感 API 方法/属性 token；该口径表示“应用源码包含这个 API”，不要求证明已经形成 IR 调用。
- `qualified`: 源码存在对应 package/import，并出现 `namespace.method`、`namespace.property` 或多段成员访问；这是更强的调用/字段读取证据。

标注脚本排除 `node_modules`、`oh_modules`、`build`、`resources`、`rawfile`、`archive_files`、`deprecated`、`legacy` 等非主线源码目录。这个修正来自 `harmonyos-libretro-emulator` 的复核：剩余 2 个 presence missing 均位于 `deprecated/legacy/`，该样本自身文档明确说明该路径是归档旧架构，不参与主线检索/构建，因此不应计入应用 benchmark。

## 全量结果

| 指标 | 数值 |
|---|---:|
| 样本数 | 1015 |
| 成功生成报告 | 1015 |
| 项目级失败 | 0 |
| 检出敏感 API 的项目 | 236 |
| Benchmark 中含敏感 API 的项目 | 218 |
| 分析文件数 | 31433 |
| 分析方法数 | 238271 |
| Privacy API usages | 1757 |
| Call chain entries | 1757 |
| Taint flows | 1792 |

源码标注结果：

| 标注层级 | 命中数/方法数 | ArkPrism 漏检 |
|---|---:|---:|
| Raw method-name hits | 57737 | 不作为真实 API 指标 |
| Presence source hits | 1379 hits / 745 methods | 0 |
| Qualified source hits | 1087 hits / 606 methods | 0 |

## 敏感 API 定位准确率

主指标采用 `namespace + method` 粒度，并以 presence benchmark 为 gold。该口径对应用户要求的“一个应用里面确实有这个 API 即可，不要求证明是否被调用”。结果如下：

| 粒度 | TP | FP* | FN | Micro Precision* | Micro Recall | Micro F1* | Macro Precision* | Macro Recall |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Namespace + method | 745 | 90 | 0 | 89.22% | 100.00% | 94.30% | 96.77% | 100.00% |
| Strict package signature | 483 | 371 | 142 | 56.56% | 77.28% | 65.31% | 87.10% | 95.68% |

这里的 FP* 不是断言工具误报，而是“相对源码 presence/qualified benchmark 的额外检测”。主要原因是源码 benchmark 按项目级 API 存在去重，而 ArkPrism 报告保留多处 usage、包别名、Kit 包和历史 `@ohos.*` 包的差异。论文主结论应使用 Namespace + method：在当前 hardened benchmark 下，敏感 API 定位召回率为 100%，项目级 exact match 为 953/1015。

Strict package signature 只作为别名敏感性诊断，不适合作为主指标；HarmonyOS 的 `@kit.*` 与 `@ohos.*` 迁移会让同一语义 API 在包签名层看起来不一致。

## Top-50 人工复核 Benchmark

为了回答 precision 是否真的只有 86%-89%，本轮额外抽取 ArkPrism 检出 API usage 数最高的前 50 个样本进行人工复核。该子集覆盖 1127/1757 个 API usages，占全量 usage 的 64.14%，因此比随机小样本更能暴露高结果项目中的误报风险。

复核流程：

1. 先用 hardened source presence benchmark 计算前 50 项目级 `namespace + method` 差异。
2. 对每个剩余 FP* 回到 ArkPrism report 和源码，要求存在 `.method`、`namespace.method`、manager/helper receiver 调用或字段读取证据。
3. 只要源码中确实存在 `sensitive_apis.json` 定义的敏感 API 输入，即标为人工 gold；不要求进一步证明运行时一定调用。

| 指标 | Hardened automatic presence | Manual-corrected top50 |
|---|---:|---:|
| Top-50 API usages | 1127 | 1127 |
| Top-50 call chains | 1127 | 1127 |
| Top-50 data sinks | 800 | 800 |
| Top-50 taint flows | 820 | 820 |
| Project-level predicted methods | 438 | 438 |
| Gold methods | 413 | 438 |
| TP | 413 | 438 |
| FP* | 25 | 0 |
| FN | 0 | 0 |
| Precision | 94.29% | 100.00% |
| Recall | 100.00% | 100.00% |

这 25 个剩余 FP* 均已人工确认为 benchmark gap，而不是工具误报。典型例子包括 `helper.createAsset(...)`、`calendarMgr.getCalendar(...)`、`netQuality.on/off(...)`、`cameraManager.createCameraInput(...)`、`systemPasteboard.getData(...)`、`sms.hasSmsCapability()` 等。它们在源码中是明确成员访问，但自动 benchmark 因 helper/manager receiver、callback overload、短 API 名或包别名没有完全覆盖。

因此，不能说“全量 precision 百分百已经被人工证明”，但可以更准确地表述为：

- 全量 hardened 自动 benchmark 下，ArkPrism 主定位 recall 为 100.00%，benchmark-relative precision 为 89.22%。
- 在检出量最高、最容易出现误报的前 50 个样本上，人工校正 benchmark 后主定位 precision/recall 均为 100.00%。
- 当前低于 100% 的全量 precision* 主要反映自动 benchmark 仍偏保守，而不是已确认的工具误报；剩余 90 个全量 FP* 需要继续人工复核后才能给出全量人工 precision。

## 调用链构建

| 指标 | 数值 |
|---|---:|
| Call chains | 1757 |
| Chains with path | 1757 |
| Chains without path | 0 |
| Call-chain coverage | 100.00% |
| Chains with sinks | 839 / 1757 (47.75%) |
| 平均链长 | 1.77 |
| 链长 P95 / Max | 4 / 9 |

入口类型分布：

| 类型 | 数量 |
|---|---:|
| component_lifecycle | 979 |
| initialization | 324 |
| unknown | 328 |
| app_lifecycle | 125 |
| user_interaction | 1 |

链分类分布：

| 类型 | 数量 |
|---|---:|
| framework-entry | 1105 |
| initialization | 324 |
| local-fallback | 280 |
| unknown-entry | 48 |

解释：100% chain coverage 表示每个检测到的 API usage 都至少能形成一个可解释链条。`local-fallback` 与 `unknown-entry` 并非伪造上游入口，而是在无法可靠恢复 UI/生命周期入口时保留“声明方法 -> 敏感 API”的局部链，避免把不可证明的上游路径写成确定事实。

## 污点分析与 sink

| 指标 | 数值 |
|---|---:|
| Taint flows | 1792 |
| Taint flows with path | 1792 |
| Taint path coverage | 100.00% |
| Taint flows / API usage | 1.02 |
| 污点路径长度 Median / P95 / Max | 3 / 7 / 16 |

污点路径长度分布：

| 长度桶 | 数量 |
|---|---:|
| 2-3 | 987 |
| 4-5 | 611 |
| 6-10 | 184 |
| >10 | 10 |

Sink 结果显示，47.75% 的敏感 API 链条能继续关联到至少一个 sink。该比例不应解释为剩余链条错误，而是说明许多 API usage 停留在 UI 展示、能力查询、初始化、状态监听或中间对象保存阶段，未必在当前静态可见路径中到达网络、存储、日志、intent/share 等 sink。

## API 与隐私类别分布

Top API packages:

| Package | Count |
|---|---:|
| `@kit.ArkUI` | 438 |
| `@kit.BasicServicesKit` | 376 |
| `@ohos.deviceInfo` | 175 |
| `@kit.NetworkKit` | 105 |
| `@kit.ConnectivityKit` | 93 |
| `@kit.LocationKit` | 87 |
| `@kit.SensorServiceKit` | 67 |
| `@kit.UserAuthenticationKit` | 43 |
| `@kit.CameraKit` | 38 |
| `@ohos.file.photoAccessHelper` | 36 |

Top privacy categories:

| Category | Count |
|---|---:|
| `device_identity.screen` | 438 |
| `device_identity.hardware` | 357 |
| `network.connectivity` | 148 |
| `user_data.clipboard` | 115 |
| `location` | 102 |
| `network.bluetooth` | 85 |
| `device_status.sensor` | 76 |
| `network.wifi` | 69 |
| `device_identity.software` | 64 |
| `user_data.media` | 55 |

Top methods:

| Method | Count |
|---|---:|
| `display.Display.getDefaultDisplaySync` | 422 |
| `deviceType` | 283 |
| `getSystemPasteboard` | 74 |
| `getCurrentLocation` | 54 |
| `on` | 43 |
| `off` | 36 |
| `getAudioManager` | 33 |
| `getSupportedCameras` | 32 |
| `createAsset` | 30 |
| `getAssets` | 25 |

检测来源分布：

| Detector evidence | Count |
|---|---:|
| direct invoke stmt after assignment | 677 |
| indirect invoke | 453 |
| privacy constants | 422 |
| direct invoke stmt | 205 |

## 项目级长尾

Top projects by API usages:

| Project | APIs | Chains | Sinks | Taint flows |
|---|---:|---:|---:|---:|
| CommonAppDevelopment | 128 | 128 | 57 | 205 |
| Wechat_HarmonyOS | 65 | 65 | 75 | 43 |
| legado-Harmony-main | 61 | 61 | 81 | 53 |
| Snake_NEXT-main | 50 | 50 | 42 | 63 |
| harmony-next-music-sharing | 48 | 48 | 25 | 28 |
| STUFFS_NEXT-master | 45 | 45 | 64 | 44 |
| applications_settings | 43 | 43 | 7 | 44 |
| harmonyos4me_ResponsiveLayout | 41 | 41 | 52 | 5 |
| harmonyos4me_ZUtils | 33 | 33 | 26 | 29 |
| harmonyos4me_MultiVideoApplication | 32 | 32 | 15 | 3 |

Top projects by taint flows:

| Project | APIs | Sinks | Taint flows |
|---|---:|---:|---:|
| CommonAppDevelopment | 128 | 57 | 205 |
| Snake_NEXT-main | 50 | 42 | 63 |
| legado-Harmony-main | 61 | 81 | 53 |
| applications_settings | 43 | 7 | 44 |
| STUFFS_NEXT-master | 45 | 64 | 44 |
| VideoTrimmer | 2 | 0 | 43 |
| Wechat_HarmonyOS | 65 | 75 | 43 |
| Photos | 22 | 5 | 41 |
| aloeplayer_ohos | 10 | 2 | 29 |
| harmonyos4me_ZUtils | 33 | 26 | 29 |

## 运行效率与稳定性

| 指标 | 数值 |
|---|---:|
| 项目级错误 | 0 |
| 超时样本 | 0 |
| IFDS budget exceeded | 0 |
| IFDS 主求解异常样本 | 2 |
| PTA fallback 样本 | 11 |
| 单样本耗时 mean / median | 30.7s / 30.7s |
| 单样本耗时 P95 / max | 39.0s / 270.8s |
| 累计样本耗时 | 30141.7s |
| 并发 2 worker 估计墙钟 | 15070.9s |

IFDS 主求解异常样本：`Aigis`、`harmonyos-libretro-emulator`。两者没有导致项目级失败；callback/return/privacy-constant 扩展仍产出报告与 taint flow。PTA fallback 样本包括 `aloeplayer_ohos`、`applications_launcher`、`CanvasDraw`、`HarmonyStock`、`HarmonyStudy`、`MoodDiary-HarmonyOS`、`OfficeAttendance`、`OfficeAttendance-master`、`readmigo_harmony-app`、`Renameow`、`SocialDating`。这些应作为 threat to validity 报告：对应样本的 IFDS 或指针分析精度可能低于完整 PTA + IFDS 成功样本。

Top slow projects:

| Project | Time(s) | APIs | Chains | Sinks |
|---|---:|---:|---:|---:|
| aloeplayer_ohos | 270.8 | 10 | 10 | 2 |
| AlarmClock | 106.0 | 0 | 0 | 0 |
| legado-Harmony-main | 89.7 | 61 | 61 | 81 |
| CommonAppDevelopment | 88.8 | 128 | 128 | 57 |
| AICharacterRecognition | 82.6 | 2 | 2 | 2 |

## 结论

1. 在 corrected presence benchmark 下，ArkPrism 对 1015 个 ARGUS 样本的敏感 API 定位达到 100.00% recall，且 qualified 强证据口径也为 0 漏检。
2. 调用链覆盖率为 100.00%，所有 1757 个 API usage 均生成链条；其中 839 条链进一步关联到数据 sink。
3. 污点分析产出 1792 条 flow，全部带 path；但 2 个样本出现 IFDS 主求解异常，11 个样本 PTA fallback，应在论文中作为稳定性限制而非隐藏。
4. Benchmark 修正没有强行把指标调成 100%；它排除了样本自身明确标为归档旧架构的 `deprecated/legacy` 目录，避免把非主线代码计入应用真实 API。
5. 后续若要进一步提高严格 package-signature 指标，应继续做 HarmonyOS `@kit.*` / `@ohos.*` 迁移别名归一，而不是把主指标改成包签名级别。
