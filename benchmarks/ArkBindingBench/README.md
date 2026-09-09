# Source binding and continuation experiments

`cases.js` contains the fixtures and their expected data dependencies. The original
20 cases were fixed before implementation changes. Two event-emission controls
were added after the existing Promise suite exposed a dormant-callback false
positive. The development/validation names record the initial split; both groups
have now been inspected during debugging.

Run each project independently with the installed SDK:

```powershell
node scripts/run_binding_bench.js --split all --sdk <ets-directory> --output <new-directory>
node scripts/evaluate_binding_bench.js <result-directory>
```

The default measures IFDS with supplementary recovery and pointer analysis
disabled. Use `--supplementary true` for the corresponding combined analysis.
`--engine-root <runtime-directory> --engine-revision <commit>` selects a saved
baseline containing `dist` and `config`. Every run retains the reports, observed
seeds, configuration and failures. Source rules and expected labels remain fixed.

The `selectContacts` pair is retained even though that API is absent from the
latest reviewed catalog. Its missing binding measures query coverage, separately
from the continuation implementation.

`check_binding_continuations.js` is a fast shared-scene diagnostic, not an isolated
project experiment. Use the CLI runner for event tests because a shared scene can
join emissions from different fixtures.

`audit_catalog_binding_coverage.js` checks binding availability at the existing
Top120 source-first annotations. Dynamic sensor events have multiple possible API
identities at a single call site. This audit measures retained identities, not
independently reviewed carrier correctness or confirmed leaks.
