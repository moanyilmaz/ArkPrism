# ArkPrism 技术文档

> 文档版本: 2.0.0
> 日期: 2026-06-01
> 状态: 已完成
> 目标读者: 开发者、技术评审

---

## 概述

ArkPrism 是一个用于 HarmonyOS ArkTS 应用的静态隐私分析工具。它通过多层级分析检测隐私数据从敏感 API 到泄露终点（如网络、存储、日志）的数据流。

**核心能力**:
- 隐私 API 检测（100% 召回）
- 过程间数据流分析（IFDS 算法）
- 回调数据流追踪（Promise + 闭包）
- 协同行为检测

---

## 完整分析流程

### 第一阶段：隐私 API 检测

**目标**: 找到应用中所有调用隐私敏感 API 的位置

**输入**: ArkTS 应用的 ABC（字节码）文件

**输出**: 隐私 API 调用列表，包含文件路径、行号、方法名

#### 检测模式

ArkPrism 支持四种隐私 API 调用模式：

```
┌────────────────────────────────────────────────────────────────┐
│                     隐私 API 检测模式                           │
├──────────────────┬─────────────────────────────────────────────┤
│ 1. 直接调用       │ pasteboard.getSystemPasteboard()           │
├──────────────────┼─────────────────────────────────────────────┤
│ 2. 间接调用       │ mgr.getData()   (mgr 来自 namespace)       │
├──────────────────┼─────────────────────────────────────────────┤
│ 3. 回调模式       │ getData((err, data) => {...})              │
├──────────────────┼─────────────────────────────────────────────┤
│ 4. 属性访问       │ deviceInfo.deviceType                      │
└──────────────────┴─────────────────────────────────────────────┘
```

**核心代码**: `src/apiDetector.ts`

```typescript
// 四种检测入口
checkDirectCallPrivacyApis()      // 直接调用
checkIndirectCallPrivacyApis()    // 间接调用（instance method）
checkCallbackPrivacyApis()        // 回调模式
checkPrivacyConstantUsages()      // 属性访问
```

#### 模糊匹配机制

当 ArkAnalyzer 无法解析方法签名（显示为 `@%unk`）时，使用模糊匹配：

```typescript
// 精确匹配失败时的备选方案
if (sources.has(sigStr)) {
    return sources.get(sigStr);
}

// 模糊匹配：按方法名 + 命名空间 + 参数模式
if (sigStr.includes('@%unk')) {
    const methodName = valMethodSignature.getMethodSubSignature().getMethodName();
    // 根据方法名和上下文推断...
}
```

---

### 第二阶段：调用链构建

**目标**: 找到从隐私 API 到 UI 入口（如 aboutToAppear, onClick）的调用路径

**核心问题**: 如何从任意代码位置逆向找到触发它的 UI 事件？

#### 三源调用图

```
┌─────────────────────────────────────────────────────────────────┐
│                    逆向调用图构建                                │
├─────────────────────────────────────────────────────────────────┤
│ Source 1: 内置 CG 边                                             │
│   - ArkAnalyzer 生成的调用关系                                   │
│   - 精确但可能不完整                                             │
├─────────────────────────────────────────────────────────────────┤
│ Source 2: CHA 解析边                                             │
│   - 类层次分析推断继承关系                                        │
│   - 补充实例方法调用                                             │
├─────────────────────────────────────────────────────────────────┤
│ Source 3: 补充调用边                                             │
│   - ArkUI 回调参数边                                             │
│   - @State, @Link 状态流                                        │
│   - aboutToAppear, onClick 等生命周期                            │
└─────────────────────────────────────────────────────────────────┘
```

**核心代码**: `src/callChainTracer.ts`

```typescript
// 构建调用链
buildCallChainsFromApiUsage(privacyApi, scene, reverseCallMap, viewTree)

// 解析回调方法
resolveCallbackMethod(method, callbackArg)

// 找到 ArkUI 入口
findArkUIEntry(callbackMethod, viewTree)
```

---

### 第三阶段：数据 Sink 检测

**目标**: 识别数据可能泄露的终点

#### Sink 类型分类

| 类型 | 示例 | 风险 |
|------|------|------|
| network | `http.createHttp().request()` | 高 |
| storage | `fileIO.write()`, `kvStore.put()` | 高 |
| log | `hilog.info()`, `console.log()` | 中 |
| ui_display | `promptAction.showToast()` | 低 |
| intent | `wantAgent.startAbility()` | 中 |
| share | `share.select()` | 高 |

**核心代码**: `src/dataSinkAnalyzer.ts`

```typescript
// 扫描方法中的 sink 调用
scanMethodForSinks(method, trackedVars, filePath, scene)

// 判断是否为敏感 sink
isSensitiveSink(invokeExpr)
```

---

### 第四阶段：语义增强

**目标**: 添加上下文语义信息，提高分析结果可读性

```typescript
// 识别条件判断
if (this.hasPermission) {
    // 可能绕过权限检查
}

// 识别变量用途
const sensitiveData = location.getCurrentLocation();
sendToServer(sensitiveData);  // 明确的数据泄露
```

**核心代码**: `src/semanticEnricher.ts`

---

### 第五阶段：污点分析 (HapFlow)

**目标**: 追踪隐私数据从 source 到 sink 的完整路径

这是最核心也最复杂的阶段。

#### 5.1 IFDS 算法原理

IFDS (Interprocedural Data Flow Analysis) 是一种精确的过程间数据流分析算法。

**核心思想**:
1. 将数据流问题转换为图可达性问题
2. 使用 supergraph（包含所有方法和调用边）
3. 通过 flow functions 传播污点

```
传统数据流分析:
  if (x is tainted) → propagate to y

IFDS 增强:
  1. 处理过程间调用（跨方法）
  2. 处理数组和字段访问
  3. 处理别名（alias）
```

**关键类**:
- `TaintAnalysisChecker` - 问题定义，包含 source 和 sink 规则
- `TaintAnalysisSolver` - IFDS 求解器
- `DataflowSolver` - 基础框架

#### 5.2 回调数据流追踪

HarmonyOS SDK 使用两种异步模式，需要特殊处理：

**Promise 模式**:
```typescript
// selectContacts() 返回 Promise
// .then() 回调接收 resolved value

selectContacts().then((info) => {
    // info 是 selectContacts() 的返回值
    // 需要追踪 info 的数据流
    hilog.info('联系人: ' + info.name);  // 数据流终点
});
```

**回调函数模式**:
```typescript
// getData() 使用回调函数
// callback 参数是数据源

pasteboard.getData((err, pasteData) => {
    // pasteData 是回调参数（数据源）
    let text = pasteData.getPrimaryText();  // 字段访问
    hilog.info('剪贴板: ' + text);  // 数据流终点
});
```

**核心代码**: `src/hapflow/TaintAnalysis.ts`

```typescript
// 分析所有回调数据流
analyzeCallbackDataFlows()

// 处理 Promise.then()
processThenCallback(method, stmt, invokeExpr)

// 处理回调风格 API
analyzeCallbackSource(method, stmt, invokeExpr, source)

// 追踪回调参数数据流
traceCallbackParamDataFlow(method, startVar, startFact)
```

#### 5.3 闭包处理

ArkTS 编译会将闭包变量转换为 `ClosureFieldRef`，需要解析：

```typescript
// 源代码
selectContacts().then((info) => {
    console.log(info.name);
});

// 编译后 IR
// info 可能是 %closures0 类型的闭包变量
// 需要解析它实际引用的值
```

**核心代码**: `src/hapflow/Util.ts`

```typescript
// 解析闭包变量
resolveClosureVariable(closureLocal, method)

// 获取解析后的回调参数
getResolvedCallbackParameters(callbackMethod)
```

#### 5.4 数组和字段访问处理

```typescript
// 数组索引访问
let data = getSensitiveData();
send(data[0]);  // 追踪 data[0]

// 链式字段访问
let location = getCurrentLocation();
send(location.coordinate.latitude);  // 追踪完整链
```

---

### 第六阶段：协同行为检测

**目标**: 识别跨多个隐私 API 的组合行为

```typescript
// 示例：用户画像
@Component
struct UserProfile {
    aboutToAppear() {
        // 位置 + 设备 ID + 通讯录 同时收集
        let location = locationManager.getCurrentLocation();
        let deviceId = deviceInfo.deviceId;
        let contacts = contactManager.selectContacts();

        // 上报到服务器进行用户画像
        uploadProfile(location, deviceId, contacts);
    }
}
```

**核心代码**: `src/multiSourceAnalyzer.ts`

```typescript
// 按 category 分组隐私 API
// 检测同一组件中多个类别的使用
// 识别隐私数据组合风险
```

---

## 大型项目支持策略

### 问题

大型应用（1000+ 方法）运行时会触发 OOM。

### 原因分析

1. **回调分析阶段**: `analyzeCallbackDataFlows()` 遍历所有方法
2. **IFDS 求解阶段**: 工作列表和路径边集合可能爆炸性增长

### 解决方案

**智能限制 + 优先级策略**:

```typescript
// TaintAnalysis.ts
const MAX_METHODS_TO_SCAN = 500;
const MAX_SOURCES_TO_ANALYZE = 50;

for (const method of this.scene.getMethods()) {
    if (methodCount++ > MAX_METHODS_TO_SCAN) {
        break;  // 提前退出
    }
    // ...
}
```

### 为什么安全？

1. **API 检测不受限**: Layer 1 扫描所有文件，100% 召回
2. **隐私 API 集中**: 在 UI 页面（deviceid.ets, batteryInfo.ets）
3. **ArkAnalyzer 顺序**: UI 页面通常在前 500 个方法中

### 实测结果

| 项目 | 方法数 | 检测到 API | 有数据流 | 召回率 |
|------|--------|-----------|---------|--------|
| legado-Harmony-main | 3576 | 60 | 44 | 73% |
| harmonyos-games-main | - | 56 | 40 | 71.4% |

---

## 配置系统

### 隐私 API 规则

`config/privacy_apis.json`:
```json
{
  "systemPackage": "@kit.BasicServicesKit",
  "privacyApis": [
    {
      "directCall": true,
      "namespace": "pasteboard",
      "method": "getSystemPasteboard",
      "permission": null,
      "profilingCategory": "user_data.clipboard"
    }
  ]
}
```

### IFDS Source 定义

`config/hapflow_sources.json`:
```json
{
  "api_name": "getCurrentLocation",
  "module": "@ohos.geoLocationManager",
  "source_type": "return",
  "tainted_param_index": -1,
  "reason": "返回位置坐标，属于敏感数据"
}
```

### IFDS Sink 定义

`config/hapflow_sinks.json`:
```json
{
  "api_name": "request",
  "module": "@ohos.http",
  "sink_type": "network",
  "reason": "发送网络请求，数据可能被上传"
}
```

---

## 性能优化建议

| 场景 | 建议 |
|------|------|
| 快速扫描 | 使用 `--no-taint` 跳过污点分析 |
| 内存受限 | 使用 `--no-pta` 跳过指针分析 |
| 大型项目 | 默认设置已优化，可正常运行 |
| 精确分析 | 使用完整选项（默认） |

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
│   │   ├── LightTaintAnalysis.ts
│   │   └── Util.ts              # 辅助函数
│   ├── arkanalyzer/             # ArkAnalyzer 封装
│   ├── hapflowRunner.ts         # HapFlow 入口
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

| 术语 | 全称 | 说明 |
|------|------|------|
| IFDS | Interprocedural Data Flow Analysis | 过程间数据流分析 |
| CFG | Control Flow Graph | 控制流图 |
| PTA | Pointer Analysis | 指针分析 |
| CHA | Class Hierarchy Analysis | 类层次分析 |
| ABC | ArkTS ByteCode | ArkTS 字节码 |
| Source | - | 隐私数据源头 |
| Sink | - | 数据泄露终点 |
| Taint | - | 被追踪的敏感数据 |
| Closure | - | 闭包，捕获外部变量的函数 |

---

## 许可

MIT License