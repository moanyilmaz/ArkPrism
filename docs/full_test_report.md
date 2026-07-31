# ArkPrism 工程测试与实验分析报告

## 1. 报告目的

本报告汇总 ArkPrism 最终交付版本的工程验证与实验结果。所有结论按证据来源分开：

1. **源码优先的 API 身份 benchmark**评估敏感 API 定位的准确率与召回率；
2. **HapBench**评估端到端 source-to-sink 分类，并与 HapFlow 发布 artifact 对比；
3. **ArkAsyncBench 与 ArkPromiseBench**验证异步 carrier、Promise 执行边和载荷传播语义；
4. **120 条真实项目路径的源码/IR 审核**评估路径级语义质量；
5. **1,014 项目大规模语料**分析检出规模、结构、性能、稳定性和重复样本敏感性。

大规模语料没有穷举 oracle，因此其 API、sink 和路径数量用于描述工具输出，不能直接转换为总体准确率或召回率。准确率结论来自独立 benchmark 和人工审核。

## 2. 最终版本与实验契约

### 2.1 分析版本

| 项目 | 最终值 |
|---|---|
| ArkPrism commit | `573dbcb82e6cfb071a5cde2c7552e190156c37f6` |
| OpenHarmony SDK | API-20 |
| SDK SHA-256 | `70a7319f9bf543ad1bf6c60a6a847d611a088d5003261d1feda33bca556334a6` |
| 敏感 API 配置 SHA-256 | `66484695bf88e16d4746ed8be945446de979b3a595add930f284634e8fdb68dc` |
| package alias 配置 SHA-256 | `866f8afdb27c47c125d41a6e6b996f67e9ff687adcacebb379b6e640833de339` |
| sink 配置 SHA-256 | `944a7824994739faf3b02f5adc3a7404dc9cf1637c6b816f6b612d3074fbc9a9` |
| 最终 run manifest SHA-256 | `5b6b2b5ddd2cd47d4e49e7f7268057f0f42f7ae7f9d3b08727dd5bbad405ea19` |

最终大规模结果来自一个 analyzer build、一个 SDK、一个规则集合和一次完整运行，不使用旧结果 overlay，也不把失败或资源受限分析解释为零结果。

### 2.2 资源策略

| 参数 | 配置 |
|---|---:|
| 项目并发度 | 2 |
| Node.js heap 上限 | 8 GB/进程 |
| 单项目外层超时 | 3,600 s |
| IFDS 超时 | 1,800 s |
| IFDS 最大边数 | 30,000,000 |
| IFDS 最大 worklist | 8,000,000 |
| callback 最大方法数 | 200,000 |
| callback 最大 source 数 | 20,000 |
| callback 最大状态数 | 50,000 |
| callback 最大路径长度 | 160 |

IFDS 默认联合分析项目中的全部 source，不分批执行。批处理只保留为显式资源降级机制；最终 1,014 项目运行没有触发该机制。

## 3. 总体结果

| 证据层 | 样本 | 核心结果 |
|---|---:|---|
| ArkSourceFirst60 | 186 个源码候选 | 90 TP、96 TN、0 FP、0 FN |
| ArkIdentityBench | 64 cases | 32 TP、32 TN、0 FP、0 FN |
| Top-120 stress audit | 666 个确认 API key | 666/666 reproduction coverage |
| HapBench | 67 cases | 50 TP、14 TN、0 FP、3 FN；F1 97.09% |
| ArkAsyncBench | 48 cases | 24 TP、24 TN、0 FP、0 FN |
| ArkPromiseBench | 24 mutants | 7 TP、17 TN、0 FP、0 FN |
| 真实项目路径审核 | 120 paths | 隐私数据路径 90/90；全部路径 115/120 |
| 大规模语料 | 1,014 projects | 2,339 API occurrences；258 privacy-data paths；0 errors |

## 4. 敏感 API 身份定位

### 4.1 ArkSourceFirst60

该 benchmark 在查看 ArkPrism 输出前固定项目，并从源码中枚举与冻结规则和 import universe 兼容的静态候选。标注在精确位置级完成，不把同一文件中的一次正确检出替代其他 occurrence。

| 指标 | 数值 |
|---|---:|
| 源码候选 | 186 |
| 敏感 API occurrence | 90 |
| 同名或 owner 不兼容负例 | 96 |
| TP / TN / FP / FN | 90 / 96 / 0 / 0 |
| Precision | 100.00% |
| Recall | 100.00% |
| Specificity | 100.00% |
| F1 | 100.00% |

90 个正例包含：

- 44 个 executable property；
- 26 个 namespace call；
- 11 个 typed receiver；
- 4 个 constructed receiver；
- 3 个 manager receiver；
- 2 个 factory receiver。

其中 20/90 必须使用 receiver 或 factory 证据，不能仅靠调用行上的 namespace 语法恢复。96 个负例覆盖应用 wrapper、UI controller、集合、测试驱动和第三方库中的 `create`、`on`、`request`、`getData` 等同名方法。

### 4.2 ArkIdentityBench 机制进展

| 配置 | TP | TN | FP | FN | Precision | Recall | Specificity | F1 | MCC |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Lexical token | 32 | 0 | 32 | 0 | 50.00% | 100.00% | 0.00% | 66.67% | 0.000 |
| Import-aware namespace | 17 | 32 | 0 | 15 | 100.00% | 53.13% | 100.00% | 69.39% | 0.601 |
| Declared receiver | 26 | 32 | 0 | 6 | 100.00% | 81.25% | 100.00% | 89.66% | 0.827 |
| Factory-aware receiver | 28 | 32 | 0 | 4 | 100.00% | 87.50% | 100.00% | 93.33% | 0.882 |
| ArkPrism full | 32 | 32 | 0 | 0 | 100.00% | 100.00% | 100.00% | 100.00% | 1.000 |

结果表明：

- 词法匹配具备召回能力，但无法排除同名 collision；
- import ownership 可以消除 collision，但不能覆盖 manager、factory、property 和 IR alias；
- receiver/factory evidence 逐步恢复间接 API；
- 完整 resolver 通过 package migration、receiver origin/type、property read、compound namespace 与 IR alias 补齐剩余正例。

### 4.3 Top-120 高输出压力审核

Top-120 审核包含 1,533 条源码位置记录，规范化为 666 个经源码确认的 project–API key：

| 证据形态 | 确认 key |
|---|---:|
| Namespace-qualified | 558 |
| Member/receiver | 102 |
| Template expression | 5 |
| Compound-qualified | 1 |
| 总计 | 666 |

最终 detector 恢复 666/666 个确认 key。该指标是**确认 key reproduction coverage**，用于验证高输出项目中的稳定性；由于该集合源自早期输出排序，不将未审核的新 key 计为 FP，也不用于推断真实项目总体 recall。

## 5. HapBench 端到端对比

### 5.1 Case-level 结果

HapBench 包含 HapFlow artifact 发布的全部 67 个可执行案例，其中 53 个正例、14 个负例。

| 工具 | TP | TN | FP | FN | Precision | Recall | Specificity | F1 | Accuracy | Balanced Accuracy | MCC |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| HapFlow | 51 | 10 | 4 | 2 | 92.73% | 96.23% | 71.43% | 94.44% | 91.04% | 83.83% | 0.717 |
| ArkPrism | 50 | 14 | 0 | 3 | 100.00% | 94.34% | 100.00% | 97.09% | 95.52% | 97.17% | 0.881 |
| ArkPrism 相对变化 | -1 | +4 | -4 | +1 | +7.27 pp | -1.89 pp | +28.57 pp | +2.65 pp | +4.48 pp | +13.34 pp | +0.164 |

ArkPrism 的优势集中在负例判别：

- 14/14 个负例全部拒绝；
- 消除 HapFlow 的 array-index collapse、不可行 virtual target 和 unrestricted lifecycle FP；
- 在六个类别达到 100.00% F1，lifecycle 类别 F1 为 85.71%。

九个不一致案例中，ArkPrism 独占正确 6 个，HapFlow 独占正确 3 个。配对 McNemar `p=0.508`，因此本文把结论限定为该 suite 上观察到的 specificity、F1、balanced accuracy 和 MCC 优势，不外推为所有任务上的显著总体优越性。

### 5.2 Endpoint-pair 结果

ArkPrism 报告的 52 条原始路径规范化为 51 个 source–sink pair：

| 指标 | 数值 |
|---|---:|
| TP / FP / FN | 50 / 1 / 3 |
| Precision | 98.04% |
| Recall | 94.34% |
| F1 | 96.15% |

该层次可以识别“正例 case 中额外报告错误 endpoint”的情况，比只判断 case 是否至少存在一条路径更严格。

### 5.3 机制消融

| 配置 | TP | TN | FP | FN | Precision | Recall | Specificity | F1 | Balanced Accuracy | MCC |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Full | 50 | 14 | 0 | 3 | 100.00% | 94.34% | 100.00% | 97.09% | 97.17% | 0.881 |
| −IR recovery | 37 | 14 | 0 | 16 | 100.00% | 69.81% | 100.00% | 82.22% | 84.91% | 0.571 |
| −receiver refinement | 50 | 13 | 1 | 3 | 98.04% | 94.34% | 92.86% | 96.15% | 93.60% | 0.831 |
| Unbounded lifecycle | 52 | 13 | 1 | 1 | 98.11% | 98.11% | 92.86% | 98.11% | 95.49% | 0.910 |

主要机制结论：

- IR recovery 恢复 13 个正例，exact McNemar `p=0.000244`，在四项消融的 Bonferroni 校正后仍显著；
- receiver refinement 消除一个不可行 virtual dispatch target；
- unbounded lifecycle 增加两个 published positive，同时重新引入明确的 unreachable negative；
- F1 不使用 TN，因此 unbounded 的 F1 更高；balanced accuracy 同时衡量正负义务，默认有界模型在该目标上更高。

## 6. 异步与 Promise 语义

### 6.1 ArkAsyncBench

| 配置 | TP | TN | FP | FN | Precision | Recall | Specificity | F1 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Full | 24 | 24 | 0 | 0 | 100.00% | 100.00% | 100.00% | 100.00% |
| −T4 continuation | 15 | 24 | 0 | 9 | 100.00% | 62.50% | 100.00% | 76.92% |

分构造结果：

| 构造 | Positive | Negative | Full TP | −T4 TP | T4 独占恢复 | TN |
|---|---:|---:|---:|---:|---:|---:|
| T1 callback | 9 | 9 | 9 | 9 | 0 | 9 |
| T4 `then` | 9 | 9 | 9 | 0 | 9 | 9 |
| T5 `await` | 6 | 6 | 6 | 6 | 0 | 6 |

该消融只关闭 T4，因此 T1 与 T5 保持不变是实验隔离成功的表现，不是机制无效。完整配置相对 −T4 独占正确 9 个案例，exact McNemar `p=0.00390625`。

### 6.2 ArkPromiseBench

ArkPromiseBench 包含 7 个正例和 17 个 adversarial negative，覆盖：

- user-defined 或 non-Promise `then`；
- success/rejection handler 位置；
- `catch` 与 `finally`；
- 同一 Promise alias、reassigned alias 和 independent Promise；
- callback 忽略输入或仅使用常量；
- constant sanitizer；
- sequential `then`；
- Promise flattening；
- 只有注册、没有执行触发的 SDK callback。

| 配置 | TP | TN | FP | FN | Precision | Recall | Specificity | F1 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Full | 7 | 17 | 0 | 0 | 100.00% | 100.00% | 100.00% | 100.00% |
| −T4 | 0 | 17 | 0 | 7 | N/A | 0.00% | 100.00% | N/A |
| 所有 typed SDK callback 均可执行 | 7 | 16 | 1 | 0 | 87.50% | 100.00% | 94.12% | 93.33% |

两种消融验证两项正交义务：

1. T4 保留 Promise fulfillment payload 的 identity；
2. execution witness 区分 callback registration 与 callback execution。

### 6.3 Receiver-witnessed completion callback

最终版本把平台完成回调建模为：

`<member, callback-index, optional receiver-family>`

`requestPermissionsFromUser` 只在 callback index 为 2，且 receiver 具有 `AtManager`/`AbilityAccessCtrl` 证据时建立执行边。普通同名业务方法不会匹配。

该修复在最终 1,014 项目运行中只新增一条 endpoint 和一条精确路径，没有删除其他路径。新增路径位于 `SensorJsSamples`：

`sensor.on` callback data → `JSON.stringify(data)` → `Logger.info` → `hilog.info`

源码确认该 `sensor.on` 嵌套在权限请求完成回调和 `getSingleSensor` 回调内，路径具有真实执行上下文和显式数据依赖。该路径此前已在人工审核中标记为正确。

## 7. 真实项目路径语义审核

### 7.1 最终审核集合

最终审核集合包含：

- 120 条路径，来自 47 个项目；
- 90 条 privacy-data 路径、30 条 framework-input 路径；
- 64 条 IFDS、28 条 supplementary、28 条 dual-provenance 路径；
- 23 条短路径、70 条中等路径、27 条长路径；
- 114 条 logging、4 条 UI、2 条 network 路径。

最终重绑定过程保留 118 条精确路径。两条已退出最终结果集的旧路径由确定性分层采样替换，新记录不继承旧标签并重新查看源码；两条 provenance 从 supplementary 增强为 both 的精确路径重新核对了 Promise SDK 声明。

### 7.2 审核结果

| 审核维度 | 全部 | Privacy-data | Framework-input | IFDS | Supplementary | Both |
|---|---:|---:|---:|---:|---:|---:|
| Source identity | 120/120 | 90/90 | 30/30 | 64/64 | 28/28 | 28/28 |
| Sink identity | 120/120 | 90/90 | 30/30 | 64/64 | 28/28 | 28/28 |
| Explicit dependence | 115/120 | 90/90 | 25/30 | 59/64 | 28/28 | 28/28 |
| Reachability | 115/120 | 90/90 | 25/30 | 59/64 | 28/28 | 28/28 |
| Provenance | 120/120 | 90/90 | 30/30 | 64/64 | 28/28 | 28/28 |
| Complete path | 115/120 | 90/90 | 25/30 | 59/64 | 28/28 | 28/28 |

关键结论：

- 隐私数据路径为 90/90；
- 全部路径完整正确率为 95.83%；
- source identity、sink identity 和 provenance 为 120/120；
- 五条错误路径全部属于独立标记的 framework-input 模型。

五条错误路径均位于同一类静态字段混淆：生命周期方法把 `want.uri` 写入静态字段，但报告路径的 sink 实际使用独立的输入字段、固定校验文本或 camera-picker 结果，缺少对该静态字段的读取和显式数据依赖。这些结果不进入 privacy-data 路径结论。

## 8. 1,014 项目大规模实验

### 8.1 完成度与规模

| 指标 | 数值 |
|---|---:|
| 完成项目 | 1,014/1,014 |
| 运行错误 | 0 |
| ArkTS/TypeScript 文件 | 31,205 |
| Ark 方法 | 233,894 |
| Privacy API occurrence | 2,339 |
| Call chain | 2,339 |
| Detector-local sink | 1,755 |
| Configured-query path | 458 |
| Privacy-data path | 258 |
| Framework-input path | 200 |
| Unique configured source endpoint | 320 |
| Unique configured sink endpoint | 416 |
| Detector-to-path link | 252 |

项目级阳性率：

| 证据 | 阳性项目 | 比例 |
|---|---:|---:|
| Privacy API | 353 | 34.81% |
| Call chain | 353 | 34.81% |
| Detector-local sink | 224 | 22.09% |
| Configured path | 183 | 18.05% |
| Privacy-data path | 31 | 3.06% |
| Framework-input path | 159 | 15.68% |

API detector、detector-local sink 和 configured-query path 是不同证据空间。Configured path 中 91 个项目没有 detector API，原因是其 source 属于独立配置的 framework-input；不能要求 detector-local sink project 包含所有 configured-path project。

### 8.2 API 结构

Access mode：

| 模式 | 数量 | 比例 |
|---|---:|---:|
| Assigned/direct-result invoke | 915 | 39.12% |
| Manager/receiver indirect invoke | 783 | 33.48% |
| Property/constant access | 417 | 17.83% |
| Direct invoke statement | 224 | 9.58% |

间接 receiver 与 property 合计 1,200/2,339，即 51.30%。这说明仅解析 `namespace.method(...)` 无法覆盖大规模语料中的主要 ArkTS 身份形态。

Detector acceptance witness：

| 证据 | 数量 |
|---|---:|
| Direct/property | 1,556 |
| Receiver type | 592 |
| Receiver origin | 190 |
| Exact namespace receiver | 1 |

前五类 privacy evidence：

| 类别 | Occurrence | 占比 |
|---|---:|---:|
| `network.connectivity` | 427 | 18.26% |
| `device_identity.screen` | 403 | 17.23% |
| `device_identity.hardware` | 353 | 15.09% |
| `user_data.account` | 189 | 8.08% |
| `user_data.clipboard` | 119 | 5.09% |

### 8.3 Sink 结构

| Sink 类型 | 数量 | 占比 |
|---|---:|---:|
| Log | 1,441 | 82.11% |
| UI display | 136 | 7.75% |
| Storage | 94 | 5.36% |
| Data return | 58 | 3.30% |
| Network | 26 | 1.48% |

这些是 detector-local 观察，不等价于泄露结论。Log 与 UI 主要表示本地可观察面；storage 表示持久化；network 数量较少但通常具有更高审核优先级。

### 8.4 路径 provenance 与 carrier

| Provenance | 路径 |
|---|---:|
| IFDS | 331 |
| Async supplement | 78 |
| Both | 49 |

| Carrier state | 路径 |
|---|---:|
| Framework argument | 200 |
| Callback payload | 120 |
| Direct value | 99 |
| Promise payload | 39 |

最终语料包含 15 条 `promise_then` 路径，分布于 9 个项目；其中 9 条为 IFDS-only、6 条为 dual provenance。没有观察到 `promise_return` 路径，这说明真实语料中已检出的 Promise 链主要在第一个 fulfillment handler 内到达 sink；顺序链和 flattening 能力由 ArkPromiseBench 单独验证。

### 8.5 证据可追溯性

| 指标 | 数值 |
|---|---:|
| Call-chain 长度 median / P95 / max | 1 / 4 / 10 |
| Taint-path statement 数 median / P95 / max | 5 / 9 / 16 |
| Async call chain | 424 |
| Local fallback call chain | 0 |
| Permission-bearing occurrence | 1,075 |
| 已解析 trace endpoint | 3,337/3,337 |
| 无效 detector-to-path link | 0 |
| Strict report checks | 1,014 |
| Strict check failure | 0 |

Detector–IFDS 一致性审核覆盖 258 条 privacy-data configured flow：

- covered configured flows：258/258；
- unique candidate mismatch：0；
- strong candidate mismatch：0。

### 8.6 规模、集中度与相关性

API occurrence 呈长尾分布：

| 指标 | 数值 |
|---|---:|
| Top-10 占比 | 24.54% |
| Top-50 占比 | 54.98% |
| Top-120 占比 | 77.85% |
| Gini | 0.858 |
| HHI | 0.0105 |
| Effective contributing projects | 95.6 |

Spearman 相关系数：

| 变量 | rho |
|---|---:|
| Files vs. methods | 0.9226 |
| Methods vs. runtime | 0.4589 |
| Methods vs. API occurrence | 0.4847 |
| API occurrence vs. detector-local sink | 0.7887 |
| API occurrence vs. configured path | 0.1838 |
| Sink vs. configured path | 0.1970 |

项目规模与 API identity volume 中等相关，但与 configured path 数量仅弱相关。路径形成还取决于 source carrier、sink query、调用关系和数据依赖，不能由代码规模或 API 数量直接推断。

### 8.7 性能

| 指标 | 数值 |
|---|---:|
| Runtime median | 15.7 s/project |
| Runtime P95 | 21.6 s/project |
| Runtime maximum | 380.2 s |
| 隔离进程 wall-time 总和 | 17,468.9 s |
| IFDS edges | 3,006,526 |
| IFDS edges median / P95 / max | 739 / 10,811 / 187,278 |
| IFDS batching | 0 projects |
| Resource/callback truncation | 0 projects |
| Timeout / OOM | 0 projects |

### 8.8 Clone 敏感性

| 采样单位 | N | API-positive | Sink-positive | Path-positive |
|---|---:|---:|---:|---:|
| 原始项目 | 1,014 | 34.81% | 22.09% | 18.05% |
| Exact-clone 每簇一个 | 995 | 35.18% | 22.31% | 18.19% |
| Near-clone 每簇一个 | 993 | 35.05% | 22.26% | 18.23% |

语料包含 31,998 个源码文件、21,430 个唯一 token fingerprint、9 个 exact-clone cluster 和 11 个 near-clone cluster。去重后的项目率最大变化为 0.363 个百分点，因此项目级 prevalence 不是由少量重复模板主导。

## 9. 最终运行差异审计

最终版本相对前一冻结版本：

| 指标 | 前一版本 | 最终版本 | 变化 |
|---|---:|---:|---:|
| Unique path | 457 | 458 | +1 |
| Unique endpoint | 448 | 449 | +1 |
| IFDS edges | 3,006,311 | 3,006,526 | +215 |
| 删除路径 | 0 | 0 | 0 |

唯一新增路径为经源码确认的权限完成回调内 `sensor.on` 路径。其他 457 条精确路径全部保持，说明 receiver-witnessed completion contract 的影响范围与设计目标一致。

## 10. 结论边界

本轮结果支持以下结论：

1. 在冻结规则和静态可枚举候选 universe 内，API identity 的 observed precision、recall 和 specificity 均为 100.00%；
2. ArkPrism 在 HapBench 上的核心优势是负例判别，specificity 提升 28.57 个百分点，F1 提升 2.65 个百分点；
3. T4 对 Promise fulfillment payload 传播是必要的，严格 execution witness 对避免 callback-registration FP 是必要的；
4. 人工审核的 privacy-data 路径为 90/90，全部分层路径为 115/120；
5. 最终 1,014 项目运行完整、无资源 fallback，结果端点和 provenance 均通过一致性审核。

本轮结果不把以下内容等同：

- API occurrence 与隐私违规；
- detector-local sink 与 IFDS sink endpoint；
- may-flow 与运行时必然执行；
- 1,014 项目输出统计与总体准确率；
- 高输出 Top-120 reproduction coverage 与未报告调用的 recall。

## 11. 最终产物

主要机器可读产物：

- `docs/experiment_argus1014_platform_task_final_573dbcb/large_corpus_summary.json`
- `docs/experiment_argus1014_platform_task_final_573dbcb/run_manifest.json`
- `docs/experiment_argus1014_platform_task_final_573dbcb/evidence_universe_audit.json`
- `docs/experiment_argus1014_platform_task_final_573dbcb/detector_ifds_consistency.json`
- `docs/experiment_argus1014_platform_task_final_573dbcb/semantic_path_audit_queue.json`
- `docs/experiment_argus1014_platform_task_final_573dbcb/semantic_path_audit_decisions.json`
- `docs/experiment_argus1014_platform_task_final_573dbcb/semantic_path_audit_evaluation/semantic_path_audit.json`
- `docs/experiment_argus1014_platform_task_final_573dbcb/corpus_redundancy/corpus_redundancy.json`
- `docs/experiment_argus1014_platform_task_final_573dbcb/benchmarks/hapbench/hapbench_results.json`
- `docs/experiment_argus1014_platform_task_final_573dbcb/benchmarks/arkasyncbench/arkasyncbench_results.json`
- `docs/experiment_argus1014_platform_task_final_573dbcb/benchmarks/arkpromisebench/comparison_t4_off.json`
- `docs/experiment_argus1014_platform_task_final_573dbcb/benchmarks/arkpromisebench/comparison_unrestricted_callbacks.json`

所有论文 corpus 数字、Figure 5 和相关表格均由上述最终 JSON 自动生成。
