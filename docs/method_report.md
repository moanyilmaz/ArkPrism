# ArkPrism 当前实现报告

本文给出当前主模块的职责划分、输入输出和已知边界，作为维护文档使用。

## 1. 模块总览

| 模块 | 主要职责 | 主要输入 | 主要输出 |
| --- | --- | --- | --- |
| `src/arkprism.ts` | 组织主流程、CLI、结果落盘 | 项目目录、CLI 参数 | `ArkPrismOutput`、JSON、DOT |
| `src/utils.ts` | 构建 Scene、读取规则、文件辅助 | `SceneConfig`、规则文件 | `Scene`、规则对象 |
| `src/apiDetector.ts` | 识别隐私 API / 常量访问 | `ArkFile`、系统包、规则库 | `PrivacyDataApiResult[]` |
| `src/callGraphBuilder.ts` | 构建基础调用图与生命周期边 | `Scene` | `CallGraph` |
| `src/callChainTracer.ts` | 恢复入口到 API 的调用链 | API 命中结果、`Scene`、`CallGraph` | `CallChainResult[]` |
| `src/dataSinkAnalyzer.ts` | 识别数据后续汇点 | API 结果、调用链、`Scene` | `dataSinks` 写回链路 |
| `src/multiSourceAnalyzer.ts` | 识别多类隐私协同 | API 结果、`Scene`、`CallGraph`、调用链 | `MultiSourceCollaboration[]` |
| `src/permissionAnalyzer.ts` | 提取权限声明与理由 | 工程目录 | `PermissionResult[]` |
| `src/hapflowRunner.ts` | 驱动 HapFlow 污点分析 | `Scene`、SDK、source/sink 规则 | `TaintFlowResult[]` |
| `src/dotExporter.ts` | 生成 DOT 图 | `ArkPrismOutput` | DOT 字符串 |

## 2. 主流程现状

当前 `src/arkprism.ts` 的实际流程是：

1. 构建 Scene。
2. 可选加载 SDK。
3. 遍历文件并做 API 检测。
4. 若命中 API，继续做调用图、调用链、sink、多源。
5. 可选做 HapFlow。
6. 做权限提取。
7. 输出 JSON。
8. 可选输出 DOT。

当前 CLI 注释里提到了 `--dot-only`，但 parser 并未真正支持该参数。这是代码注释与实际行为的一个已知不一致点。

## 3. API 检测现状

当前检测器真实支持 4 类结果：

- `direct invoke stmt`
- `direct invoke stmt after assignment`
- `indirect invoke`
- `privacy constants`

类型系统里的 `callback invoke` 目前未被生产代码实际生成。

检测器的有效性依赖两层约束：

1. 当前文件必须真实导入对应系统包。
2. 规则中的命名空间要和 import 使用名对齐。

这也是它相较纯方法名匹配更稳的原因。

## 4. 调用链恢复现状

调用链恢复依赖增强反向图，而不是只依赖基础 `CallGraph`。

当前 tracer 的关键点：

- 用 `FunctionType` 精确补函数参数回调边。
- 用 `%AM` 作为兜底补边。
- 用 `getCallbackMethodFromStmt(...)` 补 ArkUI 事件回调。
- 用 Promise 回调检测补异步链。
- 用可达域内 invoke 扫描补 SDK 终点。

当前 `verifyCallChain(...)` 只是辅助验证能力，不是主流程的一部分。

## 5. 数据汇聚现状

`dataSinkAnalyzer.ts` 当前是轻量策略，不是完整污点框架。

它的边界很明确：

- 能处理赋值变量和同类字段传播。
- 能覆盖网络、存储、界面、日志、返回值等直观汇点。
- 不能替代跨类、跨对象、跨容器的全程序精确传播。

这也是为什么 HapFlow 被保留为可选后续阶段。

## 6. 多源协同现状

当前多源协同按四层策略输出：

1. 同方法
2. 跨方法 LCA
3. 同文件
4. 应用级

风险等级按类别数判定：

- `2 -> low`
- `3 -> medium`
- `>=4 -> high`

这个规则和部分旧文档中的描述不同，维护时必须以当前代码为准。

## 7. 权限分析现状

`permissionAnalyzer.ts` 现在只做：

- `module.json5` 查找
- 权限声明提取
- `$string:xxx` 理由解引用

当前不做：

- 缺失权限判断
- 冗余权限判断
- 调用行为与权限声明的一致性判定

因此权限结果只能被解释为“配置层背景信息”。

## 8. HapFlow 现状

HapFlow 当前由 `runHapflowAnalysis(...)` 驱动，主要步骤是：

1. 懒加载 SDK。
2. 创建 DummyMain。
3. 可选 PTA。
4. 加载 source/sink 规则。
5. IFDS 求解。
6. 转换为 `TaintFlowResult[]`。

当前已实现的主要传播能力包括：

- 参数到形参
- 返回值
- `this` 字段
- 闭包
- 容器
- 别名
- callback 型 source
- `ArgIn` 型 source

它依赖 SDK 和规则配置，因此不是所有运行都会产出 taint flow。

## 9. 输出模型现状

当前输出结构由 `src/prototypes.ts` 统一定义。主结果是：

- `privacyApiUsages`
- `callChains`
- `multiSourceCollaborations`
- `permissionUsages`
- `taintFlows`
- `statistics`

调用链结果里已经包含：

- `controlStructures`
- `sourceSnippets`
- `dataSinks`
- `semanticContext`
- `isAsync`

因此 JSON 报告已经不是单纯的 API 列表，而是多层行为结果。

## 10. 当前最重要的维护注意事项

1. 不要把 `callChainTracer.ts` 与 `multiSourceAnalyzer.ts` 的图构建逻辑混成同一实现。
2. 不要把权限提取写成权限合规审计。
3. 不要把轻量 sink 扫描写成完整污点分析。
4. 不要在文档里继续宣称 `callback invoke` 已实现。
5. 不要在 CLI 文档里保留当前 parser 不支持的参数。

## 11. 总结

当前版本已经形成稳定的主链路：

规则检测负责找到隐私触点，增强调用链负责恢复真实执行上下文，sink 与多源负责补行为解释，权限负责补配置背景，HapFlow 负责在需要时提供更强的跨过程数据流证据。

