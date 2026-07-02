
# ArkPrism 全量测试报告

## 测试时间
2026-07-01T10:56:58.203Z

## 测试结果
- 总样本数: 66
- 成功: 66
- 失败: 0

## 检测结果统计

有敏感 API 检测的样本: 12
有污点流检测的样本: 7

## 检测到污点流的样本

| 样本 | APIs | Taint Flows | Collab | 状态 |
|------|------|-------------|--------|------|
| DrawingBook-master | 43 | 15 | 3 | ✅ |
| harmonyos-games-main | 43 | 15 | 3 | ✅ |
| harmonyProject-master | 25 | 6 | 2 | ✅ |
| PedometerApp | 5 | 1 | 4 | ✅ |
| Snake_NEXT-main | 24 | 6 | 2 | ✅ |
| STUFFS_NEXT-master | 43 | 17 | 3 | ✅ |
| Wechat_HarmonyOS | 50 | 3 | 5 | ✅ |

## 有 API 但无污点流的样本

| 样本 | APIs | Chains | 可能原因 |
|------|------|--------|----------|
| com.example.myapplication2 | 9 | 8 | 待分析 |
| FilesManger | 1 | 1 | 待分析 |
| harmony-next-music-sharing | 27 | 19 | callback source 匹配失败 |
| ImageEdit | 1 | 0 | 待分析 |
| legado-Harmony-main | 47 | 34 | callback source 匹配失败 |

## 问题分析

### 1. legado-Harmony-main 漏报问题

**现象**: 代码中有 `getOsAccountLocalId` 调用和 `console.log(localId)`，但没有检测到污点流。

**根本原因**:
- 源码从 `@kit.BasicServicesKit` 导入 `osAccount`
- API 配置的 systemPackage 是 `@ohos.account.osAccount`
- 模块不匹配导致 callback source 无法正确加载

**已尝试的修复**:
1. 在 hapflow_sources.json 中添加了 @kit.BasicServicesKit 版本
2. 在 Util.ts 中添加了 namespace 映射
3. 在 sensitive_apis.json 中添加了 @kit.BasicServicesKit API 配置

**结果**: API 检测数从 47 增加到 48，但 callback source 仍未能正确加载。

### 2. DrawingBook-master 检测正常

- 43 个隐私 API
- 15 条污点流
- 所有 callback source 正确匹配

**为什么 DrawingBook 能工作**:
- 可能使用了不同的 import 方式
- 或者 ArkAnalyzer 对两个项目的类型解析不同

## 下一步建议

1. **深入调试 callback source 加载**:
   - 检查 Json2ArkMethodSignature 是否正确处理 @kit.BasicServicesKit
   - 添加详细的加载日志

2. **检查两个项目的类型解析差异**:
   - 对比 DrawingBook 和 legado 的 Scene 构建
   - 确认为什么一个是 @%unk 而另一个能解析

3. **或者采用更简单的方案**:
   - 不依赖 module 匹配
   - 直接通过方法名 + 签名模式匹配 callback source

## 文件修改记录

1. src/hapflow/Util.ts - 添加 namespace 映射
2. src/hapflow/TaintAnalysis.ts - 启用 bounded callback analysis
3. config/hapflow_sources.json - 添加 @kit.BasicServicesKit sources
4. config/sensitive_apis.json - 添加 @kit.BasicServicesKit APIs

---
*报告生成时间: 2026-07-01T10:56:58.203Z*
