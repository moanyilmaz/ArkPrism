# ArkPrism vs ArkAnalyzer & HapFlow 深度对比分析

> 调研时间：2026-07-06
> 对比对象：ArkAnalyzer（ISSTA 2024）、HapFlow（ICSE 2025）、ArkPrism
> 数据来源：论文原文 + 开源代码仓库（arkanalyzer_src、hapflow_artifact、apak_src）

---

## 一、总体判断：ArkPrism 不是玩具，但离顶刊还有差距

**核心结论**：ArkPrism 在**应用层**（隐私API识别、多源协作检测、大规模评测）有独特贡献，但在**分析框架层**（指针分析、上下文敏感、生命周期建模）依赖 ArkAnalyzer，在**污点分析层**复用 HapFlow 的 IFDS 引擎。换句话说：

| 层次 | ArkAnalyzer | HapFlow | ArkPrism |
|---|---|---|---|
| 分析框架 | 自研（42K行，PTA+ViewTree+SSA+DVFG） | 依赖ArkAnalyzer | 依赖ArkAnalyzer |
| 污点引擎 | 无 | 自研IFDS（%closure变换，4个流函数） | 复用HapFlow IFDS + 自研callback分析 |
| 隐私API识别 | 无 | LLM辅助3类source（2,066条） | 4模式匹配+包族归一化 |
| 多源协作 | 无 | 无 | **独创**：7源反向调用图+协作检测 |
| 评测规模 | 618 apps（CHA/RTA精度） | HapBench 67用例 + 3,490 apps | **1,015 apps + Top-120人工标注** |

**ArkPrism 的独特价值**在于应用场景的深度——它不是做分析框架，而是做隐私合规检测这个具体问题的端到端解决方案。这个定位本身没问题，但论文需要讲清楚"你比 HapFlow 多做了什么"以及"你的方法为什么不可替代"。

---

## 二、逐维度深度对比

### 1. 分析框架完整性

**ArkAnalyzer（42,891行）**：
- 自研 ArkTS AST + IR 体系
- **System Component Desugaring**：将 ArkUI 声明式组件 `Row() { Column() {} }` 降级为 `RowInterface.create()/ColumnInterface.create()/pop()` 调用序列——这是论文核心创新
- 完整 Pointer Analysis：PAG（1,098行）+ PagBuilder（1,981行）+ k-limited 上下文敏感
- ViewTreeBuilder（1,232行）：从 IR 重建 UI 组件树
- SSA Formation + DVFG（声明式数据流图）
- CHA/RTA Call Graph 构建
- Pass 基础设施（注册/调度/依赖管理）

**ArkPrism**：
- 直接使用 ArkAnalyzer 作为依赖（`npm i arkanalyzer`）
- 没有修改 ArkAnalyzer 核心框架
- 自研部分集中在 `apiDetector.ts`（498行，4模式匹配）+ `hapflowRunner.ts`（282行，桥接）+ callback分析（~800行）

**差距**：ArkPrism 没有框架层贡献。但这是**定位差异**而非缺陷——ArkAnalyzer 做的是"给 ArkTS 造分析基础设施"，ArkPrism 做的是"用这些基础设施做隐私检测"。

---

### 2. 污点分析深度

**HapFlow（核心~2,053行）**：
- **%closure IR 变换**：将闭包调用 `callback()` 转换为显式 Call/Return 边，让 IFDS 能直接传播
- **4个流函数**完整实现（NormalFlow、CallFlow、ReturnFlow、CallToReturnFlow），各~50-100行
- **3类 source 建模**：returnSource（返回值）、paramSource（回调参数）、callbackSource（闭包参数）
- **DummyMainCreater**（341行）：模拟 ArkUI 生命周期（aboutToAppear→onPageShow→onBackPress→aboutToDisappear）+ 回调收集
- **别名感知传播**：`propagateAlias()` 处理赋值别名链

**ArkPrism**：
- 复用 HapFlow 的 IFDS 引擎（`DataflowSolver.ts`）
- 自研 `analyzeCallbackDataFlows()` 作为 IFDS 的补充：
  - 3种回调解析策略（FunctionType、ClosureType、Local回溯）
  - worklist BFS + budget 限制
  - Promise.then() 链分析
  - `%closures*` 变量过滤

**关键差异**：

| 方面 | HapFlow | ArkPrism |
|---|---|---|
| 闭包处理 | %closure IR变换（修改IR本身） | 回调解析+worklist追踪（不动IR） |
| source建模 | LLM辅助3类2,066条 | JSON配置4模式匹配 |
| 生命周期建模 | HarmonyMain（显式4阶段） | 无（依赖ArkAnalyzer默认入口） |
| IFDS流函数 | 完整4函数 | 复用HapFlow |

**HapFlow 的 %closure 变换更优雅**——它从根本上让 IFDS 能看到闭包调用，而 ArkPrism 的 callback 分析是"绕过 IFDS 做补充"。但从效果看，ArkPrism 的 callback 分析覆盖了 HapFlow %closure 处理不到的场景（如 Promise.then 链、跨方法回调参数传播）。

---

### 3. Source/Sink 建模

**HapFlow**：
- LLM 辅助从 HarmonyOS SDK 文档自动提取 source/sink
- 2,066 sources + 172 sinks（1.4MB JSON）
- 3种 source 类型区分数据流方向
- 但：**只覆盖 direct call 和 assigned invoke**，无法处理 indirect invoke（manager receiver）和 privacy constants

**ArkPrism**：
- 人工整理 + 包族归一化的 sensitive_apis.json
- 4模式覆盖：direct invoke、assigned invoke、**indirect invoke**、**privacy constants**
- `PACKAGE_ALIASES` 处理 `@ohos.*` ↔ `@kit.*` 包名迁移

**ArkPrism 这里有明确优势**：Top-50 人工审计中，25个 FP 里有多个是 `photoaccesshelper|createAsset`、`camera|createCameraInput` 这类 indirect invoke——HapFlow 的 source 配置根本匹配不到这些模式。

---

### 4. 评测方法论

**HapFlow**：
- HapBench：67 个人工微基准，按隐私类别分类
- 3,490 apps 大规模扫描（发现 73 个真实泄露）
- 指标：precision/recall/F1

**ArkAnalyzer**：
- 618 apps 上的 CHA/RTA call graph 精度
- ViewTree 构建正确性
- 指标：precision/recall/F1

**ArkPrism**：
- 1,015 apps（ARGUS-1015），31,433 files，238,271 methods
- Top-120 人工标注：100% P/R/F1（namespace+method 粒度）
- Top-50 人工审计：94.29% precision / 100% recall
- 三级标注体系（Raw → Presence → Qualified）

**ArkPrism 评测规模最大、标注最严格**，但缺少与 HapFlow 的直接对比实验。

---

## 三、ArkPrism 的独特贡献（别人没做的）

1. **4模式API识别**：indirect invoke 和 privacy constants 是 HapFlow 完全无法检测的盲区
2. **7源反向调用图**：从 API usage 反向追踪到入口方法，HapFlow 只做正向 taint
3. **多源协作检测**：同一入口方法下多个隐私 API 的组合风险，没有任何现有工作做这个
4. **数据汇分类**：将 taint flow 的 sink 分为 network/storage/UI/log 四类
5. **包族归一化**：`@ohos.*` ↔ `@kit.*` 的别名映射，HapFlow 的 source 配置受限于固定包名
6. **IFDS OOM 修复**：Scene 污染修复、O(1) 边去重、budget 限制、批量求解——这些让 IFDS 在 1,015 个项目上能跑完

---

## 四、要发顶刊需要补什么

### 必须补的（硬伤）

| 问题 | 现状 | 改进方案 |
|---|---|---|
| **缺少与 HapFlow 的直接对比实验** | 没有在相同数据集上对比 | 在 ARGUS-1015 上用 HapFlow source 配置做 API 识别，量化其漏检量 |
| **缺少 ablation study** | 没有消融实验 | 去掉 indirect invoke → recall 降多少？去掉 callback 分析 → sink 覆盖降多少？ |
| **HapFlow 复用未讲清楚** | 直接用了 HapFlow 的 IFDS 引擎 | 明确说明"复用 IFDS 引擎 + 自研 callback 分析补充"，并量化 callback 分析的增量贡献 |
| **缺少生命周期建模** | 依赖 ArkAnalyzer 默认入口 | 参考 HapFlow 的 HarmonyMain，构建 ArkPrism 自己的 DummyMain |

### 建议补的（加分项）

| 方面 | 现状 | 改进方案 |
|---|---|---|
| **Source 建模自动化** | 人工整理 JSON | 参考 HapFlow 的 LLM 辅助提取，或从 SDK .d.ts 自动提取 |
| **Context sensitivity** | 无 | 在 IFDS 中加入 k-CFA/k-obj，量化精度提升 |
| **False Positive 根因分析** | Top-50 有 25 FP 但没深入分析 | 逐个分析 FP 根因（规则过宽？IR 降级？类型推断失败？） |
| **真实漏洞案例** | 只有 API 识别，没有真实隐私泄露验证 | 在 3,490+ apps 上找真实泄露，与 HapFlow 的 73 个对比 |

---

## 五、具体改进路线图

### 短期（1-2周，补硬伤）

1. **HapFlow 对比实验**：在 Top-120 上用 HapFlow source 配置模拟 API 识别，量化漏检
2. **Ablation study**：4模式逐一去掉，量化每个模式的增量贡献
3. **FP 根因分析**：Top-50 的 25 个 FP 逐个分类

### 中期（1-2月，补深度）

4. **DummyMain 构建**：参考 HapFlow 的 HarmonyMain，加入 ArkUI 生命周期 + 事件回调入口
5. **Callback 分析 vs %closure 对比**：在 HapBench 上对比两种闭包处理方式的精度
6. **Context sensitivity 实验**：在 IFDS 中加入 1-CFA，量化 call graph 精度提升

### 长期（3-6月，发顶刊）

7. **端到端隐私合规检测**：从 API 识别 → taint flow → 合规违规判定，形成完整 story
8. **大规模真实漏洞发现**：在 3,000+ apps 上跑，找真实隐私泄露并负责任披露
9. **与监管标准对齐**：将检测结果映射到 GB/T 35273 或 HarmonyOS 隐私规范

---

## 六、最终评估

**ArkPrism 不是玩具**，理由：
- 1,015 项目的大规模评测是真实的
- 4模式 API 识别解决了 HapFlow 的盲区（indirect invoke + privacy constants）
- 多源协作检测是独创的
- IFDS OOM 修复让系统在真实场景中可用

**但离顶刊还有差距**，核心问题是：
1. 框架层依赖 ArkAnalyzer，污点层复用 HapFlow——需要更清晰地定义"你的贡献边界"
2. 缺少与 HapFlow 的直接对比实验——审稿人一定会问"你比 HapFlow 好在哪"
3. 缺少 ablation study——无法证明每个模块的必要性

**最可行的顶刊路径**：定位为"首个面向 HarmonyOS 的端到端隐私合规静态检测系统"，强调：
- 4模式 API 识别（覆盖 HapFlow 盲区）
- 多源协作检测（独创）
- 1,015 项目评测 + 对比实验 + 消融实验
- 在 HapBench 上也跑一下，证明 callback 分析的增量价值
