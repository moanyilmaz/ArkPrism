# Corpus Solver Migration

| Measure | Baseline | Candidate | Delta |
|---|---:|---:|---:|
| Unique paths | 457 | 458 | 1 |
| Unique endpoints | 448 | 449 | 1 |
| Exact path keys | 457 | 458 | 1 |
| IFDS edges | 2987356 | 3006526 | 19170 |
| Isolated runtime (s) | 24198.1 | 17468.9 | -6729.3 |

Endpoint set preserved: **false** (448 matched, 0 removed, 1 added).

Exact path set preserved: **false** (457 matched, 0 removed, 1 added).

## Provenance transitions

| Transition | Endpoints |
|---|---:|
| ifds -> ifds | 324 |
| async_supplement -> async_supplement | 73 |
| both -> both | 46 |
| async_supplement+ifds -> async_supplement+ifds | 4 |
| async_supplement -> both | 1 |

## Transfer-derivation transitions

| Transition | Endpoints |
|---|---:|
| (none) -> (none) | 433 |
| promise_then -> promise_then | 14 |
| (none) -> promise_then | 1 |
