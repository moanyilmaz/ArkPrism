# ArkPrism 工程化测试与实验分析报告

## 1. 报告范围

本报告汇总 ArkPrism 在真实 OpenHarmony SDK、HapBench 独立 oracle 和大规模 ArkTS 项目语料上的最终实验结果。报告遵循三个相互独立的证据口径：

1. **HapBench** 用于端到端污点流准确率、召回率和特异度评估。
2. **120 项目源码审计集** 用于评估已报告敏感 API 身份的 precision，不用于推断未报告调用的 recall。
3. **大规模项目语料** 用于分析检出规模、证据分布、调用链、sink、IFDS 路径、运行性能和稳健性，不把工具输出本身当作 ground truth。

这种分离非常重要。没有独立 oracle 时，API 数量、调用链数量和 taint-flow 数量只能描述工具产生的静态证据，不能直接转化成准确率或召回率。

## 2. 实验环境与可复现配置

| 项目 | 配置 |
|---|---|
| 操作系统 | Windows |
| Node.js | v20.18.0 |
| OpenHarmony SDK | `E:\OpenHarmony_SDK\20\ets` |
| SDK 文件数 | 13,721 |
| SDK 大小 | 311,592,147 bytes |
| SDK SHA-256 | `70a7319f9bf543ad1bf6c60a6a847d611a088d5003261d1feda33bca556334a6` |
| 候选项目目录 | `E:\Projects\ARGUS\release_20260617\ARGUS-successful-1015-samples-20260617` |
| 单项目堆上限 | 8 GB |
| 项目并发度 | 2 |
| IFDS 最大边数 | 30,000,000 |
| IFDS 最大 worklist | 8,000,000 |
| IFDS 超时 | 1,800,000 ms |
| callback 最大方法数 | 200,000 |
| callback 最大 source 数 | 20,000 |
| callback 最大状态数 | 50,000 |
| callback 最大路径长度 | 160 |

SDK fallback 被禁用。保留的 1,014 个项目日志均包含：

- `Loading SDK files from: E:\OpenHarmony_SDK\20\ets`
- `Pointer analysis complete.`
- `Taint analysis ... Status: SUCCESS`

没有保留任何 PTA 失败后继续执行、SDK fallback、IFDS 分批或 budget-exceeded 的结果。

## 3. 最终结果如何构成

完整项目分析不重复运行。最终结果由一次完整运行和两组定向回归组成：

| 层次 | 结果目录 | 作用 |
|---|---|---|
| 完整基础运行 | `experiments/argus1015_full_taint_20260724_v4` | 1,014 个成功项目的 frontend、调用图、IFDS、callback 和运行时间 |
| detector 定向回归 | `experiments/detector_factory_api_impact_20260724_v6_dedup` | 对 24 个受 package alias、factory/manager receiver 和 def-use 修复影响的项目更新 API、调用链和 sink |
| PTA/IFDS 定向回归 | `experiments/strict_pta_taint_replacement_20260724_v7` | 对旧日志中曾发生 PTA 降级的 10 个项目执行严格 PTA 和完整 IFDS 替换 |

合成规则由 `scripts/project_corpus_detector_overlay.js` 固化：

- detector overlay 替换同名项目的 API、调用链和 sink。
- taint overlay 替换同名项目的 IFDS 结果。
- 其余项目保留完整基础运行结果。
- API 调用点按 package、namespace、method、文件、声明方法和 IR 语句去重。
- package、namespace、method 和路径比较不区分大小写；IR 语句保留原文，以区分同一方法内的不同调用点。

完整性审计由 `scripts/audit_composite_run.js` 重算，而不是手工汇总。

### 3.1 项目纳入与排除

候选目录包含 1,015 个项目，最终大语料统计纳入 1,014 个完整成功项目。

`readmigo_harmony-app` 未纳入最终统计。修复原始 CFG/参数映射崩溃后，该项目的 PTA 已成功，但不分批 IFDS 在 30 分钟上限内仍为 `PARTIAL_SUCCESS`：处理 501,534 条边，产生 18 条临时 flow。由于其分析状态与其余项目不一致，不能把它的部分结果混入完整结果。项目名称、失败原因和部分报告保留在 artifact 中。

这属于预先定义的完整性条件排除，不应描述成 1,015/1,015 全部完成。

## 4. 代码修复与定向验证

### 4.1 IFDS 参数映射

原实现把调用实参映射到 callee CFG 首块语句，不能保证对应真正的 parameter instance，并可能在闭包参数偏移时访问非法位置。修复后：

- 直接读取 callee parameter instances。
- 只在闭包参数布局得到证实时应用偏移。
- 越界和未知布局显式返回不可映射，而不是构造错误 fact。

对应测试：`tests/verify_ifds_parameter_mapping.js`。

### 4.2 PTA 容器字段边

ArkAnalyzer PTA 在数组/容器字段节点缺失时会抛出异常。旧实现捕获异常后继续 IFDS，造成静默精度降级。修复后：

- 非法容器字段边被显式拒绝和计数。
- PTA 主过程继续处理其他合法边。
- PTA 真正失败时 ArkPrism 整体失败，不允许静默 fallback。
- 报告记录 `pointerAnalysis.status` 和 `rejectedContainerFieldEdges`。

10 个定向项目全部 `PTA=SUCCESS`，共拒绝 30 条不合法容器字段边，没有出现 PTA fallback。对应测试：`tests/verify_pta_container_edges.js`。

### 4.3 manager/factory receiver 恢复

源码和 IR 审计发现三类真实漏配：

- `audio.getAudioManager()` 返回对象上的 `getAudioScene()`。
- `createAVMetadataExtractor()` 返回对象上的 `fetchMetadata()`、`fetchAlbumCover()`。
- `createAVImageGenerator()` 返回对象上的 `fetchFrameByTime()` 等方法。
- `reminderAgentManager.publishReminder()` 在 `@kit.ReminderAgentKit` 和 `@kit.BackgroundTasksKit` 包族中的别名场景。

修复包含：

- `@ohos.multimedia.media` 与 `@kit.MediaKit` 双向包族归一化。
- reminder agent 包族和 namespace alias 归一化。
- `receiverFactories` 规则。
- 基于 receiver 声明、factory origin、类型和 target signature 的分层匹配。
- `Local.getDeclaringStmt()` 驱动的跨 CFG block def-use 恢复。
- `await` 和 IR alias 展开。

全语料源码搜索定位到 24 个可能受影响项目。定向回归结果：

| 指标 | 修复前 | 修复后 | 变化 |
|---|---:|---:|---:|
| 唯一 API 调用点 | 413 | 441 | +28 |
| 调用链 | 413 | 441 | +28 |
| sink 观察 | 388 | 431 | +43 |
| API-positive 项目 | 20 | 21 | +1 |
| sink-positive 项目 | 16 | 19 | +3 |

28 个新增调用点逐条检查了源码 import、factory/manager 定义和实际调用语句；全部存在于 `sensitive_apis.json` 定义范围内，没有删除原有调用点。13 个由 IFDS source 与 detector 不一致审计得到的强候选，在修复后全部获得 detector 证据。

### 4.4 API 结果去重

完整基础报告原始包含 2,099 条 API 记录，其中存在配置重叠产生的重复记录：

- 完全相同调用点重复 222 条。
- namespace 仅大小写不同的重复 9 条，例如同一 IR 调用同时记为 `userAuth` 和 `UserAuth`。
- 合计 231 条非独立调用点记录，分布在 84 个项目。

去重发生在 detector 输出边界，因此下游调用链和 sink 不再重复消费同一调用点。叠加 24 项修复后：

| 指标 | 数量 |
|---|---:|
| 合成前原始 detector 记录 | 2,107 |
| 移除重复记录 | 211 |
| 最终唯一 API 调用点 | 1,896 |
| 最终调用链 | 1,896 |

对应测试：`tests/verify_api_usage_dedup.js`。

## 5. 独立基准上的端到端准确性

### 5.1 HapBench 设置

HapBench 是 HapFlow 发布 artifact 中的完整 67-case suite：

- 正例 53 个。
- 负例 14 个。
- 覆盖 alias、匿名结构、数组、对象/字段、语言特性、生命周期和 OpenHarmony API。

预测单位为 case。工具至少报告一条 source-to-sink path 时记为 positive。

定义：

```text
Precision = TP / (TP + FP)
Recall = TP / (TP + FN)
Specificity = TN / (TN + FP)
F1 = 2PR / (P + R)
Balanced Accuracy = (Recall + Specificity) / 2
MCC = (TP*TN - FP*FN) /
      sqrt((TP+FP)(TP+FN)(TN+FP)(TN+FN))
```

### 5.2 主结果

| 工具 | TP | TN | FP | FN | Precision | Recall | Specificity | F1 | BAcc | MCC |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| HapFlow artifact | 51 | 10 | 4 | 2 | 92.73% | 96.23% | 71.43% | 94.44% | 83.83% | 0.717 |
| ArkPrism | 50 | 14 | 0 | 3 | 100.00% | 94.34% | 100.00% | 97.09% | 97.17% | 0.881 |

ArkPrism 的 95% Wilson 区间：

| 指标 | 估计值 | 95% CI |
|---|---:|---:|
| Precision | 100.00% | [92.9%, 100.0%] |
| Recall | 94.34% | [84.6%, 98.1%] |
| Specificity | 100.00% | [78.5%, 100.0%] |
| Accuracy | 95.52% | [87.6%, 98.5%] |

ArkPrism 比 HapFlow 多正确分类 6 个 case，HapFlow 比 ArkPrism 多正确分类 3 个 case。双侧 exact McNemar 检验 `p=0.508`，因此不能声称总体差异达到统计显著；可以声称本套件上的观察结果表现为更高 specificity、F1、balanced accuracy 和 MCC。

### 5.3 错误分析

ArkPrism 的 3 个 FN 全部位于生命周期类别：

- `ActivityLifecycle4`
- `BackupExtensionAbility`
- `Button1`

这些 case 分别要求父类 source-bearing lifecycle、跨实例 restore state 和跨事件静态状态传播。当前默认模型选择有界生命周期，以避免无约束事件环产生不可达路径。

HapFlow 的 4 个 FP 分布于：

- 数组索引合并。
- 两个 virtual dispatch 目标过近似。
- unrestricted lifecycle 导致 `UnreachableFlow` 可达。

HapFlow 的 2 个 FN 涉及匿名实例初始化和异常流恢复。

## 6. 机制消融

所有配置均完整运行 67/67 case。

| 配置 | TP | TN | FP | FN | Precision | Recall | F1 | MCC |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| ArkPrism full | 50 | 14 | 0 | 3 | 100.00% | 94.34% | 97.09% | 0.881 |
| 关闭 callback supplement | 50 | 14 | 0 | 3 | 100.00% | 94.34% | 97.09% | 0.881 |
| 关闭 IR recovery | 37 | 14 | 0 | 16 | 100.00% | 69.81% | 82.22% | 0.571 |
| 关闭 receiver refinement | 50 | 13 | 1 | 3 | 98.04% | 94.34% | 96.15% | 0.831 |
| unrestricted lifecycle | 52 | 13 | 1 | 1 | 98.11% | 98.11% | 98.11% | 0.910 |

主要结论：

- IR recovery 是贡献最大的机制。关闭后增加 13 个 FN，full 相对该消融的 McNemar `p=0.000244`。
- receiver refinement 消除 `VirtualDispatch3` FP，证明“解析更多 target”并不自动等于更准确。
- HapBench 上 callback supplement 没有改变 case、唯一端点或精确路径；这不能外推为真实项目不需要 callback 分析。
- unrestricted lifecycle 提高 nominal recall，但重新引入 `UnreachableFlow` FP，因此默认保留有界策略。

## 7. 120 项目源码审计集

该审计集包含 120 个高输出项目和 666 个去重的 `project + namespace + method/property` 键。每条记录保留：

- 项目和源码路径。
- source line、column、matched text 和上下文 snippet。
- package、namespace、method/property。
- 人工确认标签及证据类型。

人工复核排除注释、字符串字面量、普通同名业务方法和只有声明没有可执行访问的情况。666 个 project-API 键均具有可执行源码证据：

| 粒度 | 已确认 | 观察 precision | Wilson 95% 下界 |
|---|---:|---:|---:|
| project-API 键 | 666/666 | 100.00% | 99.43% |

必须限定该结论的范围：

- 样本从工具高输出项目中选择，适合发现 FP，但不能观察工具未报告的调用。
- 因此 recall 在该审计设计下是 **undefined**，不能写成 100%。
- 当前工具在该 benchmark 上的恢复覆盖和未审计新增项由 `evaluate_top120_benchmark.js` 单独计算。

## 8. 大规模语料总体结果

### 8.1 规模和项目阳性率

| 指标 | 数量 | 项目数 | 项目率 |
|---|---:|---:|---:|
| 完整项目 | 1,014 | 1,014 | 100.00% |
| ArkTS/TypeScript 分析文件 | 31,205 | - | - |
| 分析方法 | 233,894 | - | - |
| 唯一敏感 API 调用点 | 1,896 | 273 | 26.92% |
| 调用链 | 1,896 | 273 | 26.92% |
| sink 观察 | 1,542 | 185 | 18.24% |
| IFDS may-flow | 1,103 | 257 | 25.35% |

调用链为 1,896/1,896，表示每个最终 API 调用点均生成一条审计入口记录；这反映调用链构建完整性，不等于语义准确率。

IFDS flow 与敏感 API 调用链是两个相关但不等价的证据集合。IFDS 的 source 规则包含 lifecycle、callback、参数和其他 source，因此存在：

- 152 个 `API=0, Taint=1` 项目。
- 23 个 `API=1, Sink=0, Taint=1` 项目。
- 65 个 `API=1, Sink=0, Taint=0` 项目。

不能把 API、sink 和 IFDS 数量简单串成单向漏斗。

### 8.2 分布和长尾

| 每项目指标 | P25 | Median | P75 | P90 | P95 | P99 | Max |
|---|---:|---:|---:|---:|---:|---:|---:|
| 文件 | 9 | 13 | 25 | 67 | 119 | 260 | 1,620 |
| 方法 | 52 | 86 | 177 | 474 | 967 | 2,463 | 10,757 |
| API 调用点 | 0 | 0 | 1 | 5 | 10 | 28 | 97 |
| sink | 0 | 0 | 0 | 3 | 7 | 32 | 80 |
| taint flow | 0 | 0 | 1 | 1 | 4 | 22 | 99 |

API 分布高度长尾：

- Top-10 项目占 26.42%。
- Top-50 项目占 59.44%。
- Top-120 项目占 83.60%。
- API Gini = 0.886。
- API HHI = 0.0121，对应 effective projects = 82.88。
- sink Gini = 0.929。
- taint-flow Gini = 0.915。

这说明仅报告均值会掩盖结构：大部分项目没有 API 或 sink，少量大型/功能密集项目贡献主要证据量。

### 8.3 敏感数据类别

| 类别 | API 调用点 | 占全部 API |
|---|---:|---:|
| `device_identity.hardware` | 353 | 18.62% |
| `network.connectivity` | 273 | 14.40% |
| `device_identity.screen` | 222 | 11.71% |
| `user_data.account` | 180 | 9.49% |
| `user_data.clipboard` | 113 | 5.96% |
| `network.bluetooth` | 103 | 5.43% |
| `location` | 102 | 5.38% |
| `device_status.sensor` | 76 | 4.01% |
| `network.wifi` | 69 | 3.64% |
| `device_identity.software` | 63 | 3.32% |
| 其他类别 | 342 | 18.04% |

detector 结构：

| 模式 | 数量 | 占比 |
|---|---:|---:|
| assigned/direct-result invoke | 689 | 36.34% |
| manager/receiver indirect invoke | 583 | 30.75% |
| property/constant access | 417 | 21.99% |
| direct invoke statement | 207 | 10.92% |

583 条 indirect invoke 和 417 条 property access 合计占 52.74%。这解释了仅使用直接方法签名会遗漏大量 ArkTS 敏感 source 的原因。

### 8.4 sink 结构

| sink 类型 | 数量 | 占比 |
|---|---:|---:|
| log | 1,272 | 82.49% |
| UI display | 136 | 8.82% |
| storage | 93 | 6.03% |
| data return | 32 | 2.08% |
| network | 9 | 0.58% |

log sink 占绝对多数，因此 1,542 个 sink 不能直接解释成 1,542 个外传漏洞。更合适的解释是：

- log/UI 代表本地可观察性和潜在暴露面。
- storage 代表持久化风险。
- network 数量较少，但风险优先级通常更高。
- 同一 API 调用链可到达多个 sink，所以 sink 数可大于 API 数。

### 8.5 路径可审计性

| 指标 | Median | P95 | P99 | Max |
|---|---:|---:|---:|---:|
| 调用链边数 | 1 | 4 | 6 | 9 |
| taint path statement 数 | 5 | 9 | 22 | 33 |

其他可审计性指标：

- async 调用链：323。
- local-fallback 调用链：0。
- 带 permission 的 API 调用点：830。
- source、sink 和 path-step 路径端点：7,875。
- 已解析端点：7,875/7,875，100.00%。

### 8.6 项目规模与结果关系

Spearman 相关系数：

| 变量 | rho |
|---|---:|
| 文件数 vs 方法数 | 0.9226 |
| 方法数 vs 运行时间 | 0.3932 |
| 文件数 vs 运行时间 | 0.4137 |
| 方法数 vs API 数 | 0.4613 |
| API 数 vs sink 数 | 0.8230 |
| API 数 vs taint-flow 数 | 0.2266 |
| sink 数 vs taint-flow 数 | 0.2451 |

结论：

- 文件数与方法数高度相关，说明两个规模指标一致。
- 运行时间只与规模中等相关；固定 SDK/frontend 启动成本和项目结构同样重要。
- API 与 sink 高度相关，因为 sink 沿 API 调用链收集。
- API 与 IFDS flow 仅弱相关，再次说明两类 source 口径不同。

按方法数五分位：

| 分位 | 项目数 | 方法中位数 | 运行时间中位数 | API-positive | Sink-positive | Taint-positive |
|---|---:|---:|---:|---:|---:|---:|
| Q1 | 203 | 34 | 16.0 s | 9.85% | 3.45% | 7.39% |
| Q2 | 203 | 57 | 16.1 s | 14.78% | 6.90% | 25.62% |
| Q3 | 203 | 86 | 16.3 s | 17.24% | 9.85% | 28.08% |
| Q4 | 203 | 145 | 16.3 s | 24.63% | 20.69% | 29.06% |
| Q5 | 202 | 474 | 18.4 s | 68.32% | 50.50% | 36.63% |

## 9. 运行性能和求解完整性

### 9.1 运行时间

| 指标 | 时间 |
|---|---:|
| P25 | 15.6 s |
| Median | 16.4 s |
| P75 | 17.6 s |
| P90 | 19.4 s |
| P95 | 21.2 s |
| P99 | 28.2 s |
| Max | 351.3 s |
| 隔离进程时长求和 | 18,020.7 s |

最大值来自 `CommonAppDevelopment`，包含 1,620 个分析文件和 10,757 个方法。第二个高耗时项目为 `legado-Harmony-main`。P95 仅 21.2 秒，说明极端大型项目导致的尾部开销没有代表典型项目。

### 9.2 IFDS 健康度

| 指标 | 数量 |
|---|---:|
| `SUCCESS` 项目 | 1,014/1,014 |
| SDK 路径验证通过 | 1,014/1,014 |
| PTA complete 日志 | 1,014/1,014 |
| PTA failure/fallback | 0 |
| IFDS budget exceeded | 0 |
| IFDS batching | 0 |
| callback enabled | 1,014/1,014 |

IFDS 边数分布：

| P25 | Median | P75 | P95 | P99 | Max |
|---:|---:|---:|---:|---:|---:|
| 382 | 837 | 2,345 | 13,857 | 66,678 | 778,986 |

CFG 中存在无法构造语义边的 malformed edge：

- 420/1,014 个项目至少出现 1 条。
- 总体中位数为 0，P95 为 22，最大值为 404。
- 这些边被记录并跳过，没有触发 batch 或 budget 降级。

flow 去重：

| 指标 | 数量 |
|---|---:|
| 去重前 flow | 1,549 |
| 唯一 flow | 1,103 |
| 移除重复 flow | 446 |
| 发生 flow 去重的项目 | 42 |

flow identity 由 source、sink 和传播路径共同确定，避免 callback/IFDS 多入口产生的同路径重复。

## 10. clone 稳健性

源代码 token fingerprint 分析在 1,015 个候选源码目录中识别：

- 32,233 个 `.ets/.ts` 源文件。
- 21,663 个唯一 token fingerprint。
- 10,570 个重复文件 occurrence。
- 9 个 exact project-clone cluster。
- 11 个 near-clone cluster。

在 1,014 个完整分析项目上重新计算阳性率：

| 采样口径 | N | API-positive | Sink-positive | Taint-positive |
|---|---:|---:|---:|---:|
| 全部完整项目 | 1,014 | 26.923% | 18.245% | 25.345% |
| 每个 exact-clone cluster 保留 1 个 | 995 | 27.236% | 18.392% | 25.628% |
| 每个 near-clone cluster 保留 1 个 | 993 | 27.090% | 18.328% | 25.680% |

最大绝对变化为 0.335 个百分点。结果不由少量完全复制的 demo 项目主导，但共享 framework/示例代码仍会影响具体 API 类别频率。

## 11. 结论与可接受声明

可以由现有证据支持的结论：

1. ArkPrism 在完整 HapBench 上达到 100.00% precision、94.34% recall 和 97.09% F1，且 14 个负例全部正确。
2. 相比 HapFlow artifact，ArkPrism 的主要观察优势是 specificity 和整体类别平衡；总体 paired 差异没有统计显著。
3. 120 项目高输出源码审计中，已审计的 666 个 project-API 键全部具有真实源码证据，但该设计不能估计 recall。
4. 最终 1,014 项目结果包含 1,896 个唯一敏感 API 调用点、1,542 个 sink 和 1,103 条 IFDS may-flow。
5. 1,014 个保留项目均使用真实 API-20 SDK、成功 PTA、单次不分批 IFDS，且没有 budget exceeded。
6. manager/factory 修复新增 28 个经源码逐条确认的真实调用点，没有删除原调用点。

不能由现有证据支持的表述：

- “1,014 个真实项目上的敏感 API recall 为 100%。”
- “1,542 个 sink 或 1,103 条 flow 都是确认漏洞。”
- “HapBench 上 ArkPrism 显著优于 HapFlow。”
- “120 项目输出选择审计证明了未报告项目不存在漏检。”
- “1,015 个项目全部完整成功。”

## 12. 结果文件

| 文件 | 内容 |
|---|---|
| `docs/experiment_argus1014_full_20260724_v4_final/large_corpus_summary.json` | 最终逐项目和总体描述统计 |
| `docs/experiment_argus1014_full_20260724_v4_final/large_corpus_summary.md` | 自动生成的大语料摘要 |
| `docs/experiment_argus1014_full_20260724_v4_final/audited_corpus_projection.json` | detector/taint overlay 与去重合成清单 |
| `docs/experiment_argus1014_full_20260724_v4_final/composite_run_integrity.json` | SDK、PTA、IFDS、budget、batching 完整性审计 |
| `docs/experiment_argus1014_full_20260724_v4_final/redundancy_sensitivity.json` | clone-aware 阳性率敏感性分析 |
| `docs/experiment_argus1014_full_20260724_v4_final/factory_api_targeted_diff_final.json` | 24 项 detector 修复差异 |
| `docs/experiment_argus1014_full_20260724_v4_final/strong_candidate_resolution.json` | 13 个强候选的修复覆盖 |
| `docs/experiment_hapbench_20260724_v8_final/hapbench_results.json` | HapBench case-level 结果和统计 |
| `docs/experiment_hapbench_20260724_v8_final/hapbench_results.md` | HapBench 表格、消融和错误列表 |
