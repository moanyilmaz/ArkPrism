# ArkPrism Sprint Summary

> 文档版本: 1.0.0
> 日期: 2026-05-26
> 状态: 已完成
> 目标读者: 新手开发者

---

## 概述

本次 Sprint 实现了 **HapFlow IFDS 污点分析引擎**的一个关键功能：**回调数据流追踪**。

**什么是数据流追踪？**

简单来说，就是追踪一段数据从"源头"到"终点"的完整路径。

举例说明：
```typescript
// 源头：sensor.on() 会产生数据 (sensor data)
sensor.on(SensorType.SENSOR_TYPE_ID, (data) => {
    // 终点：console.info() 会把数据打印出来
    console.info('X坐标是: ' + data.x);
});
```

我们想要检测的是：**敏感数据是否被泄露到不该去的地方**。

---

## 完成的功能清单

### 功能 1: Promise.then() 回调数据流追踪

#### 这个功能解决什么问题？

```typescript
// 假设 selectContacts() 会返回联系人信息
// 然后通过 .then() 把联系人传给回调函数使用

selectContacts().then((info) => {
    // 问题：info 是从哪里来的？它会流向哪里？
    hilog.info('联系人: ' + info.name);
});
```

原来的分析器会说："找不到数据从哪里来到哪里去"

现在的分析器会说："info 来自 selectContacts() 的返回值，info.name 流向了 hilog.info()"

#### 核心方法详解

**方法名**: `processThenCallback()`

**这个方法是做什么的？**

它的任务是：
1. 找出 `.then()` 回调函数的参数是什么
2. 追踪这个参数的数据流

**输入**:
- `method`: 当前所在的方法（包含 `.then()` 调用的方法）
- `stmt`: `.then()` 这行代码
- `invokeExpr`: `.then()` 表达式本身

**输出**: 无（直接往 `detectOutcome` 里添加检测结果）

**内部逻辑（分步说明）**:

```
第1步：拿到 .then() 的参数
  selectContacts().then(callback↑)
                               ↑ 这个就是回调参数

第2步：看看这个参数是什么类型
  - 如果是 FunctionType，说明是普通函数
  - 如果是 ClosureType，说明是闭包

第3步：找到这个回调函数本身
  通过 FunctionType/ClosureType 里的方法签名，
  在同一个类里找到实际的回调代码

第4步：拿到回调函数的参数列表
  .then((info) => ...) 中 info 就是回调参数

第5步：过滤掉不需要的参数
  有些参数是闭包自动传进来的（如 %closures2）
  这些不是真正的业务参数，需要跳过

第6步：开始追踪
  从真实的回调参数开始，沿着代码往下找
  看它用在哪里，有没有流向敏感的地方
```

**代码示例**:

```typescript
private processThenCallback(method: ArkMethod, stmt: Stmt, invokeExpr: AbstractInvokeExpr): void {
    // 拿到 .then() 的参数，就是那个回调函数
    const callbackArg = args[0];

    // 获取回调参数的类型
    const callbackArgType = callbackArg.getType();

    // 尝试通过 FunctionType 找到回调方法
    let callbackMethod = null;
    if (callbackArgType instanceof FunctionType) {
        const callbackSig = callbackArgType.getMethodSignature();
        callbackMethod = method.getDeclaringArkClass().getMethod(callbackSig);
    }

    // 如果找不到，尝试通过 ClosureType 找
    if (!callbackMethod && callbackArgType.constructor?.name === 'ClosureType') {
        // 从类型字符串里提取方法名
        const match = typeStr.match(/closures:\s*(.+)/);
        // ... 查找逻辑
    }

    if (!callbackMethod) return;

    // 解析回调方法的参数（这里处理了闭包变量）
    const resolvedParams = getResolvedCallbackParameters(callbackMethod);

    // 找到第一个真正的回调参数（跳过 %closures 开头的闭包变量）
    let resolvedParam = null;
    for (const param of resolvedParams) {
        if (param instanceof Local && !param.getName().startsWith('%closures')) {
            resolvedParam = param;
            break;
        }
    }

    // 开始追踪这个参数的数据流
    if (resolvedParam) {
        const fact = new TaintFact(resolvedParam);
        fact.addPath(stmt);
        this.traceCallbackParamDataFlow(callbackMethod, resolvedParam, fact);
    }
}
```

---

### 功能 2: 回调式 API 数据流追踪

#### 这个功能解决什么问题？

有些 API 不是用 `.then()` 的方式，而是用**传入回调函数**的方式：

```typescript
// getData 的第一个参数是回调函数
systemPasteboard.getData((err, pasteData) => {
    // err 是错误信息
    // pasteData 才是我们要的数据
    let text = pasteData.getPrimaryText();
    hilog.info('剪贴板内容: ' + text);
});
```

原来的分析器会漏掉这个场景。

#### 核心方法详解

**方法名**: `analyzeCallbackSource()`

**这个方法是做什么的？**

追踪那种"把回调函数传进去"的数据流

**输入**:
- `method`: 包含 `getData()` 调用的方法
- `stmt`: `getData()` 这行代码
- `invokeExpr`: `getData()` 表达式
- `source`: 关于这是个数据源 API 的信息

**输出**: 无（直接往 `detectOutcome` 里添加检测结果）

**内部逻辑（分步说明）**:

```
第1步：确定回调参数是第几个
  getData(回调函数↑)
               ↑ 第一个参数，索引是 0

第2步：获取回调函数
  拿到 args[0]，就是那个回调函数

第3步：找到回调函数对应的实际代码
  因为回调函数是内联的，需要通过类型信息找到它的实现

第4步：获取回调函数的参数列表
  (err, pasteData) => { ... }
  ↑ err    ↑ pasteData

第5步：跳过错误参数
  err 通常不是我们要追踪的数据
  从 pasteData 开始

第6步：追踪数据流
  从 pasteData 开始，看它怎么被使用
```

**代码示例**:

```typescript
private analyzeCallbackSource(method: ArkMethod, stmt: Stmt,
                               invokeExpr: AbstractInvokeExpr, source: Source): void {
    // 获取参数列表
    const args = invokeExpr.getArgs();

    // 回调参数在第几个位置？source.callbackIndex 告诉我们
    const callbackArg = args[source.callbackIndex];
    const callbackArgType = callbackArg.getType();

    // 找到回调方法
    let callbackMethod = null;
    if (callbackArgType instanceof FunctionType) {
        const callbackSig = callbackArgType.getMethodSignature();
        callbackMethod = method.getDeclaringArkClass().getMethod(callbackSig);
    }

    // 如果没找到，扫描匿名方法
    if (!callbackMethod) {
        callbackMethod = this.findCallbackMethod(method, invokeExpr);
    }

    if (!callbackMethod) return;

    // 获取回调的参数列表
    const paramInstances = callbackMethod.getParameterInstances();
    if (!paramInstances || paramInstances.length === 0) return;

    // 跳过错误参数（通常 err 是第一个）
    let startIndex = 0;
    if (paramInstances.length > 1 &&
        paramInstances[0]?.toString().includes('err')) {
        startIndex = 1;  // 从第二个参数开始
    }

    // 对每个数据参数，追踪它的数据流
    for (let i = startIndex; i < paramInstances.length; i++) {
        const param = paramInstances[i];
        if (param instanceof Local) {
            const fact = new TaintFact(param);
            fact.addPath(stmt);
            this.traceCallbackParamDataFlow(callbackMethod, param, fact);
        }
    }
}
```

---

### 功能 3: 闭包变量解析

#### 这个功能解决什么问题？

闭包是 JavaScript/HarmonyOS 里一个特殊的概念：

```typescript
let name = '张三';

fetchData().then((data) => {
    // 这个回调函数"记住"了外层的 name 变量
    // 在内部，name 可能被表示为 %closures2 这样的变量
    hilog.info(name + ': ' + data);
});
```

问题是：`%closures2` 到底是什么？它和 `name` 是什么关系？

#### 核心函数详解

**函数名**: `isClosureLocal()`

**这个函数是做什么的？**

判断一个变量是不是"闭包变量"

**什么是闭包变量？**

以 `%closures` 开头的变量，就是闭包捕获的外层变量

**输入**: 任意一个值

**输出**: `true` 或 `false`

```typescript
function isClosureLocal(value: Value): boolean {
    // 必须是 Local 类型的变量
    if (!(value instanceof Local)) return false;

    // 变量名以 %closures 开头就是闭包变量
    const name = value.getName();
    return name.startsWith('%closures');
}
```

---

**函数名**: `getResolvedCallbackParameters()`

**这个函数是做什么的？**

获取回调方法的参数列表，**但是**把闭包变量替换成它实际代表的值

**举例说明**:

```typescript
// 原始回调可能是这样的（中间表示）：
// %closures2 = parameter0  (name 变量被捕获)
// info = parameter1        (这是真正的回调参数)

function getResolvedCallbackParameters(method: ArkMethod): Value[] {
    const paramInstances = method.getParameterInstances();
    const resolved: Value[] = [];

    for (const param of paramInstances) {
        if (isClosureLocal(param)) {
            // 如果是闭包变量，就解析出它实际代表的值
            const actualValue = resolveClosureVariable(param, method);
            if (actualValue) {
                resolved.push(actualValue);
            }
        } else {
            // 普通参数直接添加
            resolved.push(param);
        }
    }
    return resolved;
}
```

**原始返回**: `[%closures2, info]`  （看不懂）
**解析后返回**: `[name, info]`      （知道 info 是真正的参数）

---

**函数名**: `resolveClosureVariable()`

**这个函数是做什么的？**

把 `%closures2` 这样的变量，解析成它实际代表的值

**输入**: 一个闭包变量（如 `%closures2`）

**输出**: 它实际代表的值（如 `name`）

```typescript
function resolveClosureVariable(local: Local, method: ArkMethod): Value | null {
    // 获取方法捕获的所有闭包变量
    const closures = getClosures(method);
    if (!closures) return null;

    // 遍历方法的语句，找类似这样的代码：
    // %closures2 = parameter0
    // 这说明 %closures2 其实就是外层的 parameter0

    for (const block of method.getCfg().getBlocks()) {
        for (const stmt of block.getStmts()) {
            if (stmt instanceof ArkAssignStmt) {
                const leftOp = stmt.getLeftOp();
                const rightOp = stmt.getRightOp();

                // %closures2 = parameter0
                if (leftOp.getName() === local.getName() &&
                    rightOp instanceof ArkParameterRef) {
                    // 返回被捕获的参数
                    return method.getParameterInstances()[rightOp.getIndex()];
                }
            }
        }
    }

    return null;
}
```

---

### 功能 4: 数据流追踪引擎

#### 这个功能解决什么问题？

拿到一个变量的起始值后，怎么追踪它在代码里的传播？

```typescript
let data = sensor.read();  // data = 源头
let text = data.toString(); // text 依赖 data
let message = '结果: ' + text; // message 依赖 text
console.info(message);     // message 被打印出去
```

我们需要追踪这条链：`data → text → message → console.info()`

#### 核心方法详解

**方法名**: `traceCallbackParamDataFlow()`

**这个方法是做什么的？**

从起始变量开始，沿着代码传播，追踪它最终流向哪里

**输入**:
- `method`: 要分析的方法
- `startVar`: 起始变量（如回调参数 `info`）
- `startFact`: 起始变量及其路径信息

**输出**: 无（把找到的污点流添加到 `detectOutcome`）

**内部逻辑（分步说明）**:

```
第1步：准备工作
  - 创建工作队列，把起始变量放进去
  - 创建已访问集合，避免重复处理

第2步：取出一个变量来处理
  从工作队列弹出一个变量

第3步：检查是不是污点泄露
  看看当前变量的值有没有被传递给"敏感函数"
  （如 console.info、hilog.info 这些会输出日志的函数）

第4步：处理赋值语句（变量传播）
  a = b 这样的语句，b 的污点性会传给 a
  例如：info 被标记为污点，那么 text = info 之后，text 也是污点

第5步：处理方法调用（返回值传播）
  let result = obj.method()
  如果 obj 是污点，那 result 也可能继承污点

第6步：处理字段访问（属性传播）
  data.name 这样的访问
  如果 data 是污点，那 data.name 也是污点

第7步：把新发现的污点变量加入队列
  回到第2步继续处理
```

**代码示例**:

```typescript
private traceCallbackParamDataFlow(method: ArkMethod,
                                     startVar: Value,
                                     startFact: TaintFact): void {
    const cfg = method.getCfg();
    if (!cfg) return;

    // 工作队列：待处理的变量
    const worklist: Array<{ var: Value, fact: TaintFact }> = [
        { var: startVar, fact: startFact }
    ];

    // 已访问集合：避免重复处理
    const visited = new Set<string>();

    while (worklist.length > 0) {
        // 取出待处理的变量
        const { var: currentVar, fact: currentFact } = worklist.pop()!;

        // 避免重复处理
        const key = currentVar.toString();
        if (visited.has(key)) continue;
        visited.add(key);

        // 获取方法里的所有语句
        const allStmts = getAllStatements(cfg);

        // 第1步：检查有没有泄露到敏感函数
        for (const stmt of allStmts) {
            if (!stmt.containsInvokeExpr()) continue;

            const invokeExpr = stmt.getInvokeExpr();
            const isSink = this.callSink(invokeExpr);

            if (isSink) {
                // 检查这个敏感函数的参数是否用了当前变量
                const args = invokeExpr.getArgs();
                for (const arg of args) {
                    if (ValueEqual(arg, currentVar)) {
                        // 发现了泄露！记录下来
                        const sinkFact = new TaintFact(currentVar);
                        for (const p of currentFact.getPath()) {
                            sinkFact.addPath(p);
                        }
                        sinkFact.addPath(stmt);
                        this.detectOutcome.push(sinkFact);
                    }
                }
            }
        }

        // 第2步：处理赋值语句
        for (const stmt of allStmts) {
            if (!(stmt instanceof ArkAssignStmt)) continue;

            const leftOp = stmt.getLeftOp();   // 等号左边
            const rightOp = stmt.getRightOp(); // 等号右边

            // 情况A: a = b，当前变量是 b
            if (ValueEqual(rightOp, currentVar) && leftOp instanceof Local) {
                // b 是污点，a 也变成污点
                const newFact = new TaintFact(leftOp);
                newFact.addPath(stmt);
                worklist.push({ var: leftOp, fact: newFact });
            }

            // 情况B: a = obj.field，obj 是当前变量
            if (currentVar instanceof Local &&
                rightOp instanceof ArkInstanceFieldRef &&
                LocalEqual(rightOp.getBase(), currentVar)) {
                // obj 是污点，obj.field 也变成污点
                const newFact = new TaintFact(rightOp);
                newFact.addPath(stmt);
                worklist.push({ var: rightOp, fact: newFact });
            }

            // 情况C: a = obj.method()，obj 是当前变量
            if (currentVar instanceof Local &&
                rightOp instanceof ArkInstanceInvokeExpr) {
                const invokeBase = rightOp.getBase();
                if (ValueEqual(invokeBase, currentVar) && leftOp instanceof Local) {
                    // obj 是污点，a 也变成污点
                    const newFact = new TaintFact(leftOp);
                    newFact.addPath(stmt);
                    worklist.push({ var: leftOp, fact: newFact });
                }
            }
        }
    }
}
```

---

### 功能 5: SDK 调用参数回调支持

#### 这个功能解决什么问题？

对于 SDK 里的 API 调用，原来的分析器不知道去哪里找回调函数：

```typescript
// 这是 SDK 的 API，我们看不到内部实现
import prompt from '@ohos.prompt';
prompt.showToast({
    message: 'Hello',
    duration: 3000,
    success: () => { }  // 这个回调要去哪里找？
});
```

#### 修改说明

**文件**: `src/hapflow/DataflowSolver.ts`

**修改内容**:

```typescript
protected getCallees(invokeStmt: ArkInvokeStmt): Set<ArkMethod> {
    // ... 前面的代码 ...

    // 原来的逻辑：对 SDK 调用直接返回空
    // callees = new Set(paramFuncs);  // 这样就够了
    if (this.scene.getFile(invokeMethodFileSignature) &&
        !this.scene.hasSdkFile(invokeMethodFileSignature)) {
        // 项目代码，可以从调用图获取
        callees = this.getAllCalleeMethodsFromCG(invokeStmt, paramFuncs);
    } else {
        // SDK 代码：也把回调函数加进去
        if (paramFuncs.length > 0) {
            for (const pf of paramFuncs) {
                callees.add(pf);
            }
        }
    }

    return callees;
}
```

---

### 功能 6: 直接回调数据流分析入口

#### 这个功能解决什么问题？

原来的分析器只处理"从入口方法可以到达"的代码，但很多回调是异步触发的，分析器根本跑不到。

#### 核心方法详解

**方法名**: `analyzeCallbackDataFlows()`

**这个方法是做什么的？**

遍历项目里所有的方法，找出所有包含数据源 API 调用的地方，单独做分析

**输入**: 无

**输出**: 无（把检测结果添加到 `detectOutcome`）

**内部逻辑（分步说明）**:

```
第1步：遍历项目里所有的方法
  for (每个方法) {
      第2步：遍历方法里的所有语句
      for (每个语句) {
          第3步：判断是不是数据源 API
          if (是 getData、selectContacts 这类 API) {
              第4步：根据 API 类型选择分析方法
              - 回调式: 调用 analyzeCallbackSource()
              - 返回值式: 调用 analyzePromiseChaining()
          }

          第5步：检查 .then() 链式调用
          如果是 .then()，调用 analyzeChainedThenInvoke()
      }
  }
```

**代码示例**:

```typescript
public analyzeCallbackDataFlows(): void {
    // 遍历项目里的每个方法
    for (const method of this.scene.getMethods()) {
        const cfg = method.getCfg();
        if (!cfg) continue;

        // 遍历每个语句
        for (const block of cfg.getBlocks()) {
            for (const stmt of block.getStmts()) {
                if (!stmt.containsInvokeExpr()) continue;

                const invokeExpr = stmt.getInvokeExpr();
                if (!invokeExpr) continue;

                // 检查是不是数据源 API
                const source = callSource(invokeExpr, this.sources, this.scene);

                if (source) {
                    // 根据类型选择分析方法
                    if (source.sourceType === 'callback') {
                        // 回调式 API
                        this.analyzeCallbackSource(method, stmt, invokeExpr, source);
                    } else if (source.sourceType === 'return') {
                        // 返回值式 API
                        this.analyzePromiseChaining(method, stmt, invokeExpr, source);
                    }
                    continue;
                }

                // 还要检查 .then() 链式调用
                this.analyzeChainedThenInvoke(method, stmt, invokeExpr);
            }
        }
    }
}
```

---

## 修改文件清单

| 文件 | 修改类型 | 新增行数 | 说明 |
|------|----------|----------|------|
| `src/hapflow/TaintAnalysis.ts` | 修改 | +644 行 | 新增回调追踪相关方法 |
| `src/hapflow/Util.ts` | 修改 | +172 行 | 新增闭包解析函数 |
| `src/hapflow/DataflowSolver.ts` | 修改 | +9 行 | SDK 调用回调支持 |
| `src/hapflowRunner.ts` | 修改 | +5 行 | 调用直接回调分析入口 |
| `docs/callback-dataflow-implementation.md` | 新增 | - | 实现技术文档 |

---

## 测试结果

### 全量测试统计

| 指标 | 数值 |
|------|------|
| 测试项目总数 | 55 |
| 成功分析 | 53 |
| OOM 失败 | 2 |
| 检测到数据流 | 15 |

### 关键项目检测结果

| 项目 | 隐私 API | 数据流 |
|------|----------|--------|
| legado-Harmony-main | 60 | 36 |
| harmony-next-music-sharing | 39 | 11 |
| STUFFS_NEXT-master | 56 | 10 |
| Wechat_HarmonyOS | 46 | 10 |
| Snake_NEXT-main | 33 | 4 |
| harmonyos-games-main | 56 | 6 |

---

## 关键概念解释

### 什么是 IFDS？

IFDS（Interprocedural Data Flow Analysis）是**过程间数据流分析**的简称。

它解决的问题是：**数据不仅在单个方法内流动，还会跨方法流动**

```typescript
function A() {
    let x = getData(); // x 得到数据
    B(x);              // x 传给方法 B
}

function B(y) {
    console.log(y);    // y 在这里被使用
}
```

IFDS 能追踪 x → y 的数据流。

### 什么是回调？

回调就是**把一个函数作为参数传给另一个函数**

```typescript
// 常见形式1: 回调函数
doSomething(callback);

// 常见形式2: Promise.then
promise.then((result) => {
    // result 是上一个操作的结果
});
```

### 什么是闭包？

闭包就是**函数记住了它外部的变量**

```typescript
function outer() {
    let name = '张三';

    return function inner() {
        // inner 函数记住了 name
        console.log(name);
    };
}
```

### 什么是污点分析？

污点分析就是**追踪"脏数据"的传播**

- **source（污点源）**: 数据从哪里来（如 sensor.on 的回调参数）
- **sink（污点汇）**: 数据流向哪里（如 console.info）
- **propagation（传播）**: 数据怎么在中间过程流动

---

## 后续计划

1. **跨文件回调追踪**: 当前只处理同一文件
2. **嵌套 Promise 支持**: `a.then().then()` 多层链式
3. **async/await 完整支持**: 完善 await 处理
4. **性能优化**: 大型项目增量分析