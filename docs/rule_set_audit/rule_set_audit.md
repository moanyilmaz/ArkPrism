# Rule-set Audit

This report checks structural consistency and provenance hashes. It does not establish that the rule sets are semantically exhaustive.

| Measure | Value |
|---|---:|
| Detector package groups | 58 |
| Detector entries | 716 |
| Unique package-namespace-member keys | 710 |
| Unique namespace-member keys | 665 |
| Direct / manager / property entries | 453 / 213 / 50 |
| Entries with receiver factories | 7 |
| Distinct receiver factories | 3 |
| Entries with permission metadata | 568 |
| IFDS source entries | 257 |
| Typed privacy-data source entries | 257 |
| IFDS sink entries | 29 |

## Integrity Findings

| Check | Count |
|---|---:|
| Missing detector fields | 0 |
| Invalid directCall values | 0 |
| Exact detector duplicates | 4 |
| Detector keys with multiple access modes | 1 |
| Manager entries relying on type/target evidence | 207 |
| Invalid IFDS source entries | 0 |
| Invalid IFDS sink entries | 0 |

The JSON companion retains every duplicate, conflict, and missing-field record for review.
