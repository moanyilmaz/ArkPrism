# ArkPrism

ArkPrism 是一个面向 HarmonyOS ArkTS 应用的静态隐私分析工具。它基于仓库内集成的 ArkAnalyzer 构建，目标不是只统计“调用了哪些隐私 API”，而是恢复一条完整的隐私行为链：

- 从哪个页面、生命周期或交互入口触发
- 中间经过哪些业务方法、匿名回调或 Promise 回调
- 最终命中了哪些隐私 API / 隐私常量
- 返回数据是否继续流向网络、存储、界面、日志或返回值
- 是否存在多类隐私数据的协同行为
- 在可选条件下，是否存在更精确的过程间污点传播路径

## 1. 当前能力

- 隐私 API / 隐私常量检测
- HarmonyOS 生命周期感知的调用图构建
- 匿名回调、ArkUI 回调、Promise 回调补边
- 入口到隐私 API 的调用链恢复
- 条件分支、循环、异常结构抽取
- 轻量数据汇聚分析
- 多源协同画像检测
- 权限声明与理由提取
- HapFlow IFDS 污点分析
- JSON 报告与 DOT 图导出

## 2. 仓库重点

核心入口和主模块：

- `src/arkprism.ts`
  CLI 入口，组织完整分析流程。
- `src/apiDetector.ts`
  规则驱动的隐私 API / 常量检测。
- `src/callGraphBuilder.ts`
  基础调用图构建与生命周期隐式边补充。
- `src/callChainTracer.ts`
  通过增强反向图恢复入口到 API 的调用链。
- `src/dataSinkAnalyzer.ts`
  检测网络、存储、界面、日志、返回值等汇点。
- `src/multiSourceAnalyzer.ts`
  检测多类隐私数据的协同行为。
- `src/permissionAnalyzer.ts`
  解析 `module.json5` 权限声明与理由。
- `src/hapflowRunner.ts`
  驱动 HapFlow IFDS 污点分析。
- `src/hapflow/`
  HapFlow 的问题定义、求解器和辅助工具。
- `config/privacy_apis.json`
  隐私 API 规则库。
- `config/hapflow_sources.json`
  HapFlow source 规则。
- `config/hapflow_sinks.json`
  HapFlow sink 规则。
- `config/system_packages14.json`
  系统包白名单。

补充文档放在 `docs/`，但当前维护重点是本 README。

## 3. 环境依赖

### 必需依赖

- Node.js 16 及以上
- npm 8 及以上

当前 `package.json` 依赖如下：

- 运行时依赖：
  - `commander`
  - `json5`
  - `log4js`
  - `ohos-typescript`
- 开发依赖：
  - `typescript`
  - `ts-node`
  - `@types/node`

### 条件依赖

- OpenHarmony SDK
  - 对基础分析不是绝对必需，但强烈建议提供。
  - 对 HapFlow 污点分析是必需的。
  - 当前代码默认 SDK 路径是：
    - `E:/OpenHarmony_SDK/20/ets`

### 可选依赖

- Graphviz
  - ArkPrism 只输出 `.dot` 文件，不直接渲染图片。
  - 如果你要把 DOT 转成 PNG / SVG，需要本机额外安装 Graphviz。

## 4. 安装

```bash
git clone https://github.com/moanyilmaz/ArkPrism.git
cd ArkPrism
npm install
```

如果你只做 TypeScript 构建，也可以执行：

```bash
npm run build
```

## 5. 被分析项目的前提

ArkPrism 预期输入是一个可被 ArkAnalyzer 解析的 HarmonyOS ArkTS 工程目录。实践中至少应满足：

- 包含 `.ets` / `.ts` 业务源码
- 项目结构接近标准 HarmonyOS 工程布局
- `module.json5` 等配置文件存在时可被正常读取

ArkPrism 会自动跳过这些目录中的文件：

- `build`
- `cache`
- `node_modules`
- `oh_modules`
- `.preview`

## 6. SDK 如何配置

### 方式一：使用默认路径

如果你的 SDK 就在下面这个目录，不需要额外参数：

```text
E:/OpenHarmony_SDK/20/ets
```

### 方式二：通过命令行显式指定

```bash
npx ts-node src/arkprism.ts --sdkPath E:/OpenHarmony_SDK/20/ets <project-directory>
```

或：

```bash
npm run analyze -- --sdkPath E:/OpenHarmony_SDK/20/ets <project-directory>
```

### SDK 在当前实现中的作用

SDK 主要影响这几件事：

1. 解析系统 API 签名
2. 改善用户代码到 SDK API 的终点识别
3. 让 HapFlow 能把 source / sink JSON 规则解析成真实方法签名

如果没有 SDK：

- 基础规则检测仍可能运行
- 但 HapFlow 会直接跳过
- 某些依赖 SDK 签名恢复的能力会下降

## 7. 运行方式

### 单项目分析

```bash
npx ts-node src/arkprism.ts <project-directory>
```

示例：

```bash
npx ts-node src/arkprism.ts E:/Projects/ARGUS/dataset/Wechat_HarmonyOS
```

### 批量分析

```bash
npx ts-node src/arkprism.ts --batch <dataset-directory>
```

示例：

```bash
npx ts-node src/arkprism.ts --batch E:/Projects/ARGUS/dataset
```

### 指定输出目录

```bash
npx ts-node src/arkprism.ts --output-dir E:/Projects/ARGUS/out-custom <project-directory>
```

### 关闭 DOT 导出

```bash
npx ts-node src/arkprism.ts --no-dot <project-directory>
```

### 关闭 HapFlow

```bash
npx ts-node src/arkprism.ts --no-taint <project-directory>
```

### 关闭指针分析

```bash
npx ts-node src/arkprism.ts --no-pta <project-directory>
```

说明：

- `--no-pta` 只影响 HapFlow 阶段。
- 当前 parser 实际支持的参数是：
  - `--batch`
  - `--config`
  - `--output-dir`
  - `--no-dot`
  - `--no-taint`
  - `--no-pta`
  - `--sdkPath`
- 文件头注释里曾提到 `--dot-only`，但当前代码并未实现该参数。

## 8. 输出内容

默认输出目录是：

```text
out/<project-name>/
```

每个项目通常会生成：

- `*-arkprism-report.json`
  - 完整分析结果
- `*-privacy-graph.dot`
  - Graphviz DOT 图

JSON 报告主要包含：

- `privacyApiUsages`
- `callChains`
- `multiSourceCollaborations`
- `permissionUsages`
- `taintFlows`
- `statistics`

统计字段包括：

- `totalFilesAnalyzed`
- `totalMethodsAnalyzed`
- `totalApisDetected`
- `totalCallChainsBuilt`
- `totalCollaborationsDetected`
- `totalTaintFlows`

## 9. 分析流程说明

### 9.1 Scene 构建

ArkPrism 先调用 ArkAnalyzer 构建 `Scene`，再执行类型推断。若提供 SDK，还会额外调用 `scene.buildSdk('@ohosSdk', sdkPath)` 把系统声明加载进场景。

### 9.2 隐私 API 检测

检测器按文件导入信息过滤规则库，当前支持：

- 直接调用
- 赋值中的调用
- 间接调用
- 隐私常量访问

### 9.3 调用图构建

调用图优先用 RTA 构建，失败时退回 CHA，再补生命周期隐式边。

### 9.4 调用链恢复

ArkPrism 的关键点不在基础调用图，而在增强反向图。当前主要补边来源包括：

- 原生调用图边
- `FunctionType` 回调边
- `%AM` 匿名方法兜底匹配
- ArkUI 事件回调
- Promise 回调
- 可达域内显式 `invoke` 扫描

### 9.5 数据汇聚分析

当前实现会检查隐私 API 返回值是否继续流向：

- 网络
- 存储
- 界面
- 日志
- 返回值

### 9.6 多源协同

当前检测四种层次：

- 同方法
- 跨方法 LCA
- 同文件
- 应用级

风险等级当前按类别数计算：

- 2 类：`low`
- 3 类：`medium`
- 4 类及以上：`high`

### 9.7 权限分析

当前权限分析只提取：

- `module.json5` 中的 `requestPermissions`
- 权限理由
- `$string:xxx` 资源引用

它目前不做缺失权限或冗余权限的自动审计。

### 9.8 HapFlow 污点分析

HapFlow 会：

1. 懒加载 SDK
2. 创建 DummyMain
3. 可选做指针分析
4. 加载 source / sink 规则
5. 用 IFDS 求解跨过程污点传播

它依赖：

- `config/hapflow_sources.json`
- `config/hapflow_sinks.json`
- 可用的 OpenHarmony SDK

## 10. 配置文件说明

### `config/privacy_apis.json`

定义隐私 API 规则，当前实际会用到：

- 模块 / 命名空间
- 方法名
- `directCall`
- `permission`
- `profilingCategory`
- `ohos_module`

### `config/system_packages14.json`

定义允许参与系统导入匹配的包集合。

### `config/hapflow_sources.json`

定义哪些 API 是 taint source。

### `config/hapflow_sinks.json`

定义哪些 API / 输出点是 taint sink。

## 11. 数据集与仓库管理建议

当前仓库里**不建议**直接把完整数据集、分析输出和临时目录提交到 GitHub。

原因很直接：

1. 数据集体积大，当前外部数据集 `E:/Projects/ARGUS/dataset` 约 1.12 GB。
2. 数据集中包含大量二进制资源，例如视频、音频、图片和构建产物。
3. 这类内容会显著膨胀 Git 历史，拖慢 clone、fetch 和 diff。
4. 数据集中存在不同项目自带的 LICENSE / README，需要单独确认再分发。

### 当前建议

- 本仓库默认**不提交**：
  - `out/`
  - `output/`
  - `.tmp_*`
  - `dataset/`
- 如果确实要公开数据集，建议改为：
  - 单独建立 dataset 仓库
  - 或使用 Git LFS
  - 或只提交经过清洗的最小复现实验子集

### 批量分析的推荐做法

把数据集放在仓库外部目录，例如：

```text
E:/Projects/ARGUS/dataset
```

然后直接：

```bash
npx ts-node src/arkprism.ts --batch E:/Projects/ARGUS/dataset
```

这样既能跑批量分析，又不会把数据集混进代码仓库。

## 12. 当前已知边界

- `callback invoke` 仍只存在于类型定义中，检测器当前不产出。
- `verifyCallChain()` 已实现，但主流程默认不调用。
- 数据汇聚分析是轻量实现，不是完整全程序污点分析。
- 权限分析只做提取，不做合规判定。
- HapFlow 是可选阶段，依赖 SDK 和规则配置。

## 13. 常用命令汇总

安装依赖：

```bash
npm install
```

单项目分析：

```bash
npm run analyze -- E:/path/to/project
```

单项目分析并指定 SDK：

```bash
npm run analyze -- --sdkPath E:/OpenHarmony_SDK/20/ets E:/path/to/project
```

批量分析：

```bash
npm run batch -- E:/Projects/ARGUS/dataset
```

关闭 HapFlow：

```bash
npm run analyze -- --no-taint E:/path/to/project
```

关闭 PTA：

```bash
npm run analyze -- --no-pta E:/path/to/project
```

## 14. 许可证

本仓库代码使用 MIT License。

注意：

- 若你准备单独发布数据集，需要分别确认数据集中每个样本项目的许可证和可再分发性。

