# ArkAsyncBench

Oracle: 16 cases; 6 positive and 10 negative.

| Configuration | TP | TN | FP | FN | Precision | Recall | Specificity | F1 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| full | 6 | 10 | 0 | 0 | 100.00% | 100.00% | 100.00% | 100.00% |
| continuation_off | 2 | 9 | 1 | 4 | 66.67% | 33.33% | 90.00% | 44.44% |

Full-only correct cases: 5.
Ablation-only correct cases: 0.
Exact McNemar p: 0.0625.
