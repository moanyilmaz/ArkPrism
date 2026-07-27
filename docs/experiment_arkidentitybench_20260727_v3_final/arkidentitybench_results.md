# ArkIdentityBench

Oracle: 64 cases; 32 positive and 32 negative.

| Configuration | TP | TN | FP | FN | Precision | Recall | Specificity | F1 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Lexical token | 32 | 0 | 32 | 0 | 50.00% | 100.00% | 0.00% | 66.67% |
| Import-aware namespace | 17 | 32 | 0 | 15 | 100.00% | 53.13% | 100.00% | 69.39% |
| Declared-receiver AST | 26 | 32 | 0 | 6 | 100.00% | 81.25% | 100.00% | 89.66% |
| Factory-aware AST | 28 | 32 | 0 | 4 | 100.00% | 87.50% | 100.00% | 93.33% |
| ArkPrism | 32 | 32 | 0 | 0 | 100.00% | 100.00% | 100.00% | 100.00% |
