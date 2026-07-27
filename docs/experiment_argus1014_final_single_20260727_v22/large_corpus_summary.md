# Large-Corpus Analysis

Generated: 2026-07-27T10:48:28.310Z

> This report describes ArkPrism output. It does not estimate accuracy or recall because the corpus has no independent exhaustive oracle.

## Completion and evidence

| Measure | Count | Unit |
|---|---:|---|
| Completed reports | 1014 | Project |
| Analysis errors | 0 | Project |
| Files analyzed | 31205 | ArkTS/TypeScript file |
| Methods analyzed | 233894 | Ark method |
| Privacy API usages | 2336 | Reported occurrence |
| Call chains | 2336 | Reported chain |
| Detector-local sinks | 1754 | Local/callback sink observation |
| Configured-query may-paths | 449 | Deduplicated static path |
| Configured source endpoints | 308 | Unique path source endpoint |
| Configured sink endpoints | 410 | Unique path sink endpoint |
| Privacy-data may-paths | 243 | Typed privacy source path |
| Framework-input may-paths | 206 | Modeled input path |
| Endpoint links | 236 | Detector-to-path join |

## Project-level prevalence

| Evidence | Projects | Rate |
|---|---:|---:|
| API-positive | 353 | 34.81% |
| Chain-positive | 353 | 34.81% |
| Detector-sink-positive | 224 | 22.09% |
| Configured-path-positive | 181 | 17.85% |
| Configured-source-endpoint-positive | 181 | 17.85% |
| Configured-sink-endpoint-positive | 181 | 17.85% |
| Privacy-path-positive | 29 | 2.86% |
| Framework-input-path-positive | 159 | 15.68% |

## Runtime

- Median/project: 20.2 s
- P95/project: 26.9 s
- Maximum/project: 577.9 s
- Sum of isolated-process CPU wall times: 22208.0 s

## API concentration

- Top 10 projects: 24.49%
- Top 50 projects: 54.92%
- Top 120 projects: 77.83%
- API-usage Gini: 0.857
- API-usage HHI: 0.0104 (effective projects: 95.8)

## Project-level evidence overlap

> A/C/S/T denote detector API, report call-chain, detector-local sink, and configured-query path evidence. Co-occurrence is descriptive and is not an accuracy, containment, or pipeline-conversion estimate.

| State | Projects |
|---|---:|
| A0-C0-S0-T0 | 570 |
| A1-C1-S1-T0 | 159 |
| A1-C1-S0-T0 | 104 |
| A0-C0-S0-T1 | 91 |
| A1-C1-S1-T1 | 65 |
| A1-C1-S0-T1 | 25 |

- Chain-positive given API-positive: 100.00%
- Sink-positive given API-positive: 63.46%
- Configured-path-positive given detector-API-positive: 25.50%
- Configured-path-positive given detector-sink-positive: 29.02%

## Scale and runtime

| Method-size bin | Projects | Median methods | Median runtime (s) | API-positive | Sink-positive | Taint-positive |
|---|---:|---:|---:|---:|---:|---:|
| Q1 (smallest) | 203 | 34 | 19.6 | 11.82% | 4.43% | 4.43% |
| Q2 | 203 | 57 | 19.7 | 24.14% | 8.37% | 21.18% |
| Q3 | 203 | 86 | 19.9 | 25.62% | 12.81% | 18.72% |
| Q4 | 203 | 145 | 20.1 | 34.48% | 27.59% | 20.20% |
| Q5 (largest) | 202 | 474 | 22.1 | 78.22% | 57.43% | 24.75% |

| Variables | N | Spearman rho |
|---|---:|---:|
| filesVsMethods | 1014 | 0.9226 |
| methodsVsRuntimeMs | 1014 | 0.314 |
| filesVsRuntimeMs | 1014 | 0.2854 |
| methodsVsApis | 1014 | 0.4847 |
| apisVsSinks | 1014 | 0.7887 |
| apisVsTaintFlows | 1014 | 0.1752 |
| sinksVsTaintFlows | 1014 | 0.1867 |

Log(1+methods) vs. log(1+runtime): slope=0.0758, R2=0.1833.

## Solver integrity

- IFDS edges processed: 3158469; median/project: 805; P95: 11396; maximum: 197173
- Raw IFDS paths: 365
- Raw asynchronous-supplement paths: 127
- Paths before exact deduplication: 492
- Unique configured-query paths: 449
- Exact duplicates removed: 43
- Malformed CFG edges skipped: 5323
- Strict per-report checks: 1014; failures: 0

| Path provenance | Unique paths |
|---|---:|
| ifds | 322 |
| async_supplement | 84 |
| both | 43 |

| Source kind | Unique paths |
|---|---:|
| privacy_data | 243 |
| framework_input | 206 |

## Evidence traceability

- Median call-chain edges: 1; P95: 4
- Median taint-path statements: 5; P95: 10
- Async call chains: 424
- Local-fallback call chains: 0
- Permission-bearing API usages: 1083
- Resolved trace endpoints: 100.00% (3316/3316)
- Detector-to-path endpoint links: 236; linked configured-query paths: 233/449; invalid links: 0

## Profiling categories

| Category | API usages |
|---|---:|
| network.connectivity | 427 |
| device_identity.screen | 403 |
| device_identity.hardware | 353 |
| user_data.account | 188 |
| user_data.clipboard | 119 |
| location | 102 |
| network.bluetooth | 82 |
| user_data.media | 77 |
| device_status.sensor | 76 |
| device_identity.biometric | 67 |
| media.camera | 65 |
| device_identity.software | 63 |
| network.wifi | 58 |
| device_status.audio | 47 |
| user_data.audio | 41 |
| device_identity.distributed | 40 |
| device_identity.ad_tracking | 25 |
| user_data.sms | 19 |
| user_data.contacts | 18 |
| device_identity.network | 15 |

## Sink types

| Sink type | Observations |
|---|---:|
| log | 1441 |
| ui_display | 136 |
| storage | 94 |
| data_return | 57 |
| network | 26 |
