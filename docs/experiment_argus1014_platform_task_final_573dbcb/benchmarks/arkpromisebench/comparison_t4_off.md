# ArkAsyncBench

Oracle: 24 cases; 7 positive and 17 negative.

| Configuration | TP | TN | FP | FN | Precision | Recall | Specificity | F1 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| full | 7 | 17 | 0 | 0 | 100.00% | 100.00% | 100.00% | 100.00% |
| continuation_off | 0 | 17 | 0 | 7 | N/A | 0.00% | 100.00% | N/A |

Full-only correct cases: 7.
Ablation-only correct cases: 0.
Exact McNemar p: 0.015625.
