# Large-Corpus Analysis

Generated: 2026-07-31T05:47:17.290Z

> This report describes ArkPrism output. It does not estimate accuracy or recall because the corpus has no independent exhaustive oracle.

## Completion and evidence

| Measure | Count | Unit |
|---|---:|---|
| Completed reports | 1014 | Project |
| Analysis errors | 0 | Project |
| Files analyzed | 31205 | ArkTS/TypeScript file |
| Methods analyzed | 233894 | Ark method |
| Privacy API usages | 2339 | Reported occurrence |
| Call chains | 2339 | Reported chain |
| Detector-local sinks | 1755 | Local/callback sink observation |
| Configured-query may-paths | 458 | Deduplicated static path |
| Configured source endpoints | 320 | Unique path source endpoint |
| Configured sink endpoints | 416 | Unique path sink endpoint |
| Privacy-data may-paths | 258 | Typed privacy source path |
| Framework-input may-paths | 200 | Modeled input path |
| Endpoint links | 252 | Detector-to-path join |

## Project-level prevalence

| Evidence | Projects | Rate |
|---|---:|---:|
| API-positive | 353 | 34.81% |
| Chain-positive | 353 | 34.81% |
| Detector-sink-positive | 224 | 22.09% |
| Configured-path-positive | 183 | 18.05% |
| Configured-source-endpoint-positive | 183 | 18.05% |
| Configured-sink-endpoint-positive | 183 | 18.05% |
| Privacy-path-positive | 31 | 3.06% |
| Framework-input-path-positive | 159 | 15.68% |

## Runtime

- Median/project: 15.7 s
- P95/project: 21.6 s
- Maximum/project: 380.2 s
- Sum of isolated-process CPU wall times: 17468.9 s

## API concentration

- Top 10 projects: 24.54%
- Top 50 projects: 54.98%
- Top 120 projects: 77.85%
- API-usage Gini: 0.858
- API-usage HHI: 0.0105 (effective projects: 95.6)

## Project-level evidence overlap

> A/C/S/T denote detector API, report call-chain, detector-local sink, and configured-query path evidence. Co-occurrence is descriptive and is not an accuracy, containment, or pipeline-conversion estimate.

| State | Projects |
|---|---:|
| A0-C0-S0-T0 | 570 |
| A1-C1-S1-T0 | 157 |
| A1-C1-S0-T0 | 104 |
| A0-C0-S0-T1 | 91 |
| A1-C1-S1-T1 | 67 |
| A1-C1-S0-T1 | 25 |

- Chain-positive given API-positive: 100.00%
- Sink-positive given API-positive: 63.46%
- Configured-path-positive given detector-API-positive: 26.06%
- Configured-path-positive given detector-sink-positive: 29.91%

## Scale and runtime

| Method-size bin | Projects | Median methods | Median runtime (s) | API-positive | Sink-positive | Taint-positive |
|---|---:|---:|---:|---:|---:|---:|
| Q1 (smallest) | 203 | 34 | 15.3 | 11.82% | 4.43% | 4.43% |
| Q2 | 203 | 57 | 15.5 | 24.14% | 8.37% | 21.67% |
| Q3 | 203 | 86 | 15.6 | 25.62% | 12.81% | 19.21% |
| Q4 | 203 | 145 | 15.7 | 34.48% | 27.59% | 20.20% |
| Q5 (largest) | 202 | 474 | 17.6 | 78.22% | 57.43% | 24.75% |

| Variables | N | Spearman rho |
|---|---:|---:|
| filesVsMethods | 1014 | 0.9226 |
| methodsVsRuntimeMs | 1014 | 0.4589 |
| filesVsRuntimeMs | 1014 | 0.4284 |
| methodsVsApis | 1014 | 0.4847 |
| apisVsSinks | 1014 | 0.7887 |
| apisVsTaintFlows | 1014 | 0.1838 |
| sinksVsTaintFlows | 1014 | 0.197 |

Log(1+methods) vs. log(1+runtime): slope=0.0728, R2=0.2048.

## Solver integrity

- IFDS edges processed: 3006526; median/project: 739; P95: 10811; maximum: 187278
- Raw IFDS paths: 380
- Raw asynchronous-supplement paths: 127
- Paths before exact deduplication: 507
- Unique configured-query paths: 458
- Paths using Promise-success call flow: 15
- Paths using Promise-return flow: 0
- Exact duplicates removed: 49
- Malformed CFG edges skipped: 5323
- Strict per-report checks: 1014; failures: 0

| Path provenance | Unique paths |
|---|---:|
| ifds | 331 |
| async_supplement | 78 |
| both | 49 |

| Source kind | Unique paths |
|---|---:|
| privacy_data | 258 |
| framework_input | 200 |

| Transfer derivation | Unique paths |
|---|---:|
| (none) | 443 |
| promise_then | 15 |

| Final carrier state | Unique paths |
|---|---:|
| framework_argument | 200 |
| callback_payload | 120 |
| direct_value | 99 |
| promise_payload | 39 |

## Evidence traceability

- Median call-chain edges: 1; P95: 4
- Median taint-path statements: 5; P95: 9
- Async call chains: 424
- Local-fallback call chains: 0
- Permission-bearing API usages: 1075
- Resolved trace endpoints: 100.00% (3337/3337)
- Detector-to-path endpoint links: 252; linked configured-query paths: 248/458; invalid links: 0

## Profiling categories

| Category | API usages |
|---|---:|
| network.connectivity | 427 |
| device_identity.screen | 403 |
| device_identity.hardware | 353 |
| user_data.account | 189 |
| user_data.clipboard | 119 |
| location | 102 |
| network.bluetooth | 82 |
| user_data.media | 77 |
| device_status.sensor | 76 |
| device_identity.biometric | 67 |
| media.camera | 65 |
| device_identity.software | 63 |
| network.wifi | 58 |
| device_status.audio | 49 |
| user_data.audio | 41 |
| device_identity.distributed | 37 |
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
| data_return | 58 |
| network | 26 |
