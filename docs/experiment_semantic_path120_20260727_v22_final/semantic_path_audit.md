# Semantic Path Audit

Queue SHA-256: `9ddd1df187e7b3bdefd685a7bc879913cd21352c20699f94c093ec4ef3f8518d`

| Dimension | Correct | Audited | Estimate | 95% Wilson CI |
|---|---:|---:|---:|---:|
| sourceIdentityCorrect | 120 | 120 | 100.00% | 96.90%--100.00% |
| sinkIdentityCorrect | 120 | 120 | 100.00% | 96.90%--100.00% |
| explicitDataDependence | 114 | 120 | 95.00% | 89.52%--97.69% |
| reachabilityConsistent | 114 | 120 | 95.00% | 89.52%--97.69% |
| provenanceCorrect | 120 | 120 | 100.00% | 96.90%--100.00% |
| fullPathCorrect | 114 | 120 | 95.00% | 89.52%--97.69% |

## Rejected Paths

- `3b5e1b6b6fe34cb83c4f5c66` (HarmonyOS-Inno): Manual source inspection: onNewWant stores want.uri in OHBridge.wantUri, but InputPage line 65 displays the constant message "请输入内容"; no read of wantUri reaches this Toast.
- `27c04af17949a2b4711e2b8b` (HarmonyOS-Inno): Manual source inspection: onCreate stores want.uri in OHBridge.wantUri, while InputPage line 71 formats this.inputText; the reported path omits any value-producing read that could connect the fields.
- `ed3853b17be41cbf07e5e304` (VoiceCallDemo): Manual source inspection: the UIAbility Want reaches readWant, but the reported Toast at Index line 51 is driven only by the permission result and a resource constant.
- `c043c9c9f9de6adb00760dce` (VoiceCallDemo): Manual source inspection: readWant selects an emitter event, but the listener passes a hard-coded EVENT_UI_ANSWER constant to the logger; this is control selection, not explicit value dependence.
- `a0cb9d779f2ceac08f8d6113` (HarmonyOS-Inno): Manual source inspection: onNewWant stores want.uri in OHBridge.wantUri, while InputPage line 71 displays this.inputText; the reported component transition does not carry the stored URI.
- `30cbbcf18141245ab03075a3` (HarmonyOS-Inno): Manual source inspection: onCreate stores want.uri in OHBridge.wantUri, but InputPage line 65 displays a fixed validation message and never reads that field.
