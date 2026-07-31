# Corpus Solver Migration

| Measure | Baseline | Candidate | Delta |
|---|---:|---:|---:|
| Unique paths | 457 | 458 | 1 |
| Unique endpoints | 448 | 449 | 1 |
| Exact path keys | 457 | 458 | 1 |
| IFDS edges | 3006311 | 3006526 | 215 |
| Isolated runtime (s) | 18442.5 | 17468.9 | -973.6 |

Endpoint set preserved: **false** (448 matched, 0 removed, 1 added).

Exact path set preserved: **false** (457 matched, 0 removed, 1 added).

## Provenance transitions

| Transition | Endpoints |
|---|---:|
| ifds -> ifds | 324 |
| async_supplement -> async_supplement | 73 |
| both -> both | 47 |
| async_supplement+ifds -> async_supplement+ifds | 4 |

## Transfer-derivation transitions

| Transition | Endpoints |
|---|---:|
| (none) -> (none) | 433 |
| promise_then -> promise_then | 15 |
