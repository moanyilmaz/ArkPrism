# ArkPrism 实现细节（归档副本）

本文件是 `docs/implementation_details_zh.md` 的归档副本，内容按当前代码实现同步更新，用于保留实现说明的历史快照。

## 1. 当前分析主线

ArkPrism 当前按以下主线执行：

1. 建立 ArkAnalyzer `Scene`
2. 读取隐私规则和系统包
3. 检测隐私 API / 常量访问
4. 构建基础调用图
5. 用增强反向图恢复入口到 API 的调用链
6. 扫描数据汇聚点
7. 检测多源协同
8. 提取权限声明
9. 可选执行 HapFlow IFDS 污点分析
10. 输出 JSON 和 DOT

## 2. 与旧版说明相比，当前需要特别注意的更新点

1. `callChainTracer.ts` 里的主要补边来源是 S1、S4、S5、S3，旧版单独 S2 CHA 补边已移除。
2. `multiSourceAnalyzer.ts` 自己的路径图仍保留 CHA，因此不能把它和 tracer 的实现写成同一套。
3. 权限分析当前只提取 `module.json5` 中的声明与理由，不做缺失/冗余校验。
4. `callback invoke` 仍只是类型定义保留项，检测器当前不产出此类结果。
5. 多源风险分级当前是 `2 -> low`、`3 -> medium`、`>=4 -> high`。
6. CLI 实际支持 `--batch`、`--config`、`--output-dir`、`--no-dot`、`--no-taint`、`--no-pta`、`--sdkPath`。

## 3. 关键模块职责

- `src/apiDetector.ts`
  识别直接调用、赋值调用、间接调用、隐私常量访问。
- `src/callGraphBuilder.ts`
  构建 RTA/CHA 基础调用图，并补生命周期隐式边。
- `src/callChainTracer.ts`
  通过回调补边、Promise 补边和可达域 invoke 扫描恢复完整调用链。
- `src/dataSinkAnalyzer.ts`
  识别网络、存储、界面、日志、返回值等轻量 sink。
- `src/multiSourceAnalyzer.ts`
  检测同方法、跨方法 LCA、同文件、应用级的多源协同行为。
- `src/permissionAnalyzer.ts`
  提取权限声明及 `$string:xxx` 资源理由。
- `src/hapflowRunner.ts`
  驱动 HapFlow IFDS 污点分析。

## 4. 当前实现边界

1. 主流程不默认调用 `verifyCallChain()`。
2. 数据汇聚分析不是完整污点分析。
3. 权限分析不是权限合规审计。
4. HapFlow 依赖 SDK 与 source/sink 配置。

## 5. 归档说明

若需要完整技术细节，以 `docs/implementation_details_zh.md` 为主；本文件保留相同实现口径的归档副本。

