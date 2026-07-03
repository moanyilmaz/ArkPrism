# ArkPrism

> HarmonyOS ArkTS 隐私敏感 API 识别与信息流子图映射工具

静态分析工具，通过多层级分析检测 HarmonyOS 应用中的隐私数据泄露风险。

---

## 核心架构

ArkPrism 采用 **六层分析架构**：

```
┌─────────────────────────────────────────────────────────────────┐
│                    ArkPrism 分析流程                            │
├─────────────────────────────────────────────────────────────────┤
│ Layer 1: 隐私 API 检测 (apiDetector.ts)                         │
│   - 四种模式匹配：直接调用、间接调用、常量访问、属性访问          │
│   - 输出: 隐私 API 调用位置                                      │
├─────────────────────────────────────────────────────────────────┤
│ Layer 2: 调用链构建 (callChainTracer.ts)                        │
│   - 三源逆向调用图 + ArkUI 回调边                                │
│   - 输出: API → UI 组件的调用路径                                │
├─────────────────────────────────────────────────────────────────┤
│ Layer 3: 数据 Sink 检测 (dataSinkAnalyzer.ts)                   │
│   - 检测网络、存储、日志、UI、Intent 等敏感操作                  │
│   - 输出: 数据可能泄露的终点                                      │
├─────────────────────────────────────────────────────────────────┤
│ Layer 4: 语义增强 (semanticEnricher.ts)                         │
│   - 变量名分析、条件判断识别                                      │
│   - 输出: 上下文语义信息                                          │
├─────────────────────────────────────────────────────────────────┤
│ Layer 5: 污点分析 (HapFlow)                                      │
│   - IFDS 算法 + 回调数据流追踪                                   │
│   - 输出: 隐私数据从 source 到 sink 的完整路径                   │
├─────────────────────────────────────────────────────────────────┤
│ Layer 6: 协同行为检测 (multiSourceAnalyzer.ts)                  │
│   - 跨多个隐私 API 的协作行为识别                                │
│   - 输出: 隐私数据组合分析                                        │
└─────────────────────────────────────────────────────────────────┘
```

---

## 安装

```bash
npm install
```

---

## 使用

### 基本用法

```bash
# 分析单个项目
npx ts-node src/arkprism.ts ./project

# 使用已编译的 JavaScript
node --max-old-space-size=4096 dist/arkprism.js ./project

# 指定 OpenHarmony SDK
node dist/arkprism.js ./project --sdkPath /path/to/sdk

# 跳过污点分析（更快，但不检测数据流）
node dist/arkprism.js ./project --no-taint

# 跳过指针分析（更快，精度降低）
node dist/arkprism.js ./project --no-pta

# 批量分析数据集
node dist/arkprism.js --batch ./dataset
```

### 输出

分析完成后会在 `out/{project_name}/` 目录下生成：

- `{project}-arkprism-report.json` - 完整分析报告
- `{project}-privacy-graph.dot` - 隐私数据流图

---

## 核心方法思路

### 1. 隐私 API 检测 (apiDetector.ts)

检测四类隐私 API 调用模式：

| 模式 | 示例 | 检测方法 |
|------|------|---------|
| 直接调用 | `pasteboard.getSystemPasteboard()` | AST 遍历 |
| 间接调用 | `mgr.getData()` (mgr from namespace) | 类型推断 + 方法名匹配 |
| 回调模式 | `getData((err, data) => {...})` | 参数回调检测 |
| 属性访问 | `deviceInfo.deviceType` | FieldRef 检测 |

**关键 API**:
- `checkDirectCallPrivacyApis()` - 检测直接调用
- `checkIndirectCallPrivacyApis()` - 检测间接调用（instance method）
- `checkCallbackPrivacyApis()` - 检测回调风格 API
- `checkPrivacyConstantUsages()` - 检测属性访问

### 2. 调用链构建 (callChainTracer.ts)

构建从隐私 API 到 UI 组件的调用链：

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│  隐私 API   │ ──> │  中间方法    │ ──> │  UI 组件    │
│ 位置信息    │     │  调用关系    │     │  aboutToAppear/onClick │
└─────────────┘     └─────────────┘     └─────────────┘
```

**三源调用图**:
1. **内置 CG 边** - ArkAnalyzer 生成的标准调用图
2. **CHA 解析边** - 类层次分析推断的调用关系
3. **补充调用边** - ArkUI 回调参数边

**关键 API**:
- `buildCallChainsFromApiUsage()` - 从 API 使用点构建调用链
- `resolveCallbackMethod()` - 解析回调方法
- `findArkUIEntry()` - 找到 ArkUI 组件入口

### 3. 数据 Sink 检测 (dataSinkAnalyzer.ts)

识别数据可能泄露的终点：

| Sink 类型 | 示例 | 风险等级 |
|-----------|------|---------|
| network | `http.createHttp()` | 高 |
| storage | `fileIO.write()` | 高 |
| log | `hilog.info()` / `console.log()` | 中 |
| ui_display | `promptAction.showToast()` | 低 |
| intent | `wantAgent.startAbility()` | 中 |
| share | `share.select()` | 高 |

**关键 API**:
- `scanMethodForSinks()` - 扫描方法中的 sink 调用
- `isSensitiveSink()` - 判断是否为敏感 sink

### 4. 污点分析 - HapFlow (hapflow/)

基于 IFDS (Interprocedural Data Flow Analysis) 算法的数据流追踪。

#### 4.1 IFDS 算法 (DataflowSolver.ts)

IFDS 是一种精确的过程间数据流分析算法，通过图可达性解决数据流问题。

```
问题：找到所有从 Source 到 Sink 的路径

IFDS 解决方案：
1. 构建 Supergraph（包含所有方法和调用边）
2. 从 entry point 开始
3. 使用 flow functions 传播污点
4. 达到 Sink 时记录数据流
```

**关键类**:
- `TaintAnalysisChecker` - 问题定义
- `TaintAnalysisSolver` - IFDS 求解器
- `DataflowSolver` - 基础求解器框架

#### 4.2 回调数据流追踪 (TaintAnalysis.ts)

处理 HarmonyOS SDK 的两种异步模式：

**Promise 模式**:
```typescript
// HapFlow 自动追踪
selectContacts().then((info) => {
    hilog.info('联系人: ' + info.name);  // 污点从 info 流向 hilog.info
});
```

**回调函数模式**:
```typescript
// HapFlow 识别回调参数
pasteboard.getData((err, pasteData) => {
    let text = pasteData.getPrimaryText();  // pasteData 是污点源
    hilog.info('剪贴板: ' + text);  // 污点从 text 流向 hilog.info
});
```

**关键方法**:
- `analyzeCallbackDataFlows()` - 分析所有回调数据流
- `processThenCallback()` - 处理 Promise.then() 回调
- `analyzeCallbackSource()` - 分析回调风格 source API
- `traceCallbackParamDataFlow()` - 追踪回调参数数据流

#### 4.3 闭包处理 (Util.ts)

处理 ArkTS 闭包变量：

```typescript
// 闭包变量可能是 ClosureFieldRef，需要解析其实际值
const resolvedParam = resolveClosureVariable(param, callbackMethod);
```

**关键函数**:
- `resolveClosureVariable()` - 解析闭包变量
- `getResolvedCallbackParameters()` - 获取解析后的回调参数

### 5. 协同行为检测 (multiSourceAnalyzer.ts)

识别跨多个隐私 API 的组合行为：

```typescript
// 协同行为示例：位置 + 设备 ID 同时被收集
location.getCurrentLocation() + deviceInfo.deviceId
// 可能用于：用户画像、设备指纹
```

**检测逻辑**:
1. 按 profiling category 分组隐私 API
2. 检测同一组件中多个类别的使用
3. 识别隐私数据组合风险

---

## 配置

### 隐私 API 规则

- `config/privacy_apis.json` - 隐私 API 定义
- `config/hapflow_sources.json` - IFDS source 定义
- `config/hapflow_sinks.json` - IFDS sink 定义
- `config/data_sinks.json` - 数据泄露 sink 定义

### OpenHarmony SDK

工具依赖 OpenHarmony SDK 进行类型推断：

```
--sdkPath 默认值: OPENHARMONY_SDK_PATH or E:/OpenHarmony_SDK/20/ets
```

---

## 大型项目支持

为避免大型项目（1000+ 方法）的 OOM 问题，HapFlow 实现了智能限制：

| 限制项 | 默认值 | 说明 |
|--------|--------|------|
| MAX_METHODS_TO_SCAN | 500 | 回调分析扫描的方法数上限 |
| MAX_SOURCES_TO_ANALYZE | 50 | 源 API 分析数量上限 |

**为什么这样设计安全？**

1. 隐私 API 主要集中在 UI 页面（deviceid.ets, batteryInfo.ets 等）
2. ArkAnalyzer 按文件顺序枚举方法，UI 页面通常在前
3. API 检测层（Layer 1）不受限制，100% 召回

**实测结果**:
- legado-Harmony-main (3576 方法): 60 APIs 检测，44 有数据流 (73% 召回)
- harmonyos-games-main: 56 APIs 检测，40 有数据流 (71.4% 召回)

---

## 性能优化

| 技术 | 效果 |
|------|------|
| --no-pta | 跳过指针分析，速度提升约 30% |
| --no-taint | 跳过污点分析，速度提升约 50% |
| MAX_METHODS_TO_SCAN | 限制大型项目扫描范围 |
| LightTaintAnalysis | 轻量级数据流分析（可选） |

---

## 项目结构

```
Argus/
├── src/
│   ├── arkprism.ts              # 主入口
│   ├── apiDetector.ts           # Layer 1: 隐私 API 检测
│   ├── callChainTracer.ts       # Layer 2: 调用链构建
│   ├── dataSinkAnalyzer.ts      # Layer 3: Sink 检测
│   ├── semanticEnricher.ts      # Layer 4: 语义增强
│   ├── multiSourceAnalyzer.ts   # Layer 6: 协同行为检测
│   ├── hapflow/                 # IFDS 污点分析
│   │   ├── TaintAnalysis.ts     # 核心分析逻辑
│   │   ├── TaintAnalysisSolver.ts
│   │   ├── DataflowSolver.ts    # IFDS 算法实现
│   │   ├── TaintFact.ts         # 污点事实
│   │   ├── LightTaintAnalysis.ts # 轻量级分析
│   │   └── Util.ts              # 辅助函数
│   ├── arkanalyzer/             # ArkAnalyzer 封装
│   └── prototypes.ts            # 类型定义
├── config/
│   ├── privacy_apis.json        # 隐私 API 规则
│   ├── hapflow_sources.json     # IFDS source
│   ├── hapflow_sinks.json       # IFDS sink
│   └── data_sinks.json          # 数据泄露 sink
├── dist/                        # 编译输出
└── out/                         # 分析结果
```

---

## 术语表

| 术语 | 说明 |
|------|------|
| IFDS | Interprocedural Data Flow Analysis，过程间数据流分析 |
| Source | 隐私数据源头，如 `getCurrentLocation()` |
| Sink | 数据泄露终点，如 `http.post()` |
| Taint | 污点，被追踪的敏感数据 |
| Callback | 回调函数，异步编程模式 |
| Closure | 闭包，捕获外部变量的函数 |
| ArkTS | HarmonyOS 的 TypeScript 超集 |
| CFG | Control Flow Graph，控制流图 |
| PTA | Pointer Analysis，指针分析 |
| CHA | Class Hierarchy Analysis，类层次分析 |

---

## 许可

MIT License