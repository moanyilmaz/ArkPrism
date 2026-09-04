# ArkPrismTop120-PAC-v2 Evaluation

- Projects: 120
- Gold occurrences: 576
- Detected occurrences: 576
- Occurrence TP/FP/FN: 576/0/0
- Occurrence precision: 100.00%
- Occurrence recall: 100.00%
- Occurrence F1: 100.00%
- Precision Wilson 95% CI: [99.34%, 100.00%]
- Recall Wilson 95% CI: [99.34%, 100.00%]
- Project TP/TN/FP/FN: 81/39/0/0
- Project accuracy: 100.00%
- Project sensitivity/specificity: 100.00%/100.00%

The gold set covers executable `.ets`/`.ts` code under each project's declared build-module roots. Metrics below are observations on this fixed benchmark, not a universal guarantee for unseen projects.

## Evaluation Levels

| Level | TP | FP | FN | Precision | Recall | F1 |
|---|---:|---:|---:|---:|---:|---:|
| API occurrences | 576 | 0 | 0 | 100.00% | 100.00% | 100.00% |
| Project-API keys | 356 | 0 | 0 | 100.00% | 100.00% | 100.00% |
| Unique API identities | 95 | 0 | 0 | 100.00% | 100.00% | 100.00% |

## Source Candidate Classification

- Accepted source sites: 496
- Rejected same-name candidates: 746
- TP/TN/FP/FN: 496/746/0/0
- Accuracy: 100.00%
- Specificity: 100.00%

## Evidence Stratification

| Evidence | Gold | TP | FN | Recall |
|---|---:|---:|---:|---:|
| default-import | 62 | 62 | 0 | 100.00% |
| finite-sensor-id-set | 85 | 85 | 0 | 100.00% |
| named-import | 228 | 228 | 0 | 100.00% |
| numeric-sensor-id | 1 | 1 | 0 | 100.00% |
| receiver-origin | 105 | 105 | 0 | 100.00% |
| receiver-type | 81 | 81 | 0 | 100.00% |
| reviewed-receiver-origin | 14 | 14 | 0 | 100.00% |

## Access Kind

| Access | Gold | Detected | TP | FP | FN | Precision | Recall |
|---|---:|---:|---:|---:|---:|---:|---:|
| call | 520 | 520 | 520 | 0 | 0 | 100.00% | 100.00% |
| property | 56 | 56 | 56 | 0 | 0 | 100.00% | 100.00% |

## PAC Data Type

| Data type | Gold | Detected | TP | FP | FN | Precision | Recall |
|---|---:|---:|---:|---:|---:|---:|---:|
| Device information | 240 | 240 | 240 | 0 | 0 | 100.00% | 100.00% |
| Basic information | 95 | 95 | 95 | 0 | 0 | 100.00% | 100.00% |
| User content | 81 | 81 | 81 | 0 | 0 | 100.00% | 100.00% |
| Special category data | 47 | 47 | 47 | 0 | 0 | 100.00% | 100.00% |
| Location information | 45 | 45 | 45 | 0 | 0 | 100.00% | 100.00% |
| Identifiers | 25 | 25 | 25 | 0 | 0 | 100.00% | 100.00% |
| Fitness and health information | 24 | 24 | 24 | 0 | 0 | 100.00% | 100.00% |
| Financial information | 10 | 10 | 10 | 0 | 0 | 100.00% | 100.00% |
| App information | 5 | 5 | 5 | 0 | 0 | 100.00% | 100.00% |
| Transaction information | 4 | 4 | 4 | 0 | 0 | 100.00% | 100.00% |

## API Package

| Package | Gold | Detected | TP | FP | FN | Precision | Recall |
|---|---:|---:|---:|---:|---:|---:|---:|
| @kit.SensorServiceKit | 117 | 117 | 117 | 0 | 0 | 100.00% | 100.00% |
| @kit.BasicServicesKit | 112 | 112 | 112 | 0 | 0 | 100.00% | 100.00% |
| @kit.AccountKit | 81 | 81 | 81 | 0 | 0 | 100.00% | 100.00% |
| @kit.UserAuthenticationKit | 46 | 46 | 46 | 0 | 0 | 100.00% | 100.00% |
| @kit.LocationKit | 45 | 45 | 45 | 0 | 0 | 100.00% | 100.00% |
| @kit.MediaLibraryKit | 40 | 40 | 40 | 0 | 0 | 100.00% | 100.00% |
| @kit.NetworkKit | 35 | 35 | 35 | 0 | 0 | 100.00% | 100.00% |
| @kit.ConnectivityKit | 34 | 34 | 34 | 0 | 0 | 100.00% | 100.00% |
| @kit.AdsKit | 16 | 16 | 16 | 0 | 0 | 100.00% | 100.00% |
| @kit.MediaKit | 14 | 14 | 14 | 0 | 0 | 100.00% | 100.00% |
| @kit.AssetStoreKit | 10 | 10 | 10 | 0 | 0 | 100.00% | 100.00% |
| @kit.CalendarKit | 8 | 8 | 8 | 0 | 0 | 100.00% | 100.00% |
| @kit.AbilityKit | 5 | 5 | 5 | 0 | 0 | 100.00% | 100.00% |
| @kit.TelephonyKit | 5 | 5 | 5 | 0 | 0 | 100.00% | 100.00% |
| @kit.IAPKit | 4 | 4 | 4 | 0 | 0 | 100.00% | 100.00% |
| @kit.PushKit | 3 | 3 | 3 | 0 | 0 | 100.00% | 100.00% |
| @kit.VisionKit | 1 | 1 | 1 | 0 | 0 | 100.00% | 100.00% |

## Run Integrity

- Run status: complete
- Completed/errors: 120/0
- SDK API/version: 26/26.0.0.38
- SDK SHA-256: 223b84b83d81bd4f4822903d7121b17e981a255bb0a1a36a83e0a082e2a9ad45
- Catalog SHA-256: dde9ae33009a5c0f2ed060b59265fe33106c816bdb43075be9c0ffde6a00a3e4
- Implementation source SHA-256: f3e41b4a31e40ce33354e89577348eae0f49bd402509f12688851901e8757f40
- Compiled build SHA-256: 794634e40fa2b24922e96ed51e12e58259bfce384909a1a2bb8498b8f1271b08
- Detector-only mode: true
