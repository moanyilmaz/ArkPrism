# Corpus Redundancy and Sensitivity Analysis

## Corpus structure

| Projects | Source files | Unique token fingerprints | Duplicate file occurrences | Exact clone clusters | Near-clone clusters |
|---:|---:|---:|---:|---:|---:|
| 1014 | 31998 | 21430 | 10568 | 9 | 11 |

## Detection-rate sensitivity

| Sampling unit | N | API | Call chain | Sink | Taint flow |
|---|---:|---:|---:|---:|---:|
| Project | 1014 | 34.81% | 34.81% | 22.09% | 17.85% |
| One per exact-clone cluster | 995 | 35.18% | 35.18% | 22.31% | 17.99% |
| One per near-clone cluster | 993 | 35.05% | 35.05% | 22.26% | 18.03% |

The deduplicated rows are sensitivity analyses, not replacements for the project-level census.
