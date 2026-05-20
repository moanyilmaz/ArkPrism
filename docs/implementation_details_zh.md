# ArkPrism 实现细节

本文按当前仓库代码的真实行为整理 ArkPrism 的实现。重点覆盖入口流程、规则检测、调用图增强、调用链追踪、数据汇聚、多源协同、权限提取、HapFlow 污点分析与输出结构。

## 1. 项目目标

ArkPrism 面向 HarmonyOS ArkTS 项目做隐私行为静态分析。它的核心输出不是“命中了哪些 API”，而是以下几层信息的组合：

1. 哪些隐私 API 或隐私常量被访问。
2. 这些访问是从哪个页面、生命周期或交互入口触发的。
3. 返回的数据后续是否流向网络、存储、界面、日志或返回值。
4. 多个隐私类别是否在同一逻辑点发生协同。
5. 在可选条件下，是否存在更精确的 source-to-sink 污点路径。

## 2. 主流程

CLI 入口在 `src/arkprism.ts`。当前 parser 实际支持的参数是：

- `--batch`
- `--config`
- `--output-dir`
- `--no-dot`
- `--no-taint`
- `--no-pta`
- `--sdkPath`

主流程如下：

1. 构造 `SceneConfig`，调用 `getSceneFromJson()` 建立 ArkAnalyzer 场景。
2. 若 SDK 路径存在，额外调用 `scene.buildSdk('@ohosSdk', sdkPath)` 加载 SDK 声明。
3. 遍历 `scene.getFiles()`，跳过 `build`、`cache`、`node_modules`、`oh_modules`、`.preview`。
4. 读取 `config/privacy_apis.json` 和 `config/system_packages14.json`。
5. 对每个业务文件执行隐私 API 检测。
6. 若检测到 API，则继续：
   - `buildCallGraph(scene)`
   - `traceCallChains(...)`
   - `analyzeDataSinks(...)`
   - `enrichCallChainsWithSemanticContext(...)`
   - `detectMultiSourceCollaborations(...)`
7. 若未传 `--no-taint`，运行 `runHapflowAnalysis(...)`。
8. 运行 `analyzePermissions(projectDir)` 提取权限声明。
9. 输出 JSON 报告；若未禁用 DOT，则额外导出图。

## 3. 场景构建与底层表示

场景构建在 `src/utils.ts`。

`getSceneFromJson()` 的顺序是：

1. `scene.buildBasicInfo(config)`
2. `scene.buildScene4HarmonyProject()`
3. `scene.inferTypes()`

ArkPrism 自己不重新实现 IR、CFG 或调用图，而是建立在仓库内集成的 ArkAnalyzer 上。后续分析统一消费：

- Ark IR 语句
- 方法签名
- 控制流图
- 调用图
- 类型信息
- 指针分析结果

这也是为什么它能同时做规则匹配、调用链回溯和 IFDS 污点分析。

## 4. 隐私 API 检测

实现位于 `src/apiDetector.ts`。

### 4.1 规则来源

规则来自 `config/privacy_apis.json`，系统包白名单来自 `config/system_packages14.json`。每条规则当前主要使用这些字段：

- `namespace`
- `method`
- `directCall`
- `permission`
- `profilingCategory`
- `ohos_module`

### 4.2 预过滤

分析器先读取当前文件真实导入的系统包，只保留与这些导入有关的规则。这样可以把大规则库压缩成文件级候选集合，降低误报和扫描成本。

### 4.3 当前实际支持的 4 种检测模式

1. `direct invoke stmt`
   - 纯调用语句
   - 典型对象是 `ArkInvokeStmt`
2. `direct invoke stmt after assignment`
   - 赋值语句右侧是调用表达式
   - 典型对象是 `ArkAssignStmt`
3. `indirect invoke`
   - 通过对象类型恢复 manager / service 上的方法
   - 依赖接收者类型字符串
4. `privacy constants`
   - 字段或常量访问
   - 依赖 `containsFieldRef()`

代码里的 `PrivacyDataApiResult.category` 仍保留 `callback invoke` 枚举值，但当前 `apiDetector.ts` 不会产出这一类结果。

### 4.4 导入兼容

检测器兼容两类导入风格：

- `@kit.X`
- `@ohos.xxx`

当规则通过 `ohos_module` 命中时，会把 `@ohos:` 标准化成 `@ohos.` 再匹配源码导入。

### 4.5 结果字段

每条命中结果都会写入：

- `file`
- `declaringMethod`
- `code`
- `permission`
- `profilingCategory`

这些字段直接进入后续调用链、多源协同和汇聚分析。

## 5. 调用图构建

实现位于 `src/callGraphBuilder.ts`。

### 5.1 入口点选择

入口方法按优先级分为：

1. 用户交互回调
2. 组件生命周期
3. 应用生命周期
4. 初始化方法

实际入口集来自：

- 交互回调列表，如 `onClick`、`onChange`、`onSubmit`
- ArkAnalyzer 的 `COMPONENT_LIFECYCLE_METHOD_NAME`
- ArkAnalyzer 的 `LIFECYCLE_METHOD_NAME`
- `onConnect`、`onDisconnect`、`onRequest`
- `_DEFAULT_ARK_METHOD`
- `constructor`

### 5.2 构建策略

`buildCallGraph(scene)` 先尝试：

1. `scene.makeCallGraphRTA(entryPoints)`
2. 失败时退回 `scene.makeCallGraphCHA(entryPoints)`

### 5.3 生命周期隐式边

调用图建立后，分析器还会手工补一批框架隐式边，例如：

- `aboutToAppear -> build -> onPageShow -> onPageHide -> aboutToDisappear`
- `onCreate -> onWindowStageCreate -> onForeground -> onBackground -> onWindowStageDestroy`

这些边不是源码中的显式调用，但对页面级行为解释是必要的。

### 5.4 代码中的已知限制

`callGraphBuilder.ts` 明确说明：ArkAnalyzer 原生 RTA/CHA 不能稳定建立“用户代码 -> SDK API”的边，原因主要有：

- SDK 方法不进入普通 `methodsMap`
- SDK `.d.ts` 无真实方法体
- 动态调用路径只记录信息，不一定落成调用图边

因此，真实的 API 终点补边依赖 `callChainTracer.ts` 中的 S3 语句扫描。

## 6. 调用链追踪

实现位于 `src/callChainTracer.ts`，这是当前项目最关键的模块。

### 6.1 目标

对每一个隐私 API，回答三个问题：

1. 它从哪个入口方法触发。
2. 中间经过了哪些业务方法或回调。
3. 调用时处于什么控制流和语义上下文。

### 6.2 增强反向调用图

当前 tracer 的反向图来自以下来源：

1. Source 1：原生调用图边
2. Source 4：函数参数回调边
3. Source 5：ArkUI/Promise 回调边
4. Source 3：基于可达域的显式调用扫描

需要注意两点：

- `callChainTracer.ts` 里的旧注释仍写着“五源”，但当前实现已经移除了 S2 CHA 补边。
- `multiSourceAnalyzer.ts` 的内部路径图仍保留了 CHA 作为辅助来源，两者不要混淆。

### 6.3 Source 4：回调参数补边

这一层专门补 ArkUI 匿名回调和函数参数回调：

- 先检查调用参数中是否存在 `FunctionType`
- 若存在，则精确解析到对应方法签名
- 若精确解析失败，再回退到 `%AM...` 名称匹配

这一步解决的是 `build()` 里注册回调、真正业务逻辑藏在 `%AMx$build()` 中的问题。

### 6.4 Source 5：框架回调与 Promise

这一层进一步补两类边：

- `getCallbackMethodFromStmt(...)` 能识别的 ArkUI 事件回调
- Promise 的 `.then()`、`.catch()`、`.finally()` 回调

### 6.5 Source 3：可达域内 invoke 扫描

这是当前版本覆盖率提升的主来源。

算法思路是：

1. 先用入口方法、`%dflt`、`[static]%dflt`、`initialRender` 建立可达种子。
2. 用已有边做一次正向 BFS，得到初始可达集。
3. 只对可达方法继续扫描 `invokeExpr.getMethodSignature()`。
4. 若语句中引用 `%AM`，把同类中的对应回调方法也标记为可达。
5. 反复迭代直到没有新增方法。

这个设计避免了“全工程暴力扫描 invoke”带来的噪声，同时补回原生调用图漏掉的 SDK 终点。

### 6.6 路径搜索

对每个 API，tracer 从 `declaringMethod` 反向 BFS 回溯，默认最大深度 15。若 API 所在方法本身就是入口，则直接构造单跳链。

结果中的每条 `CallChainLink` 会记录：

- `caller`
- `callee`
- `callType`
- 解析后的可读名

### 6.7 控制结构抽取

`extractControlStructures()` 会结合 CFG、基本块顺序和支配关系，抽取：

- `if`
- `loop`
- `try_catch`

附带字段包括：

- `condition`
- `branchSide`
- `isGuardCondition`
- `hasCatchFallback`
- `isDominatingApiCall`

这使得报告可以区分“权限判断后才调用”与“异常回退中调用”。

### 6.8 语义上下文

`buildSemanticContext()` 进一步生成：

- `pageName`
- `componentClass`
- `semanticAnchor`
- `simplifiedChain`
- `purposeHint`

其中 `semanticAnchor` 会主动跳过 `build`、`aboutToAppear`、默认方法、匿名包装层等弱语义节点，尽量定位到真正的业务方法。

### 6.9 后验验证

`verifyCallChain()` 已实现，但当前主流程默认不调用。它仍可在测试或离线验证时使用，按每一条边检查：

- 直接调用
- `FunctionType` 回调引用
- `%AM` 引用
- 原生调用图边

## 7. 数据汇聚分析

实现位于 `src/dataSinkAnalyzer.ts`。

### 7.1 当前 sink 类型

当前代码支持：

- `network`
- `storage`
- `ui_display`
- `log`
- `data_return`

### 7.2 分析策略

它不是全程序精确污点，而是“变量跟踪 + sink 模式匹配”的轻量实现：

1. 先找 API 结果赋给了哪个变量。
2. 再扫描变量是否流入 sink 语句。
3. 若变量被写进 `this.xxx` 字段，则允许在同类其它方法中继续扫描。

### 7.3 实际覆盖

当前内置的模式主要覆盖：

- 网络发送：HTTP、RCP、WebSocket、Socket、上传
- 本地写入：preferences、RdbStore、fs
- UI 展示：Text、TextInput、Image 等组件调用
- 日志：`console.*`、`hilog.*`
- 返回值：`ArkReturnStmt`

## 8. 多源协同分析

实现位于 `src/multiSourceAnalyzer.ts`。

### 8.1 目标

它关心的不是单个 API，而是多个 `profilingCategory` 是否在同一逻辑上下文中汇合，形成更完整的画像行为。

### 8.2 四层策略

当前实现按以下顺序检测：

1. Same-method
2. Cross-method via LCA
3. Same-file aggregation
4. Application-level aggregation

### 8.3 风险等级

风险分级以类别数为准：

- 4 类及以上：`high`
- 3 类：`medium`
- 2 类：`low`

### 8.4 子图构建

若存在具体的 LCA，分析器会构造 `subgraph`：

- `entryToLca`
- 每个 `lcaToSource`
- 每个 source 的 sinks

这会直接被 DOT 导出器消费。

### 8.5 与 tracer 的区别

`multiSourceAnalyzer.ts` 自己构建路径图时，仍然保留：

- 原生调用图边
- CHA 解析
- invoke 扫描
- `%AM` 回调边
- `getCallbackMethodFromStmt`

因此它和 `callChainTracer.ts` 的增强图来源不完全相同。

## 9. 权限分析

实现位于 `src/permissionAnalyzer.ts`。

当前权限分析器只做“声明提取”，不做“权限合规判定”。

实际行为是：

1. 查找全部 `module.json5`
2. 解析 `module.requestPermissions`
3. 抽取 `permission` 和 `reason`
4. 若 `reason` 形如 `$string:xxx`，则去 `string.json` 中解引用

当前没有做以下工作：

- 未检测 API 是否缺失权限声明
- 未检测权限是否冗余
- 未输出 API 与权限的一致性结论

## 10. HapFlow 污点分析

入口在 `src/hapflowRunner.ts`，核心实现位于 `src/hapflow/`。

### 10.1 启动条件

只有满足以下条件才会真正运行：

1. 未传 `--no-taint`
2. SDK 路径存在
3. source / sink 规则能成功加载

否则主流程会跳过并返回空 taint 结果。

### 10.2 运行步骤

`runHapflowAnalysis()` 的顺序是：

1. 懒加载 SDK 到 `scene`
2. 创建 `DummyMain`
3. 可选执行 PTA
4. 从 `config/hapflow_sources.json` 和 `config/hapflow_sinks.json` 读规则
5. 建立 `TaintAnalysisChecker`
6. 调用 `TaintAnalysisSolver.solve()`
7. 把 `TaintFact[]` 转成 `TaintFlowResult[]`

### 10.3 当前传播能力

`src/hapflow/TaintAnalysis.ts` 中的 IFDS 问题当前支持：

- 普通赋值传播
- 过程间参数映射
- 返回值回传
- `this` 字段与静态字段传播
- 闭包局部变量传播
- 回调型 source
- `ArgIn` 型 source
- `Map.set` / `Set.add` / `Array.push`
- 基于 PTA 的别名相关节点扩散
- sink 命中后的完整 path 记录

### 10.4 当前求解边界

求解器不会盲目深入所有 SDK 方法体，而是更偏向：

- 跟进项目内真实可分析的方法
- 解析调用参数中携带的 callback

这与 ArkTS 实际代码形态更匹配，也能控制分析成本。

## 11. 输出结构

顶层输出类型在 `src/prototypes.ts` 中定义。最终 JSON 当前主要包含：

- `privacyApiUsages`
- `callChains`
- `multiSourceCollaborations`
- `permissionUsages`
- `taintFlows`
- `statistics`

统计字段为：

- `totalFilesAnalyzed`
- `totalMethodsAnalyzed`
- `totalApisDetected`
- `totalCallChainsBuilt`
- `totalCollaborationsDetected`
- `totalTaintFlows`

## 12. 当前实现边界

按当前代码，应明确以下边界：

1. `callback invoke` 类型只存在于类型定义中，检测器当前不产出。
2. tracer 主流程不默认执行 `verifyCallChain()`。
3. 数据汇聚分析是轻量模式匹配，不等于全程序精确污点。
4. 权限分析只提取声明，不做缺失/冗余审计。
5. HapFlow 是可选阶段，依赖 SDK 和 source/sink 配置。
6. `arkprism.ts` 文件头注释里提到 `--dot-only`，但当前 parser 实际并未实现该参数。

## 13. 总结

当前版本的 ArkPrism 可以概括为：

它以 ArkAnalyzer 的结构化程序表示为底座，先用规则识别隐私 API，再用增强反向调用图恢复入口到 API 的真实执行链，随后补充数据去向、协同行为和权限背景，并在条件允许时运行 HapFlow 做更精确的跨过程污点求解，最终统一输出为 JSON 和 DOT。

