# HapBench Reproduction

Oracle: 67 cases (53 positive, 14 negative).

## Overall

| Tool/configuration | Complete | TP | TN | FP | FN | Precision | Recall | F1 | Balanced acc. | MCC |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| ArkPrism full | 67/67 | 50 | 14 | 0 | 3 | 100.00% | 94.34% | 97.09% | 97.17% | 0.881 |

Wilson 95% confidence intervals are reported for binomial metrics.

| Tool/configuration | Precision CI | Recall CI | Specificity CI | Accuracy CI | Macro-category F1 | Worst-category F1 |
|---|---:|---:|---:|---:|---:|---:|
| ArkPrism full | [92.9, 100.0] | [84.6, 98.1] | [78.5, 100.0] | [87.6, 98.5] | 97.96% | 85.71% |

## Runtime

| Tool/configuration | Timed cases | Total | Median/case | P95/case | Max/case |
|---|---:|---:|---:|---:|---:|
| ArkPrism full | 67 | 1309.2 s | 18.0 s | 30.5 s | 31.6 s |

## Per-category F1

| Tool/configuration | Aliasing | Anonymous Constructs | Array-Like Structures | Field and Object Sensitivity | General Language Features | Lifecycle Modeling | OpenHarmony Specific APIs |
|---|---:|---:|---:|---:|---:|---:|---:|
| ArkPrism full | 100.00% | 100.00% | 100.00% | 100.00% | 100.00% | 85.71% | 100.00% |

## Errors and incomplete cases

### ArkPrism full

- FN `Lifecycle_Modeling__ActivityLifecycle4`: reported flows=0
- FN `Lifecycle_Modeling__BackupExtensionAbility`: reported flows=0
- FN `Lifecycle_Modeling__Button1`: reported flows=0
