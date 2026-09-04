# Rule-set Audit

This report checks structural consistency and provenance hashes. It does not establish that the rule sets are semantically exhaustive.

| Measure | Value |
|---|---:|
| Detector package groups | 24 |
| Detector entries | 295 |
| Unique package-namespace-member keys | 172 |
| Unique namespace-member keys | 171 |
| Direct / manager / property entries | 210 / 69 / 16 |
| Entries with receiver factories | 0 |
| Distinct receiver factories | 0 |
| Entries with permission metadata | 295 |
| IFDS source entries | 166 |
| Typed privacy-data source entries | 166 |
| IFDS sink entries | 29 |

## Integrity Findings

| Check | Count |
|---|---:|
| Missing detector fields | 0 |
| Invalid directCall values | 0 |
| Exact detector duplicates | 1 |
| Detector keys with multiple access modes | 0 |
| PAC mapping conflicts | 0 |
| Manager entries relying on type/target evidence | 69 |
| Invalid IFDS source entries | 0 |
| Invalid IFDS sink entries | 0 |

The JSON companion retains every duplicate, conflict, and missing-field record for review.
