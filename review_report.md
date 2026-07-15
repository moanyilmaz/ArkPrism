# ArkPrism 论文系统性优化报告

## 0. 总体现状

- **当前页数**: 24页（含附录约4页），正文约20页
- **FSE页数限制**: 正文12页 + 附录无限制（参考文献不计入）
- **目标**: 正文压至12页以内，附录承载补充材料
- **核心问题**: 正文过长（~20页 vs 12页限制），需削减约8页

---

## 1. P0: 严重数字不一致（必须立即修复）

### 1.1 Conclusion中百分比错误
- **Abstract/Evaluation**: HapFlow 68.7%，blind spots 31.3% ← 正确
- **Conclusion**: HapFlow 58.0%，blind spots 42.0% ← **错误**，与正文矛盾
- **修复**: Conclusion中58.0%→68.7%，42.0%→31.3%

### 1.2 Runtime数字不一致
- Abstract: "≈4.2h wall time"（2 workers）
- Conclusion: "8.4h (2 workers) with zero timeouts" ← 应为≈4.2h
- Appendix: "30,142s ≈8.4h single-worker, ≈4.2h with 2 workers"
- **修复**: 统一为"≈4.2h wall time (2 workers)"，8.4h标注为single-worker

### 1.3 RQ2中call-chain coverage段落完全重复
- Line 193-199 和 Line 201-202 是同一段话的两个版本，都出现在RQ2中
- **修复**: 删除其中一个（保留line 201-202的简化版，删除193-199的enumerate版）

---

## 2. P1: 篇幅削减方案（需砍~8页正文）

### 2.1 Introduction: 削1-1.5页 → 目标1-1.5页

**问题**: 当前约2.5页，典型FSE论文1.5-2页

| 削减项 | 估计节省 | 理由 |
|--------|---------|------|
| 删除"two common overclaims"段落(line 16-17) | ~0.3页 | 属于Discussion内容，放在Introduction打断叙事 |
| 删除"implementation deliberately keeps"段落(line 20-21) | ~0.3页 | 属于Implementation/Discussion内容 |
| 精简contribution 4条中与正文的重复 | ~0.3页 | Contribution条目与后续各节高度重复，可大幅缩减 |
| 合并C1-C3和concrete example为更紧凑的叙述 | ~0.3页 | 当前challenge+example共1.5页，可压缩到1页 |

### 2.2 Background: 削1.5页 → 目标1页

**问题**: 当前约3.5页（含code listing），典型FSE论文0.5-1页

| 削减项 | 估计节省 | 理由 |
|--------|---------|------|
| 删除Section 2.3 (Information-flow Subgraph) | ~0.5页 | 形式化定义$G_u$已在Section 3重复 |
| Failure Modes (2.5) 移到附录 | ~0.5页 | 经验性的failure observation，非背景知识 |
| 精简OpenHarmony/ArkTS背景 | ~0.3页 | 过于冗长，目标读者已知TypeScript/ArkUI基础 |
| Motivating Example保留但缩减解释文字 | ~0.2页 | listing本身必要，但文字解释过长 |

### 2.3 Design: 削3-4页 → 目标4-5页

**问题**: 当前约9页（含20+公式、2算法、3表、2图），这是正文膨胀的主因

| 削减项 | 估计节省 | 理由 |
|--------|---------|------|
| 删除Algorithm 2 (Complete Pipeline) | ~0.7页 | Algorithm 1(Async Binding)是核心创新；Algorithm 2是pipeline概述，信息增量低 |
| Section 3.8 (Corpus-scale Hardening) 移到Implementation | ~0.3页 | 工程细节，非设计贡献 |
| Provenance subsection (3.9.1+3.9.2) 合并精简 | ~0.5页 | 两个子节重复解释provenance label含义；itemize列举5种label太冗长 |
| Context-Sensitive CG (3.7) 移到附录 | ~0.5页 | 自身评估已证明"marginal precision improvement at 5.02× overhead"，非核心贡献 |
| Lifecycle State Machine (3.4) 精简 | ~0.5页 | Level 1/Level 2的详细CFG描述移到附录，正文保留模型定义和关键性质 |
| Identity Function (3.3.1) 与 Problem Definition (3.1) 合并 | ~0.4页 | Id(v)在3.1和3.3.1定义了两次，Match谓词也重复 |

**关键原则**: 顶会论文的Design部分应突出**创新点**（Identity Resolution + Async Binding），而非面面俱到。Context-Sensitive CG和Corpus-scale Hardening应弱化或移出。

### 2.4 Implementation: 削0.5页 → 目标0.5-1页

**问题**: 当前约3页，但大部分是实现细节

| 削减项 | 估计节省 | 理由 |
|--------|---------|------|
| 删除file name罗列 | ~0.2页 | `apiDetector.ts`等文件名对读者无意义 |
| 删除Running Example在Implementation中的重复引用 | ~0.3页 | Fig 3已在Design中充分解释 |

### 2.5 Evaluation: 削2-3页 → 目标4-5页

**问题**: 当前约8页，4个RQ

| 削减项 | 估计节省 | 理由 |
|--------|---------|------|
| Benchmark Construction (5.2) 移到附录 | ~1页 | 标准做法：benchmark细节在附录，正文只概述 |
| HapFlow comparison的长段解释精简 | ~0.5页 | 当前6段解释同一条数据，可压缩到3段 |
| "Why lifecycle modeling does not increase taint flows"移到Discussion | ~0.5页 | 这是interpretation，不是evaluation结果 |
| Summary of Findings删除，各RQ末尾已有summary | ~0.5页 | F1-F5是RQ summary的纯重复 |
| RQ4 (Corpus Pattern) 精简为1段+1图 | ~0.5页 | 当前占2页但主要是描述性统计 |

### 2.6 Discussion: 基本不变 → 目标1页

- 当前约2页，威胁到有效性部分过长（7段threats）
- "Ablation Opportunities"和"Why Package Evolution Matters"可精简或删除

### 2.7 Related Work: 基本不变 → 目标1-1.5页

- 当前约2页，6个子节
- 可合并为3个主题轴：Source Identity、Async Semantics、Evidence Representation
- 当前是"列举论文"风格，应改为"围绕技术轴比较"风格

### 2.8 Conclusion: 精简 → 目标0.3页

- 当前约1页，5条findings完全重复
- 应缩短为：贡献总结(3句) + 关键发现(2-3句) + future work(2句)

---

## 3. P1: 关键冗余热点

| 内容 | 重复次数 | 出现位置 | 建议处理 |
|------|---------|---------|---------|
| HapFlow limitation ("solves propagation, not source identity") | 6 | Abstract, Intro×2, Background, Related Work, Conclusion | 只在Intro和Related Work各说一次，其他引用 |
| Callback recall 51.5%→97.8% | 5 | Abstract, Intro×2, Eval RQ3, Eval F3, Conclusion | 只在Eval说一次，Abstract/Conclusion引用 |
| Package migration (@ohos/@kit) | 5 | Intro, Background, Design, Discussion, Related Work | 只在Design详述，其他一句话引用 |
| Identity tuple ⟨Pkg,Ns,Recv,Mem,Acc⟩ | 2 | Design 3.1, Design 3.3.1 | 合并为一个位置定义 |
| Provenance label set {CG,Callback,LC,IFDS,Heuristic} | 3 | Design 3.1, 3.9.1, 3.9.2 | 只在3.9定义一次 |
| 100% P/R on ArkPrismBench | 4 | Abstract, Eval RQ1, Eval F1, Conclusion | 只在Eval和Abstract各一次 |
| "evidence not violation" caveat | 3 | Intro, Discussion, Eval RQ2 | 只在Discussion详述 |
| Lifecycle does not increase taint flows | 4 | Intro, Eval RQ3, Eval F3, Discussion threats | 只在Eval和Discussion各一次 |

---

## 4. P2: 写作质量问题

### 4.1 过度冗余的表述
- Introduction line 18: 一整段(6行)描述"three core techniques"，每条又重复了identity tuple、transfer rules、provenance label —— 这些在后续章节会详述
- Introduction line 22: "8.4h with zero timeouts" —— 已在abstract中说过
- Design line 4: "ArkAnalyzer provides... HapFlow provides..." —— 在Background已说过

### 4.2 过度hedge/保守
- "we do not treat the corpus as a complete marketplace-security benchmark" —— 这类disclaimer在论文中出现3次以上
- "the appropriate claim is not '1,792 confirmed leaks'" —— 过度防御性写作，在evaluation中已用provenance区分了

### 4.3 Running Example不一致
- Section 2用pasteboard example (Listing 1)
- Section 3用camera/calendar example (Figure 2)
- 应统一为一个example贯穿全文

### 4.4 Conclusion缺少Future Work
- FSE论文标准结构应包含future work方向
- 当前conclusion是纯重复，没有forward-looking内容

### 4.5 缺少Limitations的精简
- Discussion中的Threats to Validity有7段，过长
- 应合并为4段：Internal (benchmark+corpus) + External (generalizability) + Construct (rules+metrics) + Conclusion

---

## 5. P2: 表格/图优化

| 当前表/图 | 问题 | 建议 |
|-----------|------|------|
| Table 1 (Notation) | 10个符号，占0.4页 | 移到附录 |
| Table 2 (Design Map) | 已在附录 | OK |
| Table 3 (Identity Examples) | 4行 | 可融入正文文字 |
| Table 4 (Transfer Rules) | 5行table* | 保留，是核心设计 |
| Table 5 (Micro Benchmark) | 15行 | 保留 |
| Table 6 (Localization) | 5行 | 保留 |
| Table 7 (HapFlow Comparison) | 12行含SDK breakdown | SDK breakdown可移到附录 |
| Table 8 (Subgraph Quality) | 15行 | 保留但考虑精简 |
| Table 9 (Ablation) | 5行 | 保留，核心结果 |
| Table 10 (LC CG Examples) | 5行 | 可移到附录 |
| Table 11 (CS CG) | 在Evaluation中 | 移到附录（非核心贡献） |
| Fig 1 (Architecture) | 1图 | 保留 |
| Fig 2 (Running Example) | 1图 | 保留 |
| Fig 3-5 (Eval figures) | 3图 | Fig 5(corpus landscape)可移到附录 |

**原则**: 正文表格控制在6-8个，图3-4个

---

## 6. 推荐执行顺序

### Phase 1: 立即修复（数字不一致 + 重复段落）
1. Conclusion: 58.0%→68.7%, 42.0%→31.3%
2. Conclusion: 8.4h→≈4.2h wall time
3. RQ2: 删除重复的call-chain coverage段落

### Phase 2: 大幅削减正文（~8页）
4. Notation表 → 附录
5. Algorithm 2 → 删除
6. Context-Sensitive CG节 → 附录
7. Benchmark Construction节 → 附录
8. Summary of Findings → 删除
9. "Why lifecycle does not increase taint flows" → Discussion
10. Failure Modes → 附录
11. Information-flow Subgraph定义 → 删除(已在Design中)
12. Introduction中2段冗余 → 删除或移走

### Phase 3: 精简写作
13. 统一running example
14. 消除6处HapFlow limitation重复
15. Related Work改为技术轴组织
16. Conclusion添加future work
17. Threats to Validity精简

### Phase 4: 附录补充
18. 移出的内容组织到Appendix
19. 确保正文引用附录的位置正确
20. 重新编译验证页数

---

## 7. 预期效果

| 部分 | 当前 | 目标 | 节省 |
|------|------|------|------|
| Introduction | ~2.5页 | ~1.5页 | -1页 |
| Background | ~3.5页 | ~1页 | -2.5页 |
| Design | ~9页 | ~5页 | -4页 |
| Implementation | ~3页 | ~1页 | -2页 |
| Evaluation | ~8页 | ~4.5页 | -3.5页 |
| Discussion | ~2页 | ~1页 | -1页 |
| Related Work | ~2页 | ~1.5页 | -0.5页 |
| Conclusion | ~1页 | ~0.5页 | -0.5页 |
| **正文总计** | **~31页** | **~16页** | **~15页** |

注：以上为"全砍"估计，实际FSE双栏格式下1行≈1/50页，正文约需进一步确认。当前24页PDF含附录4页+参考文献2页，正文约18页。需要再砍约6页正文才能到12页限制。
