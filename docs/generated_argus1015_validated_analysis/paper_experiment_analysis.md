# ARGUS-1015 Paper-Style Experiment Analysis

- Generated at: 2026-07-04T02:17:00.266Z
- Projects: 1015
- Files analyzed: 31433
- Methods analyzed: 238271
- Privacy API usages: 1295
- Call chains: 1295
- Taint flows: 1788

## Localization Metrics

| Level |TP |FP* |FN |Micro Precision* |Micro Recall |Micro F1* |Macro Precision* |Macro Recall |
|---|---|---|---|---|---|---|---|---|
| Namespace+method | 636 | 104 | 90 | 85.95% | 87.60% | 86.77% | 92.86% | 94.75% |
| Strict package signature | 479 | 280 | 140 | 63.11% | 77.38% | 69.52% | 91.55% | 95.57% |

*Namespace+method is the primary localization metric. Its ground truth is source presence, meaning the application imports a related Harmony package and contains the configured API method/property token; it does not require proving an IR call.
*Strict package signature is an alias-sensitivity diagnostic, not the main recall metric.

## Coverage and Flow Metrics

| Metric |Value |
|---|---|
| Qualified source missing in report | 0 |
| Presence source missing in report | 228 |
| Raw-to-presence source ratio | 2.35% |
| Raw-to-qualified source ratio | 1.87% |
| Call-chain coverage | 100.00% |
| Chains with sinks | 724/1295 (55.91%) |
| Taint path coverage | 100.00% |
| Taint flows per API usage | 1.38 |

## Distribution Highlights

| Distribution |Min |P25 |Median |P75 |P90 |P95 |Max |Mean |
|---|---|---|---|---|---|---|---|---|
| Files/project | 1 | 9 | 13 | 25 | 67 | 119 | 1620 | 30.97 |
| Methods/project | 1 | 52 | 86 | 177 | 474 | 967 | 10757 | 234.75 |
| APIs/project | 0 | 0 | 0 | 0 | 3 | 6 | 57 | 1.28 |
| Chain length | 1 | 1 | 1 | 2 | 3 | 4 | 9 | 1.88 |
| Taint path length | 2 | 3 | 3 | 5 | 6 | 7 | 16 | 3.77 |

## Top API Packages

| Package |Count |
|---|---|
| @kit.BasicServicesKit | 364 |
| @ohos.deviceInfo | 175 |
| @kit.NetworkKit | 105 |
| @kit.ConnectivityKit | 93 |
| @kit.LocationKit | 87 |
| @kit.SensorServiceKit | 67 |
| @kit.UserAuthenticationKit | 43 |
| @kit.CameraKit | 38 |
| @ohos.file.photoAccessHelper | 36 |
| @ohos.distributedDeviceManager | 30 |

## Top Privacy Categories

| Category |Count |
|---|---|
| device_identity.hardware | 357 |
| network.connectivity | 148 |
| user_data.clipboard | 115 |
| location | 102 |
| network.bluetooth | 85 |
| device_status.sensor | 76 |
| network.wifi | 69 |
| device_identity.software | 64 |
| user_data.media | 55 |
| media.camera | 49 |

## Top Projects by API Usages

| Project |Files |Methods |APIs |Chains |Sinks |Taint Flows |
|---|---|---|---|---|---|---|
| Wechat_HarmonyOS | 59 | 475 | 57 | 57 | 65 | 43 |
| CommonAppDevelopment | 1620 | 10757 | 54 | 54 | 44 | 205 |
| legado-Harmony-main | 360 | 3576 | 52 | 52 | 77 | 53 |
| Snake_NEXT-main | 45 | 441 | 50 | 50 | 40 | 63 |
| harmony-next-music-sharing | 87 | 1203 | 48 | 48 | 24 | 28 |
| STUFFS_NEXT-master | 29 | 366 | 45 | 45 | 63 | 44 |
| applications_settings | 163 | 2200 | 41 | 41 | 7 | 44 |
| harmonyos4me_ResponsiveLayout | 63 | 446 | 41 | 41 | 52 | 5 |
| harmonyos4me_ZUtils | 107 | 798 | 29 | 29 | 26 | 29 |
| harmonyos_samples_network-query | 14 | 127 | 26 | 26 | 28 | 16 |
| harmonyProject-master | 60 | 470 | 26 | 26 | 19 | 22 |
| Photos | 126 | 1336 | 22 | 22 | 5 | 41 |
| applications_systemui | 273 | 2494 | 20 | 20 | 1 | 2 |
| harmonyos4me_MultiVideoApplication | 58 | 408 | 20 | 20 | 15 | 3 |
| UserAuthentication | 8 | 113 | 18 | 18 | 36 | 0 |

## Top Projects by Taint Flows

| Project |APIs |Sinks |Taint Flows |
|---|---|---|---|
| CommonAppDevelopment | 54 | 44 | 205 |
| Snake_NEXT-main | 50 | 40 | 63 |
| legado-Harmony-main | 52 | 77 | 53 |
| applications_settings | 41 | 7 | 44 |
| STUFFS_NEXT-master | 45 | 63 | 44 |
| VideoTrimmer | 2 | 0 | 43 |
| Wechat_HarmonyOS | 57 | 65 | 43 |
| Photos | 22 | 5 | 41 |
| aloeplayer_ohos | 6 | 2 | 29 |
| harmonyos4me_ZUtils | 29 | 26 | 29 |
| harmony-next-music-sharing | 48 | 24 | 28 |
| MediaCollections | 1 | 0 | 28 |
| HarmonyOS-Inno | 12 | 14 | 27 |
| MediaFullScreen | 0 | 0 | 23 |
| VideoSwitching | 0 | 0 | 23 |
