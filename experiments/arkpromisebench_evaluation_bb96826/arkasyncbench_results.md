# ArkAsyncBench

Oracle: 16 cases; 6 positive and 10 negative.

| Configuration | TP | TN | FP | FN | Precision | Recall | Specificity | F1 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| full | 6 | 10 | 0 | 0 | 100.00% | 100.00% | 100.00% | 100.00% |
| continuation_off | 0 | 10 | 0 | 6 | N/A | 0.00% | 100.00% | N/A |

Full-only correct cases: 6.
Ablation-only correct cases: 0.
Exact McNemar p: 0.03125.
