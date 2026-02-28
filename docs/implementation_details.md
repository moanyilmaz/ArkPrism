# ArkPrism Implementation Details

> ArkPrism: ArkTS **Pr**ivacy-sensitive API **R**ecognition and **I**nformation-flow **S**ubgraph **M**apping

This document provides a comprehensive guide to ArkPrism's architecture, module-level implementation details, ArkAnalyzer API usage, and output formats.

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [ArkAnalyzer Integration](#2-arkanalyzer-integration)
3. [Layer 2: Privacy API Detection](#3-layer-2-privacy-api-detection)
4. [Layer 3: Call Graph Construction](#4-layer-3-call-graph-construction)
5. [Layer 4: Call Chain Tracing](#5-layer-4-call-chain-tracing)
6. [Layer 5a: Data Sink Analysis](#6-layer-5a-data-sink-analysis)
7. [Layer 5b: Multi-Source Collaboration Detection](#7-layer-5b-multi-source-collaboration-detection)
8. [Permission Analysis](#8-permission-analysis)
9. [Semantic Context](#9-semantic-context)
10. [DOT Visualization](#10-dot-visualization)
11. [Type System](#11-type-system)
12. [Output Format](#12-output-format)
13. [Configuration Files](#13-configuration-files)

---

## 1. Architecture Overview

ArkPrism follows a layered pipeline architecture. Each layer consumes previous layers' output and produces structured results for the next.

![ArkPrism Architecture](../img/pipeline.png)

**Data flow**: Each layer's output feeds into subsequent layers. API detection results are shared across all downstream layers.

---

## 2. ArkAnalyzer Integration

### Core APIs Used

| API / Type | Used In | Purpose |
|------------|---------|---------|
| `SceneConfig` | arkprism.ts | Project configuration |
| `SceneConfig.buildFromProjectDir()` | arkprism.ts | Auto-generate config from directory |
| `Scene` | utils.ts, global | Core analysis scene object |
| `Scene.buildBasicInfo()` | utils.ts | Build basic IR information |
| `Scene.buildScene4HarmonyProject()` | utils.ts | HarmonyOS-specific scene construction |
| `Scene.inferTypes()` | utils.ts | Type inference |
| `Scene.getFiles()` | arkprism.ts | Retrieve all source files |
| `Scene.getMethods()` | callGraphBuilder.ts | Iterate all methods |
| `Scene.makeCallGraphRTA()` | callGraphBuilder.ts | RTA call graph construction |
| `Scene.makeCallGraphCHA()` | callGraphBuilder.ts | CHA call graph (fallback) |
| `CallGraph` | callGraphBuilder.ts, callChainTracer.ts | Call graph object |
| `CallGraph.getNodeNum()` | callGraphBuilder.ts | Node count |
| `CallGraph.nodesItor()` | callChainTracer.ts | Iterate all nodes |
| `CallGraph.getOutgoingEdges()` | callChainTracer.ts | Get outgoing edges |
| `CallGraph.getCallGraphNodeByMethod()` | callGraphBuilder.ts | Find node by method |
| `CallGraph.getCallEdgeByPair()` | callGraphBuilder.ts | Check if edge exists |
| `CallGraph.addDirectOrSpecialCallEdge()` | callGraphBuilder.ts | Add lifecycle edges |
| `CallGraphNode` | callChainTracer.ts | Call graph node |
| `ClassHierarchyAnalysis` | callChainTracer.ts, multiSourceAnalyzer.ts | CHA virtual call resolution |
| `DominanceFinder` | callChainTracer.ts | Dominance tree computation |
| `DominanceTree` | callChainTracer.ts | Dominance relationship queries |
| `ArkMethod` | global | Method object |
| `ArkMethod.getBody()` | callChainTracer.ts, dataSinkAnalyzer.ts | Get method body |
| `ArkMethod.getBody().getCfg()` | multiple | Get control flow graph |
| `ArkMethod.getSignature()` | callGraphBuilder.ts | Method signature |
| `ArkMethod.getDeclaringArkClass()` | dataSinkAnalyzer.ts | Get declaring class |
| `ArkFile` | apiDetector.ts | File object |
| `ArkFile.getClasses()` | apiDetector.ts | Get class list |
| `ArkFile.getImportInfos()` | utils.ts | Get import information |
| `ArkClass` | apiDetector.ts | Class object |
| `ArkClass.getMethods()` | apiDetector.ts | Get method list |
| `Cfg` | apiDetector.ts | Control flow graph |
| `Cfg.getStmts()` | multiple | Get statement list |
| `Cfg.getBlocks()` | callChainTracer.ts | Get basic blocks |
| `BasicBlock` | callChainTracer.ts | Basic block |
| `BasicBlock.getSuccessors()` | callChainTracer.ts | Successor blocks |
| `BasicBlock.getExceptionalSuccessorBlocks()` | callChainTracer.ts | Exception successor blocks (try-catch) |
| `BasicBlock.getStmts()` | callChainTracer.ts | Statements in block |
| `ArkIfStmt` | callChainTracer.ts | If-condition statement |
| `ArkIfStmt.getConditionExprRef()` | callChainTracer.ts | Get condition expression |
| `ArkInvokeStmt` | apiDetector.ts, callChainTracer.ts | Invocation statement |
| `ArkInvokeStmt.getInvokeExpr()` | apiDetector.ts | Get invoke expression |
| `ArkAssignStmt` | apiDetector.ts, dataSinkAnalyzer.ts | Assignment statement |
| `ArkReturnStmt` | dataSinkAnalyzer.ts | Return statement |
| `ArkReturnStmt.getOp()` | dataSinkAnalyzer.ts | Get return value |
| `Stmt.getUses()` | dataSinkAnalyzer.ts, callChainTracer.ts | Def-Use chain: get used values |
| `Stmt.getLeftOp()` | dataSinkAnalyzer.ts | Def-Use chain: get defined variable |
| `Stmt.containsInvokeExpr()` | callChainTracer.ts | Check for invocation |
| `Stmt.getInvokeExpr()` | callChainTracer.ts | Get invoke expression |
| `Stmt.getOriginPositionInfo()` | multiple | Get source location (line number) |
| `AbstractInvokeExpr` | apiDetector.ts | Abstract invoke expression |
| `getCallbackMethodFromStmt()` | callChainTracer.ts, multiSourceAnalyzer.ts | Resolve Promise .then/.catch callbacks |
| `COMPONENT_LIFECYCLE_METHOD_NAME` | callGraphBuilder.ts | Component lifecycle constants (17 methods) |
| `LIFECYCLE_METHOD_NAME` | callGraphBuilder.ts | UIAbility lifecycle constants (27 methods) |

### Feature-to-API Mapping

| ArkPrism Feature | ArkAnalyzer Support |
|-----------------|---------------------|
| API detection | Cfg → Stmts → ArkInvokeStmt/ArkAssignStmt pattern matching |
| Call graph construction | `makeCallGraphRTA()` + `makeCallGraphCHA()` |
| Backward BFS | CallGraph.nodesItor() + getOutgoingEdges() to build reverse map |
| Control flow analysis | BasicBlock.getSuccessors() + ArkIfStmt + DominanceFinder |
| Data sink tracking | Stmt.getLeftOp() + getUses() (Def-Use chains) + ArkReturnStmt.getOp() |
| Async detection | ArkAwaitExpr constructor name check |
| Callback resolution | getCallbackMethodFromStmt() + %AM anonymous method pattern |
| Lifecycle edges | COMPONENT_LIFECYCLE_METHOD_NAME + LIFECYCLE_METHOD_NAME |
| CHA | ClassHierarchyAnalysis virtual call resolution |
| Dominance tree | DominanceFinder → DominanceTree → getImmediateDominator() |

---

## 3. Layer 2: Privacy API Detection

**File**: `apiDetector.ts` (299 lines)

### Four Detection Patterns

**Pattern 1: Direct invoke statement** (`ArkInvokeStmt`)
```typescript
// Source: identifier.getOAID(callback)
// IR:     invokeexpr identifier.getOAID(cb)
```
Iterates `ArkInvokeStmt` nodes in CFG, matching method names against the rule database.

**Pattern 2: Invoke after assignment** (`ArkAssignStmt` + invoke)
```typescript
// Source: let net = connection.getDefaultNet()
// IR:     net = invokeexpr connection.getDefaultNet()
```
Iterates `ArkAssignStmt` nodes, checks right-hand side via `containsInvokeExpr()`.

**Pattern 3: Indirect invoke** (manager pattern)
```typescript
// Source: let mgr = pasteboard.getSystemPasteboard()
//         let data = mgr.getData()
```
First detects manager object creation, then tracks method calls on that object within the same method.

**Pattern 4: Privacy constant access**
```typescript
// Source: let brand = deviceInfo.brand
// IR:     brand = deviceInfo.brand (field access)
```
Checks assignment right-hand side for `namespace.constant` patterns.

### Rule Database (`config/privacy_apis.json`)

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

**20+ privacy categories**: `device_identity.hardware/software/unique_id/sim/ad_tracking/distributed/screen`, `device_status.battery/sensor`, `network.connectivity/wifi/bluetooth`, `user_data.account/clipboard/sms/contacts`, `user_preference.locale/settings`, `location`, `media.camera/audio`, `app_environment`.

---

## 4. Layer 3: Call Graph Construction

**File**: `callGraphBuilder.ts` (180 lines)

### Construction Strategy

The call graph is built in three steps:

1. **Collect entry points** by filtering `Scene.getMethods()` against known entry method names
2. **Attempt RTA construction**: `scene.makeCallGraphRTA(entryPoints)`
3. **Fall back to CHA** if RTA fails: `scene.makeCallGraphCHA(entryPoints)`
4. **Augment** with lifecycle implicit edges

### Entry Point Identification

Uses official ArkAnalyzer constants plus user interaction callbacks:

| Priority | Type | Methods |
|----------|------|---------|
| 1 | User interaction | `onClick`, `onTouch`, `onChange`, `onSubmit`, `onSelect`, ... |
| 2 | Component lifecycle | `aboutToAppear`, `aboutToDisappear`, `build`, `onPageShow`, `onPageHide`, `onLayout`, `onMeasure`, ... (17 total) |
| 3 | UIAbility lifecycle | `onCreate`, `onForeground`, `onBackground`, `onNewWant`, `onBackup`, `onRestore`, ... (27 total) |
| 4 | Initialization | `constructor`, `_DEFAULT_ARK_METHOD` |

### Lifecycle Implicit Edges

The HarmonyOS framework calls lifecycle methods in a fixed order, but ArkAnalyzer's call graph doesn't include these implicit edges. ArkPrism supplements them:

- Component lifecycle: `aboutToAppear` → `build` → `onPageShow` → `onPageHide` → `aboutToDisappear`
- UIAbility lifecycle: `onCreate` → `onWindowStageCreate` → `onForeground` → `onBackground` → `onWindowStageDestroy`

These edges are added via `CallGraph.addDirectOrSpecialCallEdge()`.

---

## 5. Layer 4: Call Chain Tracing

**File**: `callChainTracer.ts` (885 lines)

### Reverse Call Map Construction

Five edge sources are layered for maximum coverage:

1. **Built-in CG edges**: `CallGraph.getOutgoingEdges()` reversed to callee→caller
2. **CHA virtual calls**: `containsInvokeExpr()` in statements → CHA resolves actual targets
3. **Invoke statement scan**: Iterates all method statements, extracts direct call relationships
4. **Callback parameter edges**: Detects `%AM` anonymous method reference patterns (ArkUI component callbacks)
5. **getCallbackMethodFromStmt**: Resolves Promise `.then()/.catch()` callbacks

### BFS Tracing Algorithm

1. Start at the sensitive API's declaring method
2. BFS upward using the reverse call map
3. At each node, check if it is an entry method
   - If not → continue BFS
   - If yes → select the highest-priority entry
4. Reverse the path to get: `entry → ... → API`
5. For each method on the path, extract: control structures, source snippets, and semantic context

### Control Flow Extraction

For each method's CFG on the path:

- **if-branches**: `ArkIfStmt.getConditionExprRef()` → condition expression + permission guard detection
- **Dominance**: `DominanceFinder` → checks whether the if-block dominates the API call block
- **try-catch**: `BasicBlock.getExceptionalSuccessorBlocks()` → exception handling paths
- **Loops**: Back-edge detection (successor block index < current block)
- **Branch side**: Determines which branch contains the API call (`true_branch` / `false_branch` / `both`)

### Async Call Detection

During result assembly, checks whether the API's declaring method contains `ArkAwaitExpr`:

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

## 6. Layer 5a: Data Sink Analysis

**File**: `dataSinkAnalyzer.ts` (428 lines)

### Sink Classification

| Type | Match Pattern | Example APIs |
|------|---------------|--------------|
| `network` | HTTP/RCP/WebSocket send methods | `request`, `fetch`, `send`, `upload` |
| `storage` | Persistent storage methods | `preferences.put`, `rdb.insert`, `fs.writeSync` |
| `ui_display` | UI component creation/assignment | `Text.create`, `setText`, `setValue` |
| `log` | Logging output | `console.log`, `hilog.info`, `Logger.debug` |
| `data_return` | Method return value propagation | `return privacyVariable` |
| `unknown` | Fallback | — |

### Def-Use Chain Tracking

Uses ArkAnalyzer's structured APIs instead of string matching:

```typescript
// 1. Extract the assigned variable (Stmt.getLeftOp())
let leftOp = (stmt as ArkAssignStmt).getLeftOp();
trackedVars.push(leftOp.toString());

// 2. Check if subsequent statements use that variable (Stmt.getUses())
for (let use of stmt.getUses()) {
    if (trackedVars.includes(use.toString())) {
        // This variable is used in this statement → potential sink
    }
}
```

### Return Value Tracking

```typescript
if (stmt.constructor.name === 'ArkReturnStmt') {
    let returnVal = (stmt as any).getOp();
    if (trackedVars.includes(returnVal.toString())) {
        sinks.push({ sinkType: 'data_return', ... });
    }
}
```

---

## 7. Layer 5b: Multi-Source Collaboration Detection

**File**: `multiSourceAnalyzer.ts` (663 lines)

### Core Concept

**Multi-source collaboration**: Multiple non-permission-gated privacy APIs are used together to build a user profile (e.g., device fingerprinting). A single API like `deviceInfo.brand` is low-risk, but combining it with `model`, `serial`, and `osVersion` can uniquely identify a user.

### Detection Strategies

Four progressively broader strategies:

| Strategy | Scope | Example |
|----------|-------|---------|
| `same-method` | Multiple APIs called within the same method | `deviceid()` calls 12 device info APIs |
| `cross-method` | APIs across methods sharing an LCA in the call graph | `getHardwareInfo()` and `getSoftwareInfo()` both called from `collectDeviceData()` |
| `per-file` | APIs aggregated at the file level | Different methods in `DevicePage.ets` accessing various device APIs |
| `application-level` | Same-category APIs across files (fallback) | risk = low |

### LCA (Lowest Common Ancestor) Computation

```typescript
function findMultiLCA(methodSigs: string[], reverseMap): string | null {
    // 1. Build ancestor sets for each method (BFS upward)
    let ancestorSets = methodSigs.map(sig => buildAncestorSet(sig, reverseMap));
    // 2. Intersect all ancestor sets
    let common = intersect(ancestorSets);
    // 3. Return the deepest common ancestor (nearest LCA)
    return deepest(common);
}
```

### Subgraph Construction

Each `MultiSourceCollaboration` includes a `subgraph` field representing the complete call structure:

```
Entry: Index.build (component_lifecycle)
  └──[callback]──→ build_callback_0
                      └──[direct]──→ LCA: Index.deviceid
                                      ├──→ deviceInfo.brand [hardware]     ──→ console.log (LOG)
                                      ├──→ deviceInfo.osFullName [software] ──→ console.log (LOG)
                                      └──→ deviceInfo.serial [unique_id]   ──→ console.log (LOG)
```

### Risk Assessment

| Condition | Risk Level |
|-----------|-----------|
| ≥ 3 distinct privacy categories | **high** (e.g., hardware + software + unique_id) |
| 2 categories | **medium** |
| 1 category | **low** |

---

## 8. Permission Analysis

**File**: `permissionAnalyzer.ts` (~100 lines)

Parses `requestPermissions` from `module.json5` files in the project. Cross-references with API detection results to identify:
- APIs that require permissions not declared in `module.json5`
- Declared permissions that are never actually used

---

## 9. Semantic Context

**Implemented in**: `callChainTracer.ts`

Generates a `SemanticContext` for each call chain, providing hints for downstream LLM-based purpose analysis:

| Field | Extraction Method | Example |
|-------|-------------------|---------|
| `pageName` | Extracted from file path | `"Contact"` (from Contact.ets) |
| `componentClass` | Entry method's declaring class | `"SelectContact"` |
| `semanticAnchor` | Most semantically meaningful non-framework method in the chain | `"SelectContact.chooseContact"` |
| `simplifiedChain` | Path with resolved callback names | `"build() → build_cb3() → testSelectContact() → chooseContact()"` |
| `purposeHint` | Synthesized text summary | `"In Contact.ets, function chooseContact() calls productModel [hardware], data flows to log"` |

**Semantic anchor selection**: Skips framework methods (`build`, `aboutToAppear`, `%AM*`) and picks the first user-defined method with meaningful naming.

---

## 10. DOT Visualization

**File**: `dotExporter.ts` (~310 lines)

Generates Graphviz DOT format with two types of subgraphs:

### Single-Source Subgraphs (`cluster_single_*`)

Grouped by `(profilingCategory, entryMethod)`, showing: entry → intermediates → API → sinks.

### Multi-Source Subgraphs (`cluster_multi_*`)

Visualizes the complete multi-source collaboration structure with dedicated node styles:

| Node Type | Shape | Color |
|-----------|-------|-------|
| Entry | Rectangle (bold) | Green `#D5E8D4` |
| LCA | Hexagon (bold) | Gold `#FFF9C4` |
| API (source) | Rectangle | Red `#FFE6E6` |
| Internal | Rectangle | Blue `#DAE8FC` |
| Sink | Rounded rectangle | Orange `#FFF3E0` |

Subgraph border color reflects risk level: red = high, orange = medium, green = low.

---

## 11. Type System

**File**: `prototypes.ts` (212 lines)

```typescript
// Layer 2
interface PrivacyDataApiResult     // API detection result
interface PrivacyPackageInfo       // Rule package definition
interface ImportEntryCheckUnit     // Detection unit

// Layer 3-4
interface CallChainLink            // A single edge in a call chain
interface ControlStructureInfo     // Control flow information
interface SourceSnippetInfo        // Source code snippet
interface SemanticContext          // Semantic context for LLM analysis
interface CallChainResult          // Complete call chain result (includes isAsync)

// Layer 5
interface DataSinkInfo             // Data sink (includes data_return type)
interface MultiSourceBranch        // A branch in the multi-source subgraph
interface MultiSourceSubgraph      // Complete multi-source subgraph
interface MultiSourceCollaboration // Multi-source collaboration result

// Output
interface ArkPrismOutput           // Top-level output container
```

---

## 12. Output Format

### JSON Report (`*-arkprism-report.json`)

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

## 13. Configuration Files

### `config/privacy_apis.json`

Privacy API rule database. Each rule contains:

| Field | Type | Description |
|-------|------|-------------|
| `systemPackage` | string | HarmonyOS SDK package name (e.g., `@ohos.deviceInfo`) |
| `privacyApis[].directCall` | boolean/null | true = direct call, false = constant access, null = both |
| `privacyApis[].namespace` | string | Imported namespace (e.g., `deviceInfo`) |
| `privacyApis[].method` | string | Method/property name (e.g., `brand`) |
| `privacyApis[].permission` | string? | Required permission (e.g., `ohos.permission.GET_WIFI_INFO`) |
| `privacyApis[].profilingCategory` | string | Privacy category (e.g., `device_identity.hardware`) |

### `config/system_packages14.json`

Complete list of HarmonyOS API 14 system packages, used to distinguish system imports from third-party packages.
