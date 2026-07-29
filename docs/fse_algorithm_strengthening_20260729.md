# Algorithm-strengthening study

## Reviewer assessment

The review correctly identifies two method-level weaknesses in the frozen
implementation:

1. Promise continuation recovery was produced by a bounded post-IFDS scan.
   The scan found useful paths, but those paths were not part of the IFDS
   exploded supergraph.
2. Receiver recovery still uses fixed local depth bounds. These bounds are
   engineering safeguards rather than semantic termination conditions.

The review overstates the claim that ArkPrism is only a platform adaptation.
ArkAnalyzer already exposes callback callees, def-use information, and a PAG.
The missing step was to make these facts participate in the same fixed-point
computation as taint propagation.

## Primary-source and implementation study

- **WeMinT (ASE 2023):** models asynchronous mini-program APIs with explicit
  AST callback rules and a context-based variable-scope model. Its archived
  anonymous repository is no longer publicly readable.
- **PacDroid (ICSE 2025):** integrates Android feature handlers with an
  on-the-fly points-to worklist. New points-to facts notify every handler, and
  handler side effects re-enter the same worklist. Its released source is
  packaged in an approximately 11 GB artifact image.
- **SparseBoomerang (ICST 2023):** constructs type- or alias-specific sparse
  CFGs on demand and preserves control statements, query-relevant def-use
  statements, and target call sites.
- **Sparse IDE (ICSE 2024):** propagates symbol-specific IDE facts over
  on-demand sparse control-flow graphs.
- **Event-aware IFDS-to-IDE analysis:** enriches facts with event-handler
  state to remove infeasible event orders while preserving a formal
  correctness argument.

The directly applicable design principle is to put platform continuation
semantics into the solver's transfer relation. Sparsification and event-state
lifting are subsequent improvements, not substitutes for that semantic step.

## Implemented change: continuation-aware IFDS

For a Promise success continuation

```text
p = source()
p.then(cb)
```

the IFDS call-flow function now applies:

```text
<then-site, source-fact(p)> -> <entry(cb), source-fact(cb.param0)>
```

The transfer is accepted only when:

- the invocation member is exactly `then`;
- the resolved callee is the callback in argument position zero;
- the receiver is the current fact or is related to it by available pointer
  evidence; and
- the callback has a resolvable first data parameter.

The new fact preserves the immutable source witness and records the
`promise_then` derivation. The batch runner's recorded
`--disable-continuation-flow` switch disables only this transfer for
mechanism-level ablation. The existing bounded supplement is retained as an
optional fallback for IR patterns not represented by a typed continuation
edge.

## Controlled validation

Both configurations disable the legacy supplement, so the comparison isolates
the new IFDS transfer.

| Configuration | TP | TN | FP | FN | Precision | Recall | Specificity | F1 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Continuation IFDS | 24 | 24 | 0 | 0 | 100.00% | 100.00% | 100.00% | 100.00% |
| Without T4 transfer | 15 | 24 | 0 | 9 | 100.00% | 62.50% | 100.00% | 76.92% |

All nine changed cases are T4 Promise-`then` positives. T1 callback cases keep
their source-generating call flow, while T5 `await` cases retain native IFDS
normal flow over explicit ArkIR. The exact paired McNemar test gives
`p=0.00390625`. All 24 matched negative cases remain negative.

The full run produces 24 privacy-data paths, all with IFDS provenance. Exactly
nine carry the `promise_then` derivation, and none requires
`async_supplement`.

## Adversarial Promise semantics

The balanced benchmark establishes that T4 is necessary, but nine targeted
positives alone do not establish its semantic boundary. ArkPromiseBench now
contains 17 cases whose oracle is defined by explicit dependence from a
configured Promise payload to the sink:

- six positives cover direct success binding, same-Promise aliases,
  `then(success, rejection)`, sequential payload and property transforms, and
  Promise flattening;
- eleven negatives cover two custom/non-Promise `then` variants, rejection position,
  `catch`, `finally`, ignored and constant values, independent and reassigned
  Promise aliases, a constant-returning sanitizer, and a constant-returning
  sequential transform.

The first implementation exposed one false positive on the sequential
constant case. ArkIR represents `q = p.then(cb)` as an assignment statement.
Callback ICFG recovery previously inspected only standalone invoke
statements, so the callback return was bypassed and the receiver fact could
reach `q`. The repaired construction discovers typed callback arguments on
every invoke-containing statement. It then:

1. requires a Promise owner witness and `promise_payload` carrier state;
2. requires exact receiver-root identity or available pointer alias evidence;
3. re-roots the success payload to callback parameter zero;
4. re-roots an assigned `then` result only from an explicitly tainted callback
   return; and
5. records `promise_then` and `promise_return` as transfer derivations while
   keeping carrier state in IFDS fact identity.

The frozen 16-case controlled run produced:

| Configuration | TP | TN | FP | FN | Precision | Recall | Specificity | F1 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Continuation IFDS | 6 | 10 | 0 | 0 | 100.00% | 100.00% | 100.00% | 100.00% |
| Without T4 transfer | 0 | 10 | 0 | 6 | -- | 0.00% | 100.00% | -- |

All six changed predictions favor the full configuration (exact paired
McNemar `p=0.03125`). The three multi-hop positives carry both
`promise_then` and `promise_return`; no result uses the supplementary scan.

The seventeenth case invokes a source-capturing callback through an
application-defined `then`, discards the callback return, and returns an
independent constant Promise. Its isolated full-configuration probe reports
one recognized source and one sink but no taint path, as required by the
oracle. The final 17-case aggregate is intentionally deferred until the same
controlled configurations are rerun together.

The original 48-case ArkAsyncBench remains unchanged after this repair:
24 TP/24 TN for the full configuration and 15 TP/24 TN for `-T4`. All 27
API-20 delivery checks pass.

## SDK signature compatibility

Source-rule resolution now treats owner, arity, normalized parameter type, and
string-literal event discriminator as hard constraints. Parameter names remain
diagnostic metadata because they are not part of call semantics and may change
between SDK declarations. A regression test confirms that renaming an SDK
parameter preserves a match while changing its type rejects the match.

The API-20 audit remains 257/257 uniquely resolved rules. The API-17
compatibility audit remains 249/257, with the same eight version-incompatible
rules. Both audits report zero ambiguity, signature collision, or carrier
mismatch.

## Next method-level priorities

1. Replace receiver depth limits with a memoized, demand-driven provenance
   query over ArkAnalyzer def-use/PAG edges. Terminate by visited-state and
   explicit query budget, and expose unresolved/budget-exhausted outcomes.
2. Evaluate receiver-query sensitivity on the source-first identity benchmark
   before replacing the production resolver.
3. Lift lifecycle ordering into an event-state product domain only after a
   dedicated positive/negative event-order benchmark exists.
4. Apply def-use sparsification after semantic integration, using it to offset
   the cost of richer continuation and event-state facts.

## References

- WeMinT, ASE 2023: <https://conf.researchr.org/details/ase-2023/ase-2023-papers/81/WeMinT-Tainting-Sensitive-Data-Leaks-in-WeChat-Mini-Programs>
- PacDroid, ICSE 2025: <https://conf.researchr.org/details/icse-2025/icse-2025-research-track/211/PacDroid-A-Pointer-Analysis-Centric-Framework-for-Security-Vulnerabilities-in-Androi>
- SparseBoomerang, ICST 2023: <https://github.com/secure-software-engineering/SparseBoomerang>
- Sparse IDE, ICSE 2024: <https://conf.researchr.org/details/icse-2024/icse-2024-research-track/88/Symbol-Specific-Sparsification-of-Interprocedural-Distributive-Environment-Problems>
- Event-aware IFDS/IDE: <https://arxiv.org/abs/1910.12935>
