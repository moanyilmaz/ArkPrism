# ArkPrism Top-120 PAC-v2 Delivery

This delivery uses the reviewed PAC catalog and OpenHarmony SDK API 26 (`26.0.0.38`).

- Projects: 120
- Reviewed source candidates: 1,242
- Accepted source sites: 496
- Rejected same-name candidates: 746
- Gold API occurrences: 576
- Occurrence TP/FP/FN: 576/0/0
- Project--API-key TP/FP/FN: 356/0/0
- Positive/negative projects: 81/39, all classified correctly

`ArkPrism-minimal-runtime-PAC-v2-final.zip` contains the runnable analyzer, runtime configuration, and the retained Top-120 benchmark labels and metrics. `ArkPrism-Top120-project-sources.zip` contains the complete 120 project trees. The source archive SHA-256 is `CC178D0A1A52CC7F75F8ED84F9F9A748C9F6F93D1D220966FA4BCC997E51833B`.

The per-project JSON and DOT reports remain under `benchmarks/ArkPrismTop120/results-api26-pac-v2-verified-20260904/` in the delivery workspace and are intentionally excluded from the minimal runtime archive.

The retained metrics are benchmark observations. The 95% Wilson interval for occurrence precision and recall is `[99.34%, 100.00%]`.
