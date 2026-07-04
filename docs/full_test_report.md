# ArkPrism 全量测试报告

## 测试范围

- 测试日期: 2026-07-02
- SDK: `E:\OpenHarmony_SDK\20\ets`
- 最新样本集: `E:\Projects\ARGUS\release_20260617\ARGUS-successful-1015-samples-20260617`
- 样本数量: 1015
- 输出目录: `out_argus_1015_final_20260703`
- 聚合结果: `out_argus_1015_final_20260703/aggregate_summary.json`
- 源码标注结果: `docs/generated_argus1015_source_annotations_validated/source_sensitive_api_annotations.md`
- 调用链 gap 明细: `docs/generated_argus1015_final/callchain_gap_analysis.json`
- 论文式实验分析: `docs/generated_argus1015_validated_analysis/paper_experiment_analysis.md`

本轮运行坚持使用本机 OpenHarmony SDK，不使用 SDK fallback。旧的非最新 `out_*` 结果目录已清理，当前工作区只保留 `out_argus_1015_final_20260703`。

## 本轮修复摘要

1. 放宽扫描上限并保持 IFDS 默认单次全源求解，避免因为分批或过紧预算漏扫方法。
2. 将 `system_packages14.json` 与 `sensitive_apis.json` 中声明的包合并作为 import 识别集合，修复 `@kit.PushKit`、`@kit.IAPKit`、`@kit.NetworkBoostKit` 等新 kit 包被过滤的问题。
3. 补齐 `@ohos.*` 与 `@kit.*` 包别名、namespace 别名和默认导入别名，例如 `geoLocationManager/geolocation`、`deviceInfo/deviceinfo`、`@ohos.wifiManager` 默认导入为 `wf`。
4. 增加 `request.agent.create` 这类多段 API 的 IR 临时变量别名追踪，覆盖 `request.agent -> %tmp -> %tmp.create(...)`。
5. 修复无 `build-profile.json5` 样本的 Scene 构建路径，标准工程发现 0 files 时改用源码文件列表生成 ArkFile。
6. 增加 ArkAnalyzer 空节点/非法泛型防护，避免少数样本构图或类型推断崩溃。
7. 修复调用链 no-path：当无法找到 UI/生命周期入口时，保留精确的“声明方法 -> 敏感 API”本地链，不伪造上游入口。
8. 默认开启 callback/Promise taint 扩展，避免 IFDS 主过程无法覆盖 callback 边界时 taint 结果退化为 0。

## 1015 样本聚合结果

- 样本数: 1015
- 成功生成报告: 1015
- 缺失报告: 0
- 读取失败报告: 0
- 检出敏感 API 的项目: 202
- Privacy API usages: 1295
- Call chain entries: 1295
- Call chains with path: 1295
- Call chains without path: 0
- Data sinks: 1187
- Taint flows: 1788
- Local fallback chains: 197
- Initialization chains: 198

## 源码标注复核

为了更接近人工看源码，本轮继续使用 `scripts/annotate_sensitive_api_source.js` 从 `config/sensitive_apis.json` 读取规则，同时生成两种证据：

- `raw`: 去除注释后，只按配置中的方法名字符串搜索。
- `presence`: 去除注释后，要求同一源码文件存在相关 Harmony package import，并出现配置中的敏感 API 方法/属性 token；该口径表示“应用源码包含这个 API”，不要求证明已经形成调用。
- `qualified`: 去除注释后，要求源码存在对应 package/import，并出现 `namespace.method`、`namespace.property` 或多段成员访问；对历史包名和新 kit 包名做 namespace 归一。

1015 个样本的源码 benchmark 标注结果：

- Raw method-name hits: 57754
- Presence source hits: 1355
- Presence source methods: 726
- Presence source hits missing in ArkPrism report: 228
- Qualified source hits: 1081
- Qualified source methods: 600
- Qualified source hits missing in ArkPrism report: 0
- Validation duplicate presence hits: 0
- Validation duplicate qualified hits: 0
- Validation declaration-like presence evidence: 0
- Validation presence evidence without member access: 0

对应 ArkPrism 工具输出：

- Privacy API usages: 1295
- Call chain entries: 1295
- Call chains with path: 1295
- Call chains without path: 0
- Taint flows: 1788
- Data sinks: 1187

结论：按“应用源码包含该 API”的 presence benchmark 口径，ArkPrism 仍存在未覆盖项；按更强的 `namespace.method`/字段读取 qualified 口径，当前未发现漏掉的已成形调用/字段读取证据。后续论文主指标应使用 presence 口径报告真实 recall，同时把 qualified 结果作为强证据子集分析。裸方法名只作为辅助搜索证据，不作为真实 API 判定标准。

## 论文式实验分析

本节把 1015 个样本的最终输出按论文实验口径重新组织。完整机器可复核结果见 `docs/generated_argus1015_validated_analysis/paper_experiment_analysis.json`，摘要表见 `docs/generated_argus1015_validated_analysis/paper_experiment_analysis.md`。

### 实验对象与规模

实验对象为 ARGUS 2026-06-17 成功样本集中的 1015 个 OpenHarmony/ArkTS 项目。ArkPrism 对所有样本均完成解析、敏感 API 定位、调用链构建和 taint-flow 生成，没有缺失报告或 JSON 读取失败。

| 指标 | 数值 |
|---|---:|
| 项目数 | 1015 |
| 成功报告数 | 1015 |
| 分析源码文件数 | 31433 |
| 分析方法数 | 238271 |
| 检出敏感 API 的项目数 | 202 |
| presence benchmark 中含敏感 API 的项目数 | 222 |
| source-qualified benchmark 中含敏感 API 的项目数 | 178 |
| Privacy API usages | 1295 |
| Call chain entries | 1295 |
| Taint flows | 1788 |

从项目分布看，敏感 API 并不是均匀分布在所有样本中：ArkPrism 在 202/1015 个项目中检出敏感 API，占 19.90%；presence benchmark 在 222/1015 个项目中发现源码包含敏感 API，占 21.87%；qualified benchmark 在 178/1015 个项目中发现可证调用/字段读取，占 17.54%。这说明该样本集同时包含大量普通 UI、媒体、动画、基础能力示例，不能只用总样本数解释检测规模，需要同时报告“含敏感 API 项目数”和“全量项目数”。

### Benchmark 构造与评价口径

本实验使用两层源码证据：

1. `raw` 字符串证据：只搜索 `sensitive_apis.json` 中的方法名。该指标用于衡量噪声规模，不作为真实敏感 API ground truth。
2. `presence` 源码证据：要求同一源码文件存在相关 Harmony package import，并出现配置中的敏感 API 方法/属性 token。该指标表示“应用源码里确实包含这个 API”，不要求证明调用发生，是本轮 API 定位准确率/召回率的主 benchmark。
3. `qualified` 源码证据：要求源码存在对应 package/import，并出现 `namespace.method`、`namespace.property` 或多段成员访问，同时对 `@ohos.*` 与 `@kit.*` 历史/新包名做 namespace 归一。该指标是更强的调用/字段读取证据子集。

1015 个样本中，raw method-name hits 为 57754，validated presence source hits 为 1355，raw-to-presence 比例为 2.35%；validated qualified source hits 为 1081，raw-to-qualified 比例为 1.87%。这说明裸字符串搜索中绝大部分命中来自普通业务方法、集合操作、事件注册、日志封装或注释/文本上下文；例如 `get`、`on`、`off`、`start`、`stop`、`request` 这类泛化方法名不能作为真实敏感 API 判据。

注意：本报告废弃了一个更宽松的 presence 草稿口径。该草稿只要求同文件 import + 任意方法 token，容易把日志字符串、wrapper 函数名或同文件普通方法名计入 API 证据。当前 validated presence 口径已收紧为：排除字符串字面量，要求出现成员访问证据；typed receiver 必须匹配具体 SDK 类名；同一源码位置的短名/类限定名规则只计一次。自动校验显示 duplicate presence hits、declaration-like evidence、无成员访问 evidence 均为 0。

### 指标定义

敏感 API 定位使用 presence benchmark 的 `normalized(namespace) + normalized(method)` 作为主比较键。对每个项目定义：

- TP：presence benchmark 中存在，且 ArkPrism 报告中也存在的敏感 API 键。
- FN：presence benchmark 中存在，但 ArkPrism 报告中不存在的敏感 API 键。
- FP*：ArkPrism 报告中存在，但源码 presence benchmark 未能复核到的敏感 API 键。
- Recall = TP / (TP + FN)。
- Precision* = TP / (TP + FP*)。
- F1* = 2 * Precision* * Recall / (Precision* + Recall)。

这里的 presence benchmark 不要求证明 API 被调用，因此它更适合衡量“应用是否包含该敏感 API”的定位召回。`FP*` 表示 ArkPrism 报告了 presence benchmark 未复核到的 API 键，仍建议表述为“相对 benchmark 的额外项/待复核项”，不要直接等同于人工确认误报。

### 敏感 API 定位准确率与召回率

| 层级 | TP | FP* | FN | Micro Precision* | Micro Recall | Micro F1* | Macro Precision* | Macro Recall |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Namespace + method 主指标 | 636 | 104 | 90 | 85.95% | 87.60% | 86.77% | 92.86% | 94.75% |
| Strict package signature 诊断项 | 479 | 280 | 140 | 63.11% | 77.38% | 69.52% | 91.55% | 95.57% |

主指标下，旧 ArkPrism 输出对 validated presence benchmark 的敏感 API 定位 recall 为 87.60%，precision* 为 85.95%，F1* 为 86.77%。validated presence benchmark 中共有 726 个项目内去重后的 namespace-method API 键，其中 636 个被旧 ArkPrism 报告覆盖，90 个未覆盖。项目级 exact match 为 886/1015，占 87.29%。这组结果使用的是修正后 benchmark 与旧 `out_argus_1015_final_20260703` 报告；本轮 detector 已修复这些 FN 所属的主要 API 家族，最终指标需要全量重跑后更新。

对 presence missing 的抽样复核显示，未覆盖项里确实存在源码成员访问证据，而不是全部来自文本误标。例如 `AVCodec/entry/src/main/ets/common/utils/CameraCheck.ets:46` 中存在 `cameraManager.getSupportedCameras()`，`AppAccountManager/entry/src/main/ets/model/AccountModel.ts:54` 中存在 `app.getAccountCredential(...)`，多个项目中存在 `display.getDefaultDisplaySync()`。这类 typed receiver 调用不一定满足 `namespace.method` 直接形态，因此 qualified 子集可能不计入，但按“项目里确实写了该 API”的 presence 口径应计入。

严格 package signature 只作为诊断项，不作为主指标。它要求 package、namespace、method 三者完全一致，因此会受到 `@ohos.*` 到 `@kit.*` 的历史包名迁移、规则合并、默认导入别名和兼容包映射影响。该指标 recall 较低并不代表 ArkPrism 漏检，而是说明论文实验中不应使用严格 package 字符串作为唯一 ground truth；对 OpenHarmony API 演进场景，更合理的是使用 namespace-method 归一口径。

### 检测类别分布

ArkPrism 的 1295 个 API usage 来自四类检测路径：

| 检测类别 | 数量 | 占比 |
|---|---:|---:|
| direct invoke stmt after assignment | 462 | 35.68% |
| privacy constants | 422 | 32.59% |
| indirect invoke | 210 | 16.22% |
| direct invoke stmt | 201 | 15.52% |

这说明仅匹配直接调用语句是不够的。`privacy constants` 占 32.59%，主要覆盖 `deviceInfo.deviceType`、`productModel`、`marketName` 等字段读取；`indirect invoke` 占 16.22%，覆盖 helper 对象、manager 对象和异步/回调场景中的间接调用。若只保留直接调用匹配，会显著降低召回。

### API 包、隐私类别与权限分布

Top API package 分布如下：

| API package | 数量 |
|---|---:|
| `@kit.BasicServicesKit` | 364 |
| `@ohos.deviceInfo` | 175 |
| `@kit.NetworkKit` | 105 |
| `@kit.ConnectivityKit` | 93 |
| `@kit.LocationKit` | 87 |
| `@kit.SensorServiceKit` | 67 |
| `@kit.UserAuthenticationKit` | 43 |
| `@kit.CameraKit` | 38 |
| `@ohos.file.photoAccessHelper` | 36 |
| `@ohos.distributedDeviceManager` | 30 |

Top privacy profiling category 分布如下：

| Profiling category | 数量 |
|---|---:|
| `device_identity.hardware` | 357 |
| `network.connectivity` | 148 |
| `user_data.clipboard` | 115 |
| `location` | 102 |
| `network.bluetooth` | 85 |
| `device_status.sensor` | 76 |
| `network.wifi` | 69 |
| `device_identity.software` | 64 |
| `user_data.media` | 55 |
| `media.camera` | 49 |

权限维度上，`permissionless_or_manifest_unknown` 为 643 次，是最大项。这类 API 包括不显式依赖运行时权限的设备信息、剪贴板对象获取、部分常量读取，以及报告中未能从 manifest 或规则映射出权限的调用。显式权限中，`ohos.permission.GET_NETWORK_INFO` 113 次、`ohos.permission.APPROXIMATELY_LOCATION` 69 次、`ohos.permission.GET_WIFI_INFO` 62 次、`ohos.permission.ACCESS_BLUETOOTH` 52 次、`ohos.permission.CAMERA` 49 次。

### 调用链构建覆盖率

调用链评价使用 API usage 级别覆盖率：

- Call-chain coverage = Call chains with path / Privacy API usages。
- No-path rate = Call chains without path / Privacy API usages。
- Local fallback ratio = Local fallback chains / Privacy API usages。

| 指标 | 数值 |
|---|---:|
| Privacy API usages | 1295 |
| Call chains with path | 1295 |
| Call chains without path | 0 |
| Call-chain coverage | 100.00% |
| No-path rate | 0.00% |
| Framework-entry chains | 1052 |
| Local fallback chains | 197 |
| Initialization chains | 198 |

调用链入口类型分布如下：

| Entry type | 数量 |
|---|---:|
| component_lifecycle | 808 |
| unknown | 243 |
| initialization | 198 |
| app_lifecycle | 45 |
| user_interaction | 1 |

链长分布如下：

| 链长区间 | 数量 |
|---|---:|
| 1 | 651 |
| 2-3 | 521 |
| 4-5 | 99 |
| 6-10 | 24 |

链长的 median 为 1，mean 为 1.88，max 为 9。这个分布符合样本集特征：大量示例项目直接在页面生命周期、构造/初始化、工具函数或测试入口中调用敏感 API；复杂项目中才会出现 4 层以上跨组件、callback 或封装调用链。

`local fallback chains` 为 197，占 API usage 的 15.21%。这类链不是失败链，而是在找不到可信 UI/生命周期上游入口时保留的“声明方法 -> 敏感 API”精确本地链。该设计避免为了形式上的入口完整性而伪造调用者，适合测试用例、库函数、SDK wrapper、模块级工具函数等场景。`initialization chains` 为 198，占 15.29%，覆盖 `%dflt`、`%statInit`、`%instInit`、constructor 等初始化路径。

### Sink 与污点流分析

1295 条调用链中，724 条包含至少一个 sink，占 55.91%。总 sink 数为 1187，sink 类型分布如下：

| Sink type | 数量 |
|---|---:|
| log | 916 |
| ui_display | 136 |
| storage | 93 |
| data_return | 33 |
| network | 9 |

Top sink API 如下：

| Sink API | 数量 |
|---|---:|
| `Logger.error` | 236 |
| `Logger.info` | 179 |
| `console.error` | 159 |
| `console.log` | 132 |
| `hilog.error` | 67 |
| `console.info` | 65 |
| `Text.create` | 61 |
| `hilog.info` | 58 |
| `pasteboard.SystemPasteboard.setData` | 45 |
| `Image.create` | 35 |
| `return` | 33 |
| `photoAccessHelper.PhotoAccessHelper.createAsset` | 30 |

污点分析共生成 1788 条 taint flows，所有 taint flows 均包含 path，taint path coverage 为 100.00%。平均每个 API usage 对应 1.38 条 taint flow。污点路径长度 median 为 3，mean 为 3.77，max 为 16；路径长度分布如下：

| Taint path length | 数量 |
|---|---:|
| 2-3 | 987 |
| 4-5 | 610 |
| 6-10 | 181 |
| >10 | 10 |

从 sink 类型看，当前样本集中日志输出是最主要的数据去向，占 916/1187。UI 展示和本地存储也有明显占比，而 network sink 只有 9 条。这说明 ARGUS-1015 更偏向 OpenHarmony 能力示例和本地功能展示，不是以真实恶意外传为主的数据集；论文中应把 taint-flow 结果解释为“隐私数据可达的数据使用/暴露点”，而不是直接等同于安全违规。

### 项目级分布与长尾现象

项目复杂度呈明显长尾分布：

| 分布 | Min | P25 | Median | P75 | P90 | P95 | Max | Mean |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Files/project | 1 | 9 | 13 | 25 | 67 | 119 | 1620 | 30.97 |
| Methods/project | 1 | 52 | 86 | 177 | 474 | 967 | 10757 | 234.75 |
| APIs/project | 0 | 0 | 0 | 0 | 3 | 6 | 57 | 1.28 |
| Chain length | 1 | 1 | 1 | 2 | 3 | 4 | 9 | 1.88 |
| Taint path length | 2 | 3 | 3 | 5 | 6 | 7 | 16 | 3.77 |

Top API usage 项目如下：

| Project | Files | Methods | APIs | Chains | Sinks | Taint flows |
|---|---:|---:|---:|---:|---:|---:|
| Wechat_HarmonyOS | 59 | 475 | 57 | 57 | 65 | 43 |
| CommonAppDevelopment | 1620 | 10757 | 54 | 54 | 44 | 205 |
| legado-Harmony-main | 360 | 3576 | 52 | 52 | 77 | 53 |
| Snake_NEXT-main | 45 | 441 | 50 | 50 | 40 | 63 |
| harmony-next-music-sharing | 87 | 1203 | 48 | 48 | 24 | 28 |
| STUFFS_NEXT-master | 29 | 366 | 45 | 45 | 63 | 44 |
| applications_settings | 163 | 2200 | 41 | 41 | 7 | 44 |
| harmonyos4me_ResponsiveLayout | 63 | 446 | 41 | 41 | 52 | 5 |
| harmonyos4me_ZUtils | 107 | 798 | 29 | 29 | 26 | 29 |
| harmonyos_samples_network-query | 14 | 127 | 26 | 26 | 28 | 16 |

Top taint-flow 项目如下：

| Project | APIs | Sinks | Taint flows |
|---|---:|---:|---:|
| CommonAppDevelopment | 54 | 44 | 205 |
| Snake_NEXT-main | 50 | 40 | 63 |
| legado-Harmony-main | 52 | 77 | 53 |
| applications_settings | 41 | 7 | 44 |
| STUFFS_NEXT-master | 45 | 63 | 44 |
| VideoTrimmer | 2 | 0 | 43 |
| Wechat_HarmonyOS | 57 | 65 | 43 |
| Photos | 22 | 5 | 41 |
| aloeplayer_ohos | 6 | 2 | 29 |
| harmonyos4me_ZUtils | 29 | 26 | 29 |

`CommonAppDevelopment` 是最大规模样本，包含 1620 个文件和 10757 个方法，同时也是 taint-flow 数最高的项目。`VideoTrimmer`、`MediaCollections`、`MediaFullScreen` 等项目出现“API 数少但 taint-flow 多”的情况，说明 taint-flow 数不只由敏感 API 数决定，还受 callback、日志/UI 使用、循环封装和数据传播路径影响。

### 高结果样本人工源码复核

为避免只依赖自动统计，本轮从 API usage、taint-flow 和 sink 数较高的项目中选取 6 个样本进行源码级人工复核。选择原则不是随机抽样，而是面向长尾高结果样本的 purposive sampling：覆盖最高 API usage、最高 taint-flow、最高 sink、多模块应用、系统设置类应用和工具库类项目。详细逐行证据见 `docs/generated_argus1015_final/manual_source_audit.md`。

| Project | ArkPrism APIs | Sinks | Taint flows | 人工源码标注摘要 | 判断 |
|---|---:|---:|---:|---|---|
| Wechat_HarmonyOS | 57 | 65 | 43 | `sensor.ets` 中存在 `sensor.on/off`；`camera.ets` 中存在 `cameraManager.getSupportedCameras()`；`Account.ets` 中存在 `getOsAccountLocalId(...)`；`OAID.ets` 中存在 `identifier.getOAID(...)`；`network_info.ets` 中存在 `connection.getDefaultNet()` 和 `getNetCapabilities(...)`。 | 高 API 数有源码证据支撑，主要来自能力示例页面。 |
| CommonAppDevelopment | 54 | 44 | 205 | `HelperView.ets` 中存在 `connection.hasDefaultNetSync()`；`ImageCompression.ets` 中存在 `PhotoAccessHelper.createAsset(...)`；`SavePictureFromWeb.ets` 中存在 `request.downloadFile(...)`；`RequestDownload.ets` 中存在 `request.agent.create(...)`。 | 高 taint-flow 数与项目规模、callback/UI/log 路径和多模块封装一致。 |
| legado-Harmony-main | 52 | 77 | 53 | `utils.ets` 和 `Clipboard.ets` 中存在 `pasteboard.getSystemPasteboard()`、`getUnifiedDataSync()`、`getData(...)`；`sensor.ets` 中存在 `sensor.on/off`；`Account.ets` 中存在 OS account 与 distributed account API。 | 高 sink/API 数有源码证据支撑，且与 demo 页面结构一致。 |
| Snake_NEXT-main | 50 | 40 | 63 | `camera.ets` 中存在 camera manager 调用；`network_info.ets` 中存在 network capability 调用；`OAID.ets` 中存在 `identifier.getOAID(...)`；`bluetooth.ets` 中存在 `enableBluetooth()` 和 `getState()`；`Clipboard.ets` 中存在 pasteboard 读取。 | 高结果不是裸字符串误报，但与其他 demo 项目存在模板相似性。 |
| applications_settings | 41 | 7 | 44 | `aboutDevice.ets` 中存在 `deviceInfo.productModel/manufacture/serial/displayVersion`；`LocationService.ts` 中存在 `geolocation.isLocationEnabled()`；`WifiModel.ts` 中存在 `wifi.scan()`；音量和蓝牙模块中存在 `getAudioManager()` 与 `getProfileInstance(...)`。 | 系统设置类项目中的敏感 API 调用真实存在，语义更接近实际系统功能。 |
| harmonyos4me_ZUtils | 29 | 26 | 29 | `IdentUtil.ets` 中存在 `deviceInfo.brand/osFullName/displayVersion/marketName`、`identifier.getOAID()`、`AAID.getAAID()` 以及大量 deviceInfo 字段日志；`CopyUtil.ets` 中存在 `pasteboard.getSystemPasteboard()` 和 `setData(...)`。 | 工具库集中封装设备标识与剪贴板 API，ArkPrism 结果与源码结构一致。 |

人工复核结论是：这些高结果样本中确实存在源码级敏感 API 证据，高 API/sink/taint 数不是单纯由方法名字符串匹配造成的。但复核也揭示了实验解释上的限制：`Wechat_HarmonyOS`、`Snake_NEXT-main`、`legado-Harmony-main` 等样本包含相似的能力示例页面，导致长尾项目之间并非完全独立；论文中应将这些结果解释为 ARGUS-1015 语料中的隐私 API 覆盖与数据流暴露情况，而不是直接外推为真实应用市场的平均隐私风险。

### 结果解释与论文表述建议

可以在论文中使用如下结论：

1. 在 ARGUS-1015 全量样本上，ArkPrism 成功完成 1015/1015 个项目分析，覆盖 31433 个源码文件和 238271 个方法。
2. 以 validated presence namespace-method benchmark 与旧报告对比，ArkPrism 的敏感 API 定位 recall 为 87.60%，precision* 为 85.95%，F1* 为 86.77%；以 qualified 强证据子集为准，qualified missing 为 0。当前 detector 已修复剩余 FN 的主要集中类别，最终指标需在 1015 全量重跑后更新。
3. ArkPrism 为 1295/1295 个 privacy API usages 构建了调用链，call-chain coverage 为 100.00%，no-path rate 为 0.00%。
4. ArkPrism 生成 1788 条 taint flows，taint path coverage 为 100.00%，平均每个 API usage 产生 1.38 条 taint flow。
5. 严格 package signature 指标只应用作包名迁移和规则别名的诊断项，不应作为 OpenHarmony API 定位的主指标；否则会把 `@ohos.*` 与 `@kit.*` 的兼容迁移误判为漏检。

### 有效性威胁

- Ground truth 威胁：presence benchmark 不是人工逐行标注，而是基于 import/package 与 API token 的静态源码标注。它符合“应用里确实存在该 API”的实验目标，但可能把未调用的示例代码、封装代码或条件编译代码计入 ground truth。
- Precision 威胁：FP* 是相对源码 benchmark 的额外检测项，不等价于人工确认误报。ArkPrism 的 IR 级检测可能比源码标注器覆盖更多调用形态，因此 precision 应表述为 benchmark-relative precision 或 conservative precision。
- 样本代表性威胁：ARGUS-1015 中大量项目是示例、demo、UI 或系统能力样例，日志和 UI sink 占比较高；该分布不能直接代表真实应用市场中隐私外传行为的比例。
- API 演进威胁：OpenHarmony API 存在 `@ohos.*` 到 `@kit.*` 的迁移和兼容别名，严格 package 字符串比较会低估召回。本文采用 namespace-method 归一是为了减少 API 演进带来的评价偏差。
- Taint ground truth 威胁：当前没有人工 taint-flow 标注，因此本报告给出 taint-flow 覆盖、路径长度、sink 分布和项目分布，不宣称 taint precision/recall 的人工真值百分比。

## 66 样本历史对照

在原 66 样本集上，源码标注与工具输出也已复核：

- Raw method-name hits: 3932
- Qualified source hits: 552
- Qualified source methods: 240
- Qualified source hits missing in ArkPrism report: 0
- ArkPrism Privacy API usages: 407
- Call chains with path: 406 / 407
- Taint flows: 397
- Data sinks: 450

## 调用链复核

敏感 API 定位在 qualified 强证据子集上未发现漏检，但在 presence benchmark 下仍有未覆盖 API 键；调用链构建针对 ArkPrism 已检出的 1295 个 API usage 完成全覆盖，所有 usage 都有 path。

- Call chains with path: 1295
- Call chains without path: 0
- Local fallback chains: 197
- Initialization chains: 198

说明：`local fallback chains` 是找不到 UI/生命周期入口时保留的精确本地链，形式为“声明方法 -> 敏感 API”。这类链不伪造上层调用者，适用于工具类、SDK 封装、测试入口、模块函数和库代码。`initialization chains` 覆盖 `%dflt`、`%statInit`、`%instInit` 等模块或类初始化路径。

`docs/generated_argus1015_final/callchain_gap_analysis.json` 中 `totalNoPath = 0`。

## 复现命令

```powershell
npm run build

node scripts\annotate_sensitive_api_source.js `
  --dataset E:\Projects\ARGUS\release_20260617\ARGUS-successful-1015-samples-20260617 `
  --reports out_argus_1015_final_20260703 `
  --output-dir docs\generated_argus1015_source_annotations_validated

node scripts\analyze_argus1015_experiment.js `
  --reports out_argus_1015_final_20260703 `
  --annotations docs\generated_argus1015_source_annotations_validated\source_sensitive_api_annotations.json `
  --aggregate out_argus_1015_final_20260703\aggregate_summary.json `
  --output-dir docs\generated_argus1015_validated_analysis
```

单项目运行示例：

```powershell
npx ts-node src\arkprism.ts <projectPath> `
  --output-dir out_argus_1015_final_20260703 `
  --sdkPath E:\OpenHarmony_SDK\20\ets `
  --ifds-max-edges 20000000 `
  --ifds-max-worklist 5000000 `
  --ifds-timeout-ms 900000
```
