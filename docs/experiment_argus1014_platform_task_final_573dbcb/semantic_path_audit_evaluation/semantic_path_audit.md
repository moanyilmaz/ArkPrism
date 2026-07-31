# Semantic Path Audit

Queue SHA-256: `57551efcde104df515c9f05da0810b6145e1d5f32fe9e82a0d30a5b09a025e32`

| Dimension | Correct | Audited | Estimate | 95% Wilson CI |
|---|---:|---:|---:|---:|
| sourceIdentityCorrect | 120 | 120 | 100.00% | 96.90%--100.00% |
| sinkIdentityCorrect | 120 | 120 | 100.00% | 96.90%--100.00% |
| explicitDataDependence | 115 | 120 | 95.83% | 90.62%--98.21% |
| reachabilityConsistent | 115 | 120 | 95.83% | 90.62%--98.21% |
| provenanceCorrect | 120 | 120 | 100.00% | 96.90%--100.00% |
| fullPathCorrect | 115 | 120 | 95.83% | 90.62%--98.21% |

## Rejected Paths

- `3b5e1b6b6fe34cb83c4f5c66` (HarmonyOS-Inno): Manual source inspection: onNewWant stores want.uri in OHBridge.wantUri, but InputPage line 65 displays the constant message "请输入内容"; no read of wantUri reaches this Toast.
- `27c04af17949a2b4711e2b8b` (HarmonyOS-Inno): Manual source inspection: onCreate stores want.uri in OHBridge.wantUri, while InputPage line 71 formats this.inputText; the reported path omits any value-producing read that could connect the fields.
- `b8f4947069338f893938e9a2` (HarmonyOS-Inno): Manual source inspection confirms that EntryAbility.onCreate stores want.uri in OHBridge.wantUri, whereas CameraPicker.ets:34 logs fields of the independent picker.pick result. The reported path contains no read of OHBridge.wantUri and therefore has no explicit value dependence.
- `a0cb9d779f2ceac08f8d6113` (HarmonyOS-Inno): Manual source inspection: onNewWant stores want.uri in OHBridge.wantUri, while InputPage line 71 displays this.inputText; the reported component transition does not carry the stored URI.
- `30cbbcf18141245ab03075a3` (HarmonyOS-Inno): Manual source inspection: onCreate stores want.uri in OHBridge.wantUri, but InputPage line 65 displays a fixed validation message and never reads that field.
