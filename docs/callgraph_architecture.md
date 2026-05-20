# ArkPrism 调用图与调用链架构

本文只讨论当前版本的调用图构建和调用链恢复机制。

## 1. 为什么不能只靠原生调用图

ArkAnalyzer 的 RTA/CHA 对普通方法互调有用，但对 ArkTS 真实项目有两个关键缺口：

1. 用户代码到 SDK API 的终点边经常缺失。
2. ArkUI 回调、匿名方法、Promise 回调不会稳定落成完整调用边。

这意味着：如果直接拿原生调用图对隐私 API 反向 BFS，很多真实链路会在以下位置断掉：

- `build()` 中注册事件回调
- `%AM...` 匿名方法
- `then/catch/finally`
- SDK API 终点

## 2. `callGraphBuilder.ts` 的职责

`src/callGraphBuilder.ts` 只负责两件事：

1. 选入口点。
2. 建一张尽可能稳的基础调用图。

它的策略是：

1. 收集交互回调、组件生命周期、应用生命周期、扩展生命周期和初始化方法。
2. 优先调用 `scene.makeCallGraphRTA(entryPoints)`。
3. 失败时退回 `scene.makeCallGraphCHA(entryPoints)`。
4. 额外补生命周期顺序边。

这张图是基础骨架，不是最终链路恢复所依赖的完整图。

## 3. `callChainTracer.ts` 的职责

真正的链路恢复发生在 `src/callChainTracer.ts`。

它不直接相信原生调用图，而是构建一张增强反向调用图 `reverseMap`，然后对每个隐私 API 的 `declaringMethod` 做反向 BFS，找到最近入口。

## 4. 当前 tracer 的边来源

当前 tracer 实际使用这些来源：

### Source 1：原生调用图边

读取 `callGraph.nodesItor()` 和 `getOutgoingEdges()`，这是最可靠的基础边。

### Source 4：函数参数回调边

优先检查调用参数的 `FunctionType`，精确解析回调签名。若失败，再回退到 `%AM...` 名称匹配。

这一层解决的是“回调被当作参数传入，而不是直接 invoke”的场景。

### Source 5：ArkUI 与 Promise 回调边

这一层补：

- `getCallbackMethodFromStmt(...)` 能识别的 ArkUI 事件回调
- `.then()` / `.catch()` / `.finally()` 中的函数回调

### Source 3：可达域内的显式调用扫描

这一步直接扫描可达方法体中的 `invokeExpr.getMethodSignature()`，为 SDK 终点和漏边方法补全反向映射。

它不是全量暴力扫描，而是只对“已经从入口可达”的方法继续展开。

## 5. 为什么 tracer 不再单独用 CHA 补边

代码和实验结论是一致的：在调用链 tracer 中，单独的 CHA 补边已经移除，因为 Source 3 的可达域 invoke 扫描已经覆盖掉其主要收益。

换句话说：

- CHA 仍可以作为基础调用图的 fallback。
- 但 tracer 自己不再把 CHA 当成一层额外补边来源。

## 6. Reachability Pruning

当前 tracer 的一个关键设计是 reachability pruning。

它的步骤是：

1. 以入口方法、`%dflt`、`[static]%dflt`、`initialRender` 为种子。
2. 先通过已有边做一次正向 BFS。
3. 得到初始可达集后，再对这些方法执行 Source 3 扫描。
4. 扫描中若发现新方法或 `%AM` 回调，再继续迭代，直到收敛。

这样做有两个直接收益：

1. 把大量不可达、废弃、实验代码挡在图外。
2. 仍然能把真实路径上的 SDK 终点补回来。

## 7. 入口识别

tracer 判断入口时，不只看显式交互或生命周期方法，还把这些方法视作根：

- `ENTRY_METHOD_NAMES` 中的方法
- `%dflt`
- `[static]%dflt`
- `initialRender`

这保证了模块级初始化与页面初始化逻辑不会被错误排除。

## 8. 调用类型标注

当前 `determineCallType(...)` 的标注是轻量的：

- callee 名中包含 `%AM` 时视作 `callback`
- 生命周期名视作 `lifecycle_implicit`
- 其它默认视作 `direct`

类型系统里还保留了 `instance_invoke`、`static_invoke` 等枚举，但当前 tracer 的主要输出仍以这三类为主。

## 9. 后验验证的地位

`verifyCallChain(...)` 已经实现，但当前主流程默认不调用。它更适合作为：

- 测试阶段的验证器
- 精度实验脚本的辅助工具
- 离线人工核对前的二次过滤

它的验证依据包括：

- 调用者方法体中是否真实 invoke 到目标
- 参数里是否有 `FunctionType` 指向目标
- IR 文本里是否引用了目标 `%AM`
- 原生调用图是否已有这条边

## 10. 与多源协同图的关系

`multiSourceAnalyzer.ts` 自己也会构建一套路径图，用于找 LCA、向上找 entry、向下找 source 分支。它的图来源和 tracer 不完全一致：

- tracer：S1 + S4 + S5 + S3，可达域剪枝，不再单独用 S2
- multi-source：内置 CG + CHA + invoke 扫描 + `%AM` + `getCallbackMethodFromStmt`

文档更新时必须区分这两个模块，不能把它们混写成同一套实现。

## 11. 结论

当前版本的调用图架构可以理解为两层：

1. `callGraphBuilder.ts` 提供基础骨架。
2. `callChainTracer.ts` 在骨架上做回调补边、Promise 补边、SDK 终点补边和可达域剪枝，最终恢复可解释的入口到 API 调用链。

这也是 ArkPrism 相比“只扫 API、只跑原生调用图”的核心差异。

