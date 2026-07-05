# ARGUS-1015 Paper-Style Experiment Analysis

- Generated at: 2026-07-05T11:21:52.792Z
- Projects: 1015
- Files analyzed: 31433
- Methods analyzed: 238271
- Privacy API usages: 1757
- Call chains: 1757
- Taint flows: 1792

## Localization Metrics

| Level |TP |FP* |FN |Micro Precision* |Micro Recall |Micro F1* |Macro Precision* |Macro Recall |
|---|---|---|---|---|---|---|---|---|
| Namespace+method | 745 | 90 | 0 | 89.22% | 100.00% | 94.30% | 96.77% | 100.00% |
| Strict package signature | 483 | 371 | 142 | 56.56% | 77.28% | 65.31% | 87.10% | 95.68% |

*Namespace+method is the primary localization metric. Its ground truth is source presence, meaning the application imports a related Harmony package and contains the configured API method/property token; it does not require proving an IR call.
*Strict package signature is an alias-sensitivity diagnostic, not the main recall metric.

## Coverage and Flow Metrics

| Metric |Value |
|---|---|
| Qualified source missing in report | 0 |
| Presence source missing in report | 0 |
| Raw-to-presence source ratio | 2.39% |
| Raw-to-qualified source ratio | 1.88% |
| Call-chain coverage | 100.00% |
| Chains with sinks | 839/1757 (47.75%) |
| Taint path coverage | 100.00% |
| Taint flows per API usage | 1.02 |

## Distribution Highlights

| Distribution |Min |P25 |Median |P75 |P90 |P95 |Max |Mean |
|---|---|---|---|---|---|---|---|---|
| Files/project | 1 | 9 | 13 | 25 | 67 | 119 | 1620 | 30.97 |
| Methods/project | 1 | 52 | 86 | 177 | 474 | 967 | 10757 | 234.75 |
| APIs/project | 0 | 0 | 0 | 0 | 4 | 9 | 128 | 1.73 |
| Chain length | 1 | 1 | 1 | 2 | 3 | 4 | 9 | 1.77 |
| Taint path length | 2 | 3 | 3 | 5 | 6 | 7 | 16 | 3.77 |

## Top API Packages

| Package |Count |
|---|---|
| @kit.ArkUI | 438 |
| @kit.BasicServicesKit | 376 |
| @ohos.deviceInfo | 175 |
| @kit.NetworkKit | 105 |
| @kit.ConnectivityKit | 93 |
| @kit.LocationKit | 87 |
| @kit.SensorServiceKit | 67 |
| @kit.UserAuthenticationKit | 43 |
| @kit.CameraKit | 38 |
| @ohos.file.photoAccessHelper | 36 |

## Top Privacy Categories

| Category |Count |
|---|---|
| device_identity.screen | 438 |
| device_identity.hardware | 357 |
| network.connectivity | 148 |
| user_data.clipboard | 115 |
| location | 102 |
| network.bluetooth | 85 |
| device_status.sensor | 76 |
| network.wifi | 69 |
| device_identity.software | 64 |
| user_data.media | 55 |

## Top Projects by API Usages

| Project |Files |Methods |APIs |Chains |Sinks |Taint Flows |
|---|---|---|---|---|---|---|
| CommonAppDevelopment | 1620 | 10757 | 128 | 128 | 57 | 205 |
| Wechat_HarmonyOS | 59 | 475 | 65 | 65 | 75 | 43 |
| legado-Harmony-main | 360 | 3576 | 61 | 61 | 81 | 53 |
| Snake_NEXT-main | 45 | 441 | 50 | 50 | 42 | 63 |
| harmony-next-music-sharing | 87 | 1203 | 48 | 48 | 25 | 28 |
| STUFFS_NEXT-master | 29 | 366 | 45 | 45 | 64 | 44 |
| applications_settings | 163 | 2200 | 43 | 43 | 7 | 44 |
| harmonyos4me_ResponsiveLayout | 63 | 446 | 41 | 41 | 52 | 5 |
| harmonyos4me_ZUtils | 107 | 798 | 33 | 33 | 26 | 29 |
| harmonyos4me_MultiVideoApplication | 58 | 408 | 32 | 32 | 15 | 3 |
| harmony-arkts-chat-app-ui | 38 | 481 | 29 | 29 | 0 | 1 |
| harmonyos_samples_network-query | 14 | 127 | 26 | 26 | 28 | 16 |
| harmonyProject-master | 60 | 470 | 26 | 26 | 20 | 22 |
| harmonyos_samples_CustomCamera | 32 | 405 | 23 | 23 | 23 | 8 |
| Dictionareow | 32 | 405 | 22 | 22 | 30 | 13 |

## Top Projects by Taint Flows

| Project |APIs |Sinks |Taint Flows |
|---|---|---|---|
| CommonAppDevelopment | 128 | 57 | 205 |
| Snake_NEXT-main | 50 | 42 | 63 |
| legado-Harmony-main | 61 | 81 | 53 |
| applications_settings | 43 | 7 | 44 |
| STUFFS_NEXT-master | 45 | 64 | 44 |
| VideoTrimmer | 2 | 0 | 43 |
| Wechat_HarmonyOS | 65 | 75 | 43 |
| Photos | 22 | 5 | 41 |
| aloeplayer_ohos | 10 | 2 | 29 |
| harmonyos4me_ZUtils | 33 | 26 | 29 |
| harmony-next-music-sharing | 48 | 25 | 28 |
| MediaCollections | 1 | 0 | 28 |
| HarmonyOS-Inno | 12 | 14 | 27 |
| MediaFullScreen | 0 | 0 | 23 |
| VideoSwitching | 0 | 0 | 23 |

