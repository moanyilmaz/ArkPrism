# HapBench Reproduction

Oracle: 67 cases (53 positive, 14 negative).

## Overall

| Tool/configuration | Complete | TP | TN | FP | FN | Precision | Recall | F1 | Balanced acc. | MCC |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| HapFlow artifact reproduction | 67/67 | 51 | 10 | 4 | 2 | 92.73% | 96.23% | 94.44% | 83.83% | 0.717 |
| ArkPrism full | 67/67 | 50 | 14 | 0 | 3 | 100.00% | 94.34% | 97.09% | 97.17% | 0.881 |
| ArkPrism callback-off | 67/67 | 50 | 14 | 0 | 3 | 100.00% | 94.34% | 97.09% | 97.17% | 0.881 |
| ArkPrism no-ir | 67/67 | 37 | 14 | 0 | 16 | 100.00% | 69.81% | 82.22% | 84.91% | 0.571 |
| ArkPrism no-receiver | 67/67 | 50 | 13 | 1 | 3 | 98.04% | 94.34% | 96.15% | 93.60% | 0.831 |
| ArkPrism unbounded-lifecycle | 67/67 | 52 | 13 | 1 | 1 | 98.11% | 98.11% | 98.11% | 95.49% | 0.910 |

Wilson 95% confidence intervals are reported for binomial metrics.

| Tool/configuration | Precision CI | Recall CI | Specificity CI | Accuracy CI | Macro-category F1 | Worst-category F1 |
|---|---:|---:|---:|---:|---:|---:|
| HapFlow artifact reproduction | [82.7, 97.1] | [87.2, 99.0] | [45.4, 88.3] | [81.8, 95.8] | 95.73% | 88.89% |
| ArkPrism full | [92.9, 100.0] | [84.6, 98.1] | [78.5, 100.0] | [87.6, 98.5] | 97.96% | 85.71% |
| ArkPrism callback-off | [92.9, 100.0] | [84.6, 98.1] | [78.5, 100.0] | [87.6, 98.5] | 97.96% | 85.71% |
| ArkPrism no-ir | [90.6, 100.0] | [56.5, 80.5] | [78.5, 100.0] | [64.7, 84.7] | 87.07% | 66.67% |
| ArkPrism no-receiver | [89.7, 99.7] | [84.6, 98.1] | [68.5, 98.7] | [85.6, 97.7] | 97.57% | 85.71% |
| ArkPrism unbounded-lifecycle | [90.1, 99.7] | [90.1, 99.7] | [68.5, 98.7] | [89.8, 99.2] | 98.81% | 91.67% |

## Runtime

| Tool/configuration | Timed cases | Total | Median/case | P95/case | Max/case |
|---|---:|---:|---:|---:|---:|
| HapFlow artifact reproduction | 67 | 194.0 s | N/A | N/A | N/A |
| ArkPrism full | 67 | 1507.1 s | 22.3 s | 24.1 s | 24.6 s |
| ArkPrism callback-off | 67 | 1462.3 s | 21.9 s | 22.9 s | 23.4 s |
| ArkPrism no-ir | 67 | 1519.0 s | 22.4 s | 25.0 s | 25.9 s |
| ArkPrism no-receiver | 67 | 1497.3 s | 22.2 s | 23.4 s | 26.4 s |
| ArkPrism unbounded-lifecycle | 67 | 1471.0 s | 21.5 s | 25.8 s | 27.5 s |

## Paired comparison

| Left | Right | Paired | Left-only correct | Right-only correct | McNemar exact p |
|---|---|---:|---:|---:|---:|
| HapFlow artifact reproduction | ArkPrism full | 67 | 3 | 6 | 0.508 |
| HapFlow artifact reproduction | ArkPrism callback-off | 67 | 3 | 6 | 0.508 |
| HapFlow artifact reproduction | ArkPrism no-ir | 67 | 14 | 4 | 0.0309 |
| HapFlow artifact reproduction | ArkPrism no-receiver | 67 | 3 | 5 | 0.727 |
| HapFlow artifact reproduction | ArkPrism unbounded-lifecycle | 67 | 1 | 5 | 0.219 |
| ArkPrism full | ArkPrism callback-off | 67 | 0 | 0 | 1.00 |
| ArkPrism full | ArkPrism no-ir | 67 | 13 | 0 | 0.000244 |
| ArkPrism full | ArkPrism no-receiver | 67 | 1 | 0 | 1.00 |
| ArkPrism full | ArkPrism unbounded-lifecycle | 67 | 1 | 2 | 1.00 |
| ArkPrism callback-off | ArkPrism no-ir | 67 | 13 | 0 | 0.000244 |
| ArkPrism callback-off | ArkPrism no-receiver | 67 | 1 | 0 | 1.00 |
| ArkPrism callback-off | ArkPrism unbounded-lifecycle | 67 | 1 | 2 | 1.00 |
| ArkPrism no-ir | ArkPrism no-receiver | 67 | 1 | 13 | 0.00183 |
| ArkPrism no-ir | ArkPrism unbounded-lifecycle | 67 | 1 | 15 | 0.000519 |
| ArkPrism no-receiver | ArkPrism unbounded-lifecycle | 67 | 1 | 3 | 0.625 |

## Per-category F1

| Tool/configuration | Aliasing | Anonymous Constructs | Array-Like Structures | Field and Object Sensitivity | General Language Features | Lifecycle Modeling | OpenHarmony Specific APIs |
|---|---:|---:|---:|---:|---:|---:|---:|
| HapFlow artifact reproduction | 100.00% | 93.33% | 88.89% | 100.00% | 91.89% | 96.00% | 100.00% |
| ArkPrism full | 100.00% | 100.00% | 100.00% | 100.00% | 100.00% | 85.71% | 100.00% |
| ArkPrism callback-off | 100.00% | 100.00% | 100.00% | 100.00% | 100.00% | 85.71% | 100.00% |
| ArkPrism no-ir | 100.00% | 66.67% | 85.71% | 100.00% | 71.43% | 85.71% | 100.00% |
| ArkPrism no-receiver | 100.00% | 100.00% | 100.00% | 100.00% | 97.30% | 85.71% | 100.00% |
| ArkPrism unbounded-lifecycle | 100.00% | 100.00% | 100.00% | 100.00% | 100.00% | 91.67% | 100.00% |

## Errors and incomplete cases

### HapFlow artifact reproduction

- FN `Anonymous_Constructs__AnonymousClass2`: reported flows=0
- FP `Array_Like_Structures__ArrayIndexNoLeak`: reported flows=1
- FN `General_Language_Features__Exceptions4`: reported flows=0
- FP `General_Language_Features__VirtualDispatch2`: reported flows=1
- FP `General_Language_Features__VirtualDispatch3`: reported flows=1
- FP `Lifecycle_Modeling__UnreachableFlow`: reported flows=1
### ArkPrism full

- FN `Lifecycle_Modeling__ActivityLifecycle4`: reported flows=0
- FN `Lifecycle_Modeling__BackupExtensionAbility`: reported flows=0
- FN `Lifecycle_Modeling__Button1`: reported flows=0

### ArkPrism callback-off

- FN `Lifecycle_Modeling__ActivityLifecycle4`: reported flows=0
- FN `Lifecycle_Modeling__BackupExtensionAbility`: reported flows=0
- FN `Lifecycle_Modeling__Button1`: reported flows=0

### ArkPrism no-ir

- FN `Anonymous_Constructs__AnonymousClass1`: reported flows=0
- FN `Anonymous_Constructs__AnonymousClass2`: reported flows=0
- FN `Anonymous_Constructs__AnonymousMethod3`: reported flows=0
- FN `Anonymous_Constructs__AnonymousMethod8`: reported flows=0
- FN `Array_Like_Structures__ArrayCopy`: reported flows=0
- FN `General_Language_Features__Clone1`: reported flows=0
- FN `General_Language_Features__Clone2`: reported flows=0
- FN `General_Language_Features__Closure1`: reported flows=0
- FN `General_Language_Features__Closure2`: reported flows=0
- FN `General_Language_Features__Exceptions3`: reported flows=0
- FN `General_Language_Features__Exceptions4`: reported flows=0
- FN `General_Language_Features__MulFields`: reported flows=0
- FN `General_Language_Features__VirtualDispatch1`: reported flows=0
- FN `Lifecycle_Modeling__ActivityLifecycle4`: reported flows=0
- FN `Lifecycle_Modeling__BackupExtensionAbility`: reported flows=0
- FN `Lifecycle_Modeling__Button1`: reported flows=0

### ArkPrism no-receiver

- FP `General_Language_Features__VirtualDispatch3`: reported flows=1
- FN `Lifecycle_Modeling__ActivityLifecycle4`: reported flows=0
- FN `Lifecycle_Modeling__BackupExtensionAbility`: reported flows=0
- FN `Lifecycle_Modeling__Button1`: reported flows=0

### ArkPrism unbounded-lifecycle

- FN `Lifecycle_Modeling__ActivityLifecycle4`: reported flows=0
- FP `Lifecycle_Modeling__UnreachableFlow`: reported flows=1
