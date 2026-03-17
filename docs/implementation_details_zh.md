# ArkPrism 实现细节文档

> ArkPrism: ArkTS 隐私敏感 API 识别与信息流子图映射

本文档详细介绍 ArkPrism 的架构设计、各模块实现细节、ArkAnalyzer API 使用方式及输出格式。

---

## 目录

1. [整体架构](#1-整体架构)
2. [ArkAnalyzer 集成清单](#2-arkanalyzer-集成清单)
3. [Layer 2: 隐私 API 检测](#3-layer-2-隐私-api-检测)
4. [Layer 3: 调用图构建](#4-layer-3-调用图构建)
5. [Layer 4: 调用链追踪](#5-layer-4-调用链追踪)
6. [Layer 5a: 数据汇点分析](#6-layer-5a-数据汇点分析)
7. [Layer 5b: 多源协作检测](#7-layer-5b-多源协作检测)
8. [权限分析](#8-权限分析)
9. [语义上下文](#9-语义上下文)
10. [DOT 可视化](#10-dot-可视化)
11. [类型系统](#11-类型系统)
12. [输出格式](#12-输出格式)
13. [配置文件](#13-配置文件)

---

## 1. 整体架构

ArkPrism 采用分层流水线架构，每一层消费上一层的输出，并产生结构化结果传递给下一层。

整个分析流程由 CLI 入口 `arkprism.ts` 驱动，支持三种运行模式（单项目分析、批量分析、配置文件模式）。主分析流水线如下：

1. **Layer 1: 场景构建** — 读取项目源码，依次调用 `SceneConfig` → `buildBasicInfo()` → `buildScene4HarmonyProject()` → `inferTypes()`，构建 ArkAnalyzer 分析场景。
2. **Layer 2: 隐私 API 检测**（`apiDetector.ts`）— 使用四种检测模式对 IR 进行规则匹配，输出 `PrivacyDataApiResult[]`。
3. **Layer 3: 调用图构建**（`callGraphBuilder.ts`）— 基于 RTA/CHA/PTA 算法构建调用图，并补充生命周期隐式边。
4. **Layer 4: 调用链追踪**（`callChainTracer.ts`）— 从敏感 API 出发，通过反向 BFS 追踪到入口方法，同时提取控制流信息和语义上下文，输出 `CallChainResult[]`。
5. **Layer 5a: 数据汇点分析**（`dataSinkAnalyzer.ts`）— 基于 Def-Use 链追踪隐私数据的流向，输出 `DataSinkInfo[]`。
6. **Layer 5b: 多源协作检测**（`multiSourceAnalyzer.ts`）— 检测多个隐私 API 的组合使用，计算 LCA 并构建协作子图，输出 `MultiSourceCollaboration[]`。

Layer 5a 和 Layer 5b 并行执行，两者的结果最终汇聚至输出层，生成 JSON 报告和 DOT 可视化文件（`dotExporter.ts`）。

此外，`permissionAnalyzer.ts` 作为独立的旁路模块，从 `module.json5` 中提取权限声明信息，与主流水线的 API 检测结果交叉对照。

**数据流向**：每一层的输出作为下一层的输入。API 检测结果被所有下游层共享。

---

## 2. ArkAnalyzer 集成清单

### 已使用的核心 API

| API / 类型 | 使用位置 | 用途 |
|------------|---------|------|
| `SceneConfig` | arkprism.ts | 项目配置构建 |
| `SceneConfig.buildFromProjectDir()` | arkprism.ts | 从目录自动生成配置 |
| `Scene` | utils.ts, 全局 | 分析场景核心对象 |
| `Scene.buildBasicInfo()` | utils.ts | 构建基础 IR 信息 |
| `Scene.buildScene4HarmonyProject()` | utils.ts | 鸿蒙项目特化构建 |
| `Scene.inferTypes()` | utils.ts | 类型推断 |
| `Scene.getFiles()` | arkprism.ts | 获取所有源文件 |
| `Scene.getMethods()` | callGraphBuilder.ts | 遍历所有方法 |
| `Scene.makeCallGraphRTA()` | callGraphBuilder.ts | RTA 调用图构建 |
| `Scene.makeCallGraphCHA()` | callGraphBuilder.ts | CHA 调用图（回退方案） |
| `CallGraph` | callGraphBuilder.ts, callChainTracer.ts | 调用图对象 |
| `CallGraph.getNodeNum()` | callGraphBuilder.ts | 节点数量 |
| `CallGraph.nodesItor()` | callChainTracer.ts | 遍历所有节点 |
| `CallGraph.getOutgoingEdges()` | callChainTracer.ts | 获取出边 |
| `CallGraph.getCallGraphNodeByMethod()` | callGraphBuilder.ts | 按方法查找节点 |
| `CallGraph.getCallEdgeByPair()` | callGraphBuilder.ts | 检查边是否存在 |
| `CallGraph.addDirectOrSpecialCallEdge()` | callGraphBuilder.ts | 添加生命周期隐式边 |
| `CallGraphNode` | callChainTracer.ts | 调用图节点 |
| `ClassHierarchyAnalysis` | callChainTracer.ts, multiSourceAnalyzer.ts | CHA 虚调用解析 |
| `DominanceFinder` | callChainTracer.ts | 支配树计算 |
| `DominanceTree` | callChainTracer.ts | 支配关系查询 |
| `ArkMethod` | 全局 | 方法对象 |
| `ArkMethod.getBody()` | callChainTracer.ts, dataSinkAnalyzer.ts | 获取方法体 |
| `ArkMethod.getBody().getCfg()` | 多处 | 获取控制流图 |
| `ArkMethod.getSignature()` | callGraphBuilder.ts | 方法签名 |
| `ArkMethod.getDeclaringArkClass()` | dataSinkAnalyzer.ts | 获取所属类 |
| `ArkFile` | apiDetector.ts | 文件对象 |
| `ArkFile.getClasses()` | apiDetector.ts | 获取类列表 |
| `ArkFile.getImportInfos()` | utils.ts | 获取 import 信息 |
| `ArkClass` | apiDetector.ts | 类对象 |
| `ArkClass.getMethods()` | apiDetector.ts | 获取方法列表 |
| `Cfg` | apiDetector.ts | 控制流图对象 |
| `Cfg.getStmts()` | 多处 | 获取语句列表 |
| `Cfg.getBlocks()` | callChainTracer.ts | 获取基本块列表 |
| `BasicBlock` | callChainTracer.ts | 基本块 |
| `BasicBlock.getSuccessors()` | callChainTracer.ts | 后继基本块 |
| `BasicBlock.getExceptionalSuccessorBlocks()` | callChainTracer.ts | 异常后继块（try-catch） |
| `BasicBlock.getStmts()` | callChainTracer.ts | 块内语句 |
| `ArkIfStmt` | callChainTracer.ts | if 条件语句 |
| `ArkIfStmt.getConditionExprRef()` | callChainTracer.ts | 获取条件表达式 |
| `ArkInvokeStmt` | apiDetector.ts, callChainTracer.ts | 调用语句 |
| `ArkInvokeStmt.getInvokeExpr()` | apiDetector.ts | 获取调用表达式 |
| `ArkAssignStmt` | apiDetector.ts, dataSinkAnalyzer.ts | 赋值语句 |
| `ArkReturnStmt` | dataSinkAnalyzer.ts | 返回语句 |
| `ArkReturnStmt.getOp()` | dataSinkAnalyzer.ts | 获取返回值 |
| `Stmt.getUses()` | dataSinkAnalyzer.ts, callChainTracer.ts | Def-Use 链：获取使用的值 |
| `Stmt.getLeftOp()` | dataSinkAnalyzer.ts | Def-Use 链：获取被赋值的变量 |
| `Stmt.containsInvokeExpr()` | callChainTracer.ts | 检查是否包含调用 |
| `Stmt.getInvokeExpr()` | callChainTracer.ts | 获取调用表达式 |
| `Stmt.getOriginPositionInfo()` | 多处 | 获取源码位置（行号） |
| `AbstractInvokeExpr` | apiDetector.ts | 调用表达式抽象类 |
| `getCallbackMethodFromStmt()` | callChainTracer.ts, multiSourceAnalyzer.ts | 解析 Promise .then/.catch 回调 |
| `COMPONENT_LIFECYCLE_METHOD_NAME` | callGraphBuilder.ts | 组件生命周期常量（17 个方法） |
| `LIFECYCLE_METHOD_NAME` | callGraphBuilder.ts | UIAbility 生命周期常量（27 个方法） |

### 功能与 API 对应关系

| ArkPrism 功能 | ArkAnalyzer 支撑 |
|--------------|-----------------|
| API 检测 | Cfg → Stmts → ArkInvokeStmt/ArkAssignStmt 模式匹配 |
| 调用图构建 | `makeCallGraphRTA()` + `makeCallGraphCHA()` |
| 反向 BFS | CallGraph.nodesItor() + getOutgoingEdges() 构建反向映射 |
| 控制流分析 | BasicBlock.getSuccessors() + ArkIfStmt + DominanceFinder |
| 数据汇点追踪 | Stmt.getLeftOp() + getUses()（Def-Use 链）+ ArkReturnStmt.getOp() |
| 异步检测 | ArkAwaitExpr constructor name 检查 |
| 回调解析 | getCallbackMethodFromStmt() + %AM 匿名方法模式 |
| 生命周期边 | COMPONENT_LIFECYCLE_METHOD_NAME + LIFECYCLE_METHOD_NAME |
| CHA | ClassHierarchyAnalysis 虚调用解析 |
| 支配树 | DominanceFinder → DominanceTree → getImmediateDominator() |

---

## 3. Layer 2: 隐私 API 检测

**文件**：`apiDetector.ts`（299 行）

### 四种检测模式

**模式 1：直接调用语句**（`ArkInvokeStmt`）
```typescript
// 源码: identifier.getOAID(callback)
// IR:   invokeexpr identifier.getOAID(cb)
```
遍历 CFG 中的 `ArkInvokeStmt`，将方法名与规则库进行匹配。

**模式 2：赋值后调用**（`ArkAssignStmt` + invoke）
```typescript
// 源码: let net = connection.getDefaultNet()
// IR:   net = invokeexpr connection.getDefaultNet()
```
遍历 `ArkAssignStmt`，通过 `containsInvokeExpr()` 检查右侧值。

**模式 3：间接调用**（管理器模式）
```typescript
// 源码: let mgr = pasteboard.getSystemPasteboard()
//       let data = mgr.getData()
```
先检测管理器对象的创建，然后在同一方法内追踪对该对象的方法调用。

**模式 4：隐私常量访问**
```typescript
// 源码: let brand = deviceInfo.brand
// IR:   brand = deviceInfo.brand（字段访问）
```
检查赋值语句右侧是否为 `命名空间.常量` 的形式。

### 规则库（`config/privacy_apis.json`）

```json
{
  "systemPackage": "@ohos.deviceInfo",
  "privacyApis": [
    {
      "directCall": false,
      "namespace": "deviceInfo",
      "method": "brand",
      "profilingCategory": "device_identity.hardware",
      "sensitivityLevel": "low"
    }
  ]
}
```

**20+ 隐私类别**：`device_identity.hardware/software/unique_id/sim/ad_tracking/distributed/screen`、`device_status.battery/sensor`、`network.connectivity/wifi/bluetooth`、`user_data.account/clipboard/sms/contacts`、`user_preference.locale/settings`、`location`、`media.camera/audio`、`app_environment`。

---

## 4. Layer 3: 调用图构建

**文件**：`callGraphBuilder.ts`（180 行）

### 构建策略

调用图分三步构建：

1. **收集入口点**：通过 `Scene.getMethods()` 过滤已知的入口方法名
2. **尝试 RTA 构建**：`scene.makeCallGraphRTA(entryPoints)`
3. **RTA 失败则回退到 CHA**：`scene.makeCallGraphCHA(entryPoints)`
4. **增强**：添加生命周期隐式边

### 入口点识别

使用 ArkAnalyzer 官方常量 + 用户交互回调：

| 优先级 | 类型 | 方法名 |
|--------|------|--------|
| 1 | 用户交互 | `onClick`、`onTouch`、`onChange`、`onSubmit`、`onSelect`、... |
| 2 | 组件生命周期 | `aboutToAppear`、`aboutToDisappear`、`build`、`onPageShow`、`onPageHide`、`onLayout`、`onMeasure`、...（共 17 个） |
| 3 | UIAbility 生命周期 | `onCreate`、`onForeground`、`onBackground`、`onNewWant`、`onBackup`、`onRestore`、...（共 27 个） |
| 4 | 初始化 | `constructor`、`_DEFAULT_ARK_METHOD` |

### 生命周期隐式边

HarmonyOS 框架按固定顺序调用生命周期方法，但 ArkAnalyzer 的调用图不包含这些隐式边。ArkPrism 对其进行补充：

- 组件生命周期：`aboutToAppear` → `build` → `onPageShow` → `onPageHide` → `aboutToDisappear`
- UIAbility 生命周期：`onCreate` → `onWindowStageCreate` → `onForeground` → `onBackground` → `onWindowStageDestroy`

通过 `CallGraph.addDirectOrSpecialCallEdge()` 添加这些边。

---

## 5. Layer 4: 调用链追踪

**文件**：`callChainTracer.ts`（885 行）

### 反向调用映射构建

五种边来源分层叠加，以实现最大覆盖：

1. **内置 CG 边**：`CallGraph.getOutgoingEdges()` 反转为 callee→caller
2. **CHA 虚调用**：语句中的 `containsInvokeExpr()` → CHA 解析实际目标
3. **Invoke 语句扫描**：遍历所有方法的语句，提取直接调用关系
4. **回调参数边**：检测 `%AM` 匿名方法引用模式（ArkUI 组件回调）
5. **getCallbackMethodFromStmt**：解析 Promise `.then()/.catch()` 回调

### BFS 追踪算法

1. 从敏感 API 的声明方法出发
2. 使用反向调用映射进行向上 BFS
3. 在每个节点检查是否为入口方法
   - 若否 → 继续 BFS
   - 若是 → 选择优先级最高的入口
4. 反转路径，得到：`入口 → ... → API`
5. 对路径上的每个方法，提取：控制流结构、源码片段、语义上下文

### 控制流提取

对路径上每个方法的 CFG 进行分析：

- **if 分支**：`ArkIfStmt.getConditionExprRef()` → 条件表达式 + 权限守卫检测
- **支配关系**：`DominanceFinder` → 检查 if 块是否支配 API 调用块
- **try-catch**：`BasicBlock.getExceptionalSuccessorBlocks()` → 异常处理路径
- **循环**：后向边检测（后继块编号 < 当前块编号）
- **分支侧判断**：判定哪个分支包含 API 调用（`true_branch` / `false_branch` / `both`）

### 异步调用检测

在结果组装时，检查 API 声明方法是否包含 `ArkAwaitExpr`：

```typescript
for (let stmt of body.getCfg().getStmts()) {
    let uses = stmt.getUses();
    for (let u of uses) {
        if (u.constructor.name === 'ArkAwaitExpr') {
            result.isAsync = true;
        }
    }
}
```

---

## 6. Layer 5a: 数据汇点分析

**文件**：`dataSinkAnalyzer.ts`（428 行）

### 汇点分类

| 类型 | 匹配模式 | 示例 API |
|------|---------|---------|
| `network` | HTTP/RCP/WebSocket 发送方法 | `request`、`fetch`、`send`、`upload` |
| `storage` | 持久化存储方法 | `preferences.put`、`rdb.insert`、`fs.writeSync` |
| `ui_display` | UI 组件创建/赋值 | `Text.create`、`setText`、`setValue` |
| `log` | 日志输出 | `console.log`、`hilog.info`、`Logger.debug` |
| `data_return` | 方法返回值传出 | `return privacyVariable` |
| `unknown` | 兜底 | — |

### Def-Use 链追踪

使用 ArkAnalyzer 的结构化 API 替代字符串匹配：

```typescript
// 1. 提取被赋值的变量（Stmt.getLeftOp()）
let leftOp = (stmt as ArkAssignStmt).getLeftOp();
trackedVars.push(leftOp.toString());

// 2. 检查后续语句是否使用该变量（Stmt.getUses()）
for (let use of stmt.getUses()) {
    if (trackedVars.includes(use.toString())) {
        // 该变量在此语句中被使用 → 潜在汇点
    }
}
```

### 返回值追踪

```typescript
if (stmt.constructor.name === 'ArkReturnStmt') {
    let returnVal = (stmt as any).getOp();
    if (trackedVars.includes(returnVal.toString())) {
        sinks.push({ sinkType: 'data_return', ... });
    }
}
```

---

## 7. Layer 5b: 多源协作检测

**文件**：`multiSourceAnalyzer.ts`（663 行）

### 核心概念

**多源协作（Multi-Source Collaboration）**：多个不受权限管控的隐私 API 被组合使用，以构建用户画像（如设备指纹）。单个 API（如 `deviceInfo.brand`）风险较低，但将其与 `model`、`serial`、`osVersion` 组合使用，即可唯一标识用户。

### 检测策略

四层递进检测，范围由小到大：

| 策略 | 范围 | 示例 |
|------|------|------|
| `same-method` | 多个 API 在同一方法内调用 | `deviceid()` 调用 12 个设备信息 API |
| `cross-method` | API 分布在不同方法中，通过调用图找到 LCA | `getHardwareInfo()` 和 `getSoftwareInfo()` 都被 `collectDeviceData()` 调用 |
| `per-file` | 同文件内不同方法的 API 聚合 | `DevicePage.ets` 中多个方法访问不同设备 API |
| `application-level` | 跨文件的相同类别 API（兜底策略） | 风险等级 = low |

### LCA（最近公共祖先）计算

```typescript
function findMultiLCA(methodSigs: string[], reverseMap): string | null {
    // 1. 为每个方法构建祖先集合（BFS 向上）
    let ancestorSets = methodSigs.map(sig => buildAncestorSet(sig, reverseMap));
    // 2. 取所有祖先集合的交集
    let common = intersect(ancestorSets);
    // 3. 返回深度最大的公共祖先（最近公共祖先）
    return deepest(common);
}
```

### 子图构建

每个 `MultiSourceCollaboration` 包含 `subgraph` 字段，表示完整的调用结构：

```
Entry: Index.build (component_lifecycle)
  └──[callback]──→ build_callback_0
                      └──[direct]──→ LCA: Index.deviceid
                                      ├──→ deviceInfo.brand [hardware]     ──→ console.log (LOG)
                                      ├──→ deviceInfo.osFullName [software] ──→ console.log (LOG)
                                      └──→ deviceInfo.serial [unique_id]   ──→ console.log (LOG)
```

### 风险评估

| 条件 | 风险等级 |
|------|---------|
| ≥ 3 个不同的隐私类别 | **high**（如 hardware + software + unique_id） |
| 2 个类别 | **medium** |
| 1 个类别 | **low** |

---

## 8. 权限分析

**文件**：`permissionAnalyzer.ts`（约 100 行）

解析项目中 `module.json5` 的 `requestPermissions` 字段。与 API 检测结果交叉对照，可识别：
- 需要权限但未在 `module.json5` 中声明的 API
- 已声明但实际未被使用的权限

---

## 9. 语义上下文

**实现位置**：`callChainTracer.ts`

为每条调用链生成 `SemanticContext`，为下游基于 LLM 的目的分析提供线索：

| 字段 | 提取方式 | 示例 |
|------|---------|------|
| `pageName` | 从文件路径提取 | `"Contact"`（来自 Contact.ets） |
| `componentClass` | 入口方法所属类 | `"SelectContact"` |
| `semanticAnchor` | 调用链中最具语义的非框架方法 | `"SelectContact.chooseContact"` |
| `simplifiedChain` | 解析回调名后的路径 | `"build() → build_cb3() → testSelectContact() → chooseContact()"` |
| `purposeHint` | 综合文本摘要 | `"In Contact.ets, function chooseContact() calls productModel [hardware], data flows to log"` |

**语义锚点选取**：跳过框架方法（`build`、`aboutToAppear`、`%AM*`），选取第一个有语义含义的用户定义方法。

---

## 10. DOT 可视化

**文件**：`dotExporter.ts`（约 310 行）

生成 Graphviz DOT 格式，包含两类子图：

### 单源子图（`cluster_single_*`）

按 `(profilingCategory, entryMethod)` 分组，展示：入口 → 中间节点 → API → 汇点。

### 多源子图（`cluster_multi_*`）

展示完整的多源协作结构，使用专属节点样式：

| 节点类型 | 形状 | 颜色 |
|---------|------|------|
| 入口 | 矩形（粗边框） | 绿色 `#D5E8D4` |
| LCA | 六角形（粗边框） | 金色 `#FFF9C4` |
| API（源） | 矩形 | 红色 `#FFE6E6` |
| 中间节点 | 矩形 | 蓝色 `#DAE8FC` |
| 汇点 | 圆角矩形 | 橙色 `#FFF3E0` |

子图边框颜色反映风险等级：红色 = high，橙色 = medium，绿色 = low。

---

## 11. 类型系统

**文件**：`prototypes.ts`（212 行）

```typescript
// Layer 2
interface PrivacyDataApiResult     // API 检测结果
interface PrivacyPackageInfo       // 规则包定义
interface ImportEntryCheckUnit     // 检测单元

// Layer 3-4
interface CallChainLink            // 调用链中的一条边
interface ControlStructureInfo     // 控制流信息
interface SourceSnippetInfo        // 源码片段
interface SemanticContext          // 语义上下文（供 LLM 分析）
interface CallChainResult          // 完整调用链结果（含 isAsync）

// Layer 5
interface DataSinkInfo             // 数据汇点（含 data_return 类型）
interface MultiSourceBranch        // 多源子图中的一条分支
interface MultiSourceSubgraph      // 完整多源子图
interface MultiSourceCollaboration // 多源协作结果

// 输出
interface ArkPrismOutput           // 顶层输出容器
```

---

## 12. 输出格式

### JSON 报告（`*-arkprism-report.json`）

```json
{
    "projectName": "STUFFS_NEXT-master",
    "analysisTimestamp": "2026-02-28T08:50:00",
    "privacyApiUsages": [
        {
            "category": "privacy constants",
            "apiPackage": "@ohos.deviceInfo",
            "namespace": "deviceInfo",
            "method": "brand",
            "profilingCategory": "device_identity.hardware",
            "file": "entry/src/main/ets/pages/deviceid.ets",
            "declaringMethod": "Index.deviceid()",
            "line": 5,
            "code": "brand = deviceInfo.brand"
        }
    ],
    "callChains": [
        {
            "apiUsageIndex": 0,
            "entryMethod": { "name": "Index.build", "type": "component_lifecycle" },
            "chain": [
                { "caller": "Index.build", "callee": "Index.%AM0$build", "callType": "callback" },
                { "caller": "Index.%AM0$build", "callee": "Index.deviceid", "callType": "direct" }
            ],
            "controlStructures": [],
            "dataSinks": [ { "sinkType": "log", "sinkApi": "console.log" } ],
            "semanticContext": {
                "pageName": "deviceid",
                "semanticAnchor": "Index.deviceid",
                "purposeHint": "calls brand [device_identity.hardware], data flows to log"
            },
            "isAsync": false
        }
    ],
    "multiSourceCollaborations": [
        {
            "strategy": "same-method",
            "lcaMethod": "Index.deviceid",
            "riskLevel": "high",
            "categories": ["device_identity.hardware", "device_identity.software", "device_identity.unique_id"],
            "apis": [ "..." ],
            "subgraph": {
                "entry": { "name": "Index.build", "type": "component_lifecycle" },
                "entryToLca": [ "..." ],
                "branches": [
                    { "api": "deviceInfo.brand", "category": "...", "lcaToSource": [], "sinks": ["..."] }
                ]
            }
        }
    ],
    "permissionUsages": [ "..." ],
    "statistics": {
        "totalFilesAnalyzed": 29,
        "totalMethodsAnalyzed": 366,
        "totalApisDetected": 47,
        "totalCallChainsBuilt": 47,
        "totalCollaborationsDetected": 3
    }
}
```

---

## 13. 配置文件

### `config/privacy_apis.json`

隐私 API 规则库，每条规则包含：

| 字段 | 类型 | 说明 |
|------|------|------|
| `systemPackage` | string | HarmonyOS SDK 包名（如 `@ohos.deviceInfo`） |
| `privacyApis[].directCall` | boolean/null | true = 直接调用，false = 常量访问，null = 两者 |
| `privacyApis[].namespace` | string | 导入后的命名空间（如 `deviceInfo`） |
| `privacyApis[].method` | string | 方法/属性名（如 `brand`） |
| `privacyApis[].permission` | string? | 所需权限（如 `ohos.permission.GET_WIFI_INFO`） |
| `privacyApis[].profilingCategory` | string | 隐私类别（如 `device_identity.hardware`） |

### `config/system_packages14.json`

HarmonyOS API 14 系统包完整列表，用于区分 import 语句中的系统包与第三方包。
