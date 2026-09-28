# 大项目性能与可配置分析模式

## 使用选择

- 只需要 API 采集行为、调用链、结构性数据汇点和组合行为：使用 `--no-taint`，不执行 PTA 和 IFDS 污点分析。
- 需要污点路径，并优先考虑耗时：使用 `--analysis-profile fast`，采用 RTA 调用目标分析，保留 IFDS 和回调补充分析。
- 保留原有分析配置：使用 `--analysis-profile precise`，或不指定模式，采用上下文深度为 2 的 PTA。
- `--taint-call-graph cha` 可显式选择 CHA；旧选项 `--no-pta` 保持这一含义。

API 识别清单、识别算法和源码扫描范围不随模式变化。RTA 不计算 PTA 的对象指向关系，因此污点路径可能不同，不能把快速模式当作与 PTA 完全等价的替代品。

```powershell
$env:OPENHARMONY_SDK_PATH = 'E:\OpenHarmony_SDK\26.0.0\ets'
node dist/arkprism.js '<工程目录>' --no-taint --output-dir out/collection
node dist/arkprism.js '<工程目录>' --analysis-profile fast --output-dir out/fast
node dist/arkprism.js '<工程目录>' --analysis-profile precise --output-dir out/precise
```

配置冲突在分析前报错。PTA 失败不会自动降为 RTA；`--no-taint` 明确跳过污点分析，而不是将未执行分析解释成零条污点流。

## 实现依据

项目中的 ArkAnalyzer 已提供 `RapidTypeAnalysis`、`ClassHierarchyAnalysis` 和 `PointerAnalysis`。原有调用链模块本来就优先使用 RTA，失败后使用 CHA；较重的 PTA 位于独立的污点分析阶段。

本次新增的 RTA 选项作用于污点分析，不替换 API 检测过程。RTA 使用与 IFDS 相同的 Scene 和生命周期 DummyMain，先完成实例化类型与虚调用的固定点计算，再为 IFDS 提供调用目标。目标按调用语句缓存，避免每条传播事实重复执行解析。默认 PTA 的配置和分析预算不变。

报告新增 `analysisConfiguration` 和 `performance`。污点阶段另有 `taintAnalysis.performance`，分别记录 SDK 加载、生命周期建模、调用目标构建和 IFDS 等耗时。

## 测试条件

- AMD Ryzen 7 5800H，8 核 16 线程，16 GB 内存。
- Node.js v20.18.0，OpenHarmony SDK API 26（26.0.0.38）。
- 每次启动独立 Node 进程，串行运行，V8 堆上限 12 GiB。
- 两个真实工程，各模式运行一次。结果是本机实测，不代表所有大型工程的时间上界。
- 端到端时间包含进程启动和 JSON/DOT 写出；内部阶段时间不包含报告写出。
- 内存为报告写出前采样的进程峰值 RSS，不是 V8 堆用量。CPU 时间为进程分析区间累计用户态与内核态时间，不是整机 CPU 利用率。

## 不执行污点分析

| 工程 | 文件 / 方法 | API / 调用链 | 端到端时间 | 峰值 RSS | CPU 时间 |
|---|---:|---:|---:|---:|---:|
| AppGalleryForOpenHarmony | 1,709 / 21,723 | 57 / 57 | 33.75 秒 | 1.40 GiB | 43.95 秒 |
| MusicForOpenHarmony | 5,741 / 95,149 | 39 / 39 | 114.85 秒 | 4.97 GiB | 140.01 秒 |

两者均满足单工程 300 秒以内的无污点分析目标。

| 阶段 | AppGallery | Music |
|---|---:|---:|
| Scene 构建与类型推导 | 12.48 秒 | 44.77 秒 |
| API 识别 | 5.29 秒 | 18.64 秒 |
| 调用图构建 | 1.12 秒 | 3.70 秒 |
| 调用链提取 | 2.75 秒 | 12.07 秒 |
| 组合行为分析 | 8.02 秒 | 25.48 秒 |

表中列出主要阶段，非总时间的完整拆分。API 识别并非零成本，但这两个工程的主要前端开销是 Scene 构建；调用图构建不是无污点模式的主要瓶颈。

## 保留污点分析的对照

| 工程 | 模式 | 端到端时间 | 调用目标构建 | IFDS 传播 | 峰值 RSS | CPU 时间 |
|---|---|---:|---:|---:|---:|---:|
| AppGallery | PTA（默认） | 251.43 秒 | 4.57 秒 | 196.41 秒 | 6.68 GiB | 284.88 秒 |
| AppGallery | RTA（快速） | 77.96 秒 | 0.58 秒 | 28.87 秒 | 3.11 GiB | 98.28 秒 |
| Music | PTA（默认） | 638.61 秒 | 18.68 秒 | 482.54 秒 | 11.09 GiB | 737.31 秒 |
| Music | RTA（快速） | 349.76 秒 | 2.39 秒 | 214.95 秒 | 8.78 GiB | 405.11 秒 |

快速模式在两个工程上的端到端加速分别为 3.22 倍和 1.83 倍。主要收益不只是跳过 PTA 构建，也包括改变调用目标和别名传播后降低 IFDS 工作量：AppGallery 的处理边数从 1,559,703 降至 578,183，Music 从 4,336,219 降至 2,700,112。所有带污点分析的运行状态均为 `SUCCESS`，未触发 IFDS 或回调预算上限。

Music 的 RTA 模式仍超过 300 秒。五分钟验收目标对应的是 `--no-taint`，不能将其推广为所有带污点分析模式的耗时保证。

## 输出一致性

对每个工程，三种模式的 `privacyApiUsages`、`callChains`、`multiSourceCollaborations` 和 `permissionUsages` 均进行了完整结构比较，结果完全一致，不只是数量相同。

| 工程 | API 记录 | 调用链 | PTA 污点路径 | RTA 污点路径 |
|---|---:|---:|---:|---:|
| AppGallery | 57 | 57 | 0 | 0 |
| Music | 39 | 39 | 1 | 1 |

两个工程的 PTA 与 RTA 污点路径记录也完全一致。Music 的一条路径是测试 Ability 的 `onCreate(want)` 到 `hilog.info`，类型为 `framework_input`，不是敏感 API 返回数据的流。这些结果说明本次模式切换没有改变两个样本的最终输出，不表示 RTA 与 PTA 在其他工程上必然等价，也不是重新测得的准确率或召回率。

## 验证与原始结果

构建与 38 项交付检查通过。新增回归覆盖配置校验、RTA 工厂实例传播、未实例化子类过滤、调用目标缓存、三个调用目标模式的真实 SDK 集成和 API 结果一致性。

原始结果目录：`E:\APPerformance20260928\verified`。各次运行保留 JSON、DOT、日志和端到端运行记录；`environment.json` 记录环境，`summary.json` 提供完整数据，`summarize.js` 汇总并检查结果一致性。执行 `node E:\APPerformance20260928\verified\summarize.js` 可从六份运行结果重新生成汇总。
