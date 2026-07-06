# ArkPrism Ablation Experiment on Top-120 Manual Benchmark

Generated at: 2026-07-06

## RQ3: Detector Contribution

What is the incremental contribution of each detector family to ArkPrism's overall detection capability?

## Methodology

Using the Top-120 manual benchmark (666 ground-truth API usages, 129 unique `namespace|method` pairs), we simulate removing each detector family and measure the impact on recall.

ArkPrism's 4 detector families:
1. **Direct invoke**: `namespace.method()` — direct call on the SDK namespace
2. **Assigned invoke**: `let x = namespace.method()` — call with result assigned to a variable
3. **Indirect invoke**: `manager.method()` — call on a manager/helper object obtained via factory
4. **Privacy constants**: `namespace.property` — field/property access (not a method call)

## Leave-One-Out Ablation

Removing each family and measuring recall drop:

| Removed Family | Lost Methods | Method Recall | Lost Usages | Usage Recall |
|---|---:|---:|---:|---:|
| (none — full ArkPrism) | 0 | **100.0%** | 0 | **100.0%** |
| Direct invoke | 23 | 82.2% | 110 | 83.5% |
| Assigned invoke | 49 | 62.0% | 241 | 63.8% |
| Indirect invoke | 18 | 86.0% | 103 | 84.5% |
| Privacy constants | 25 | 80.6% | 148 | 77.8% |

**Key findings:**
- Removing **assigned invoke** causes the largest recall drop (62.0% method recall), as it covers the most API patterns
- Removing **privacy constants** loses 25 unique APIs and 148 usages (77.8% usage recall)
- Removing **indirect invoke** loses 18 unique APIs including critical manager-pattern APIs
- Removing **direct invoke** loses 23 APIs but many overlap with other families

## Incremental Contribution (Ordered)

Adding families one by one in dependency order:

| Family | Incremental Methods | Cumulative Methods | Cumulative Rate | Incremental Usages | Cumulative Usages | Cumulative Rate |
|---|---:|---:|---:|---:|---:|---:|
| Direct invoke | 36 | 36 | 27.9% | 117 | 117 | 17.6% |
| Assigned invoke | 50 | 86 | 66.7% | 298 | 415 | 62.3% |
| Indirect invoke | 18 | 104 | 80.6% | 103 | 518 | 77.8% |
| Privacy constants | 25 | 129 | 100.0% | 148 | 666 | 100.0% |

**Key findings:**
- Assigned invoke contributes the most incremental methods (+50) and usages (+298)
- Indirect invoke contributes 18 unique methods that no other family can detect (e.g., `photoaccesshelper|createAsset`, `camera|createCameraInput`)
- Privacy constants contributes 25 unique methods (e.g., `deviceInfo|brand`, `deviceInfo|serial`) — 0% detectable by any method-signature-based approach

## Per-Project Impact of Indirect Invoke and Privacy Constants

| Project | Total APIs | Indirect-only | Constant-only | Has Indirect | Has Constant |
|---|---:|---:|---:|---:|---:|
| Wechat_HarmonyOS | 44 | 7 | 13 | 8 | 13 |
| harmony-next-music-sharing | 41 | 4 | 20 | 4 | 20 |
| legado-Harmony-main | 38 | 8 | 12 | 9 | 12 |
| CommonAppDevelopment | 34 | 4 | 2 | 7 | 2 |
| STUFFS_NEXT-master | 33 | 4 | 12 | 4 | 12 |
| harmonyos4me_ZUtils | 26 | 0 | 22 | 1 | 22 |
| harmonyProject-master | 20 | 4 | 2 | 4 | 2 |
| Snake_NEXT-main | 19 | 4 | 1 | 4 | 1 |
| applications_settings | 13 | 1 | 5 | 1 | 5 |
| harmonyos_samples_CustomCamera | 8 | 3 | 0 | 4 | 0 |

**Key findings:**
- Privacy constants are especially prevalent in utility libraries (e.g., `harmonyos4me_ZUtils`: 22/26 APIs are constants)
- Indirect invoke appears in feature-rich apps (e.g., `Wechat_HarmonyOS`: 8 APIs, `legado-Harmony-main`: 9 APIs)

## Package Normalization Ablation

594 of 675 API rules use `@kit.*` packages that do not directly correspond to `@ohos.*` SDK module names. Without package normalization (mapping `@kit.*` → `@ohos.*`):

| Metric | Count | Rate |
|---|---:|---:|
| Methods using @kit.*-only APIs | 59 / 129 | 45.7% |
| Usages using @kit.*-only APIs | 219 / 666 | 32.9% |

Without package normalization, nearly half of the detected APIs would be unresolvable.

## Conclusion

1. **Each detector family contributes irreplaceable coverage**: removing any family drops method recall below 86%.
2. **Indirect invoke** detects 18 APIs that no other family covers, including critical manager-pattern APIs like `photoaccesshelper|createAsset` and `camera|createCameraInput`.
3. **Privacy constants** detects 25 APIs (148 usages) that method-signature-based approaches fundamentally cannot handle.
4. **Package normalization** is essential: without it, 45.7% of detected methods would be lost.
5. The 4 families are **complementary**, not redundant — each covers API patterns the others miss.
