# ArkPrism

ArkPrism is a static-analysis tool for locating privacy-sensitive API usages and reconstructing information-flow evidence in HarmonyOS ArkTS applications. It operates on ArkAnalyzer IR and produces auditable JSON reports and DOT graphs that connect sensitive API locations, framework and UI entry points, control context, data sinks, and source-to-sink taint paths.

ArkPrism is designed for source projects containing `.ets` or `.ts` files. It requires a real OpenHarmony SDK for SDK signature resolution during pointer and taint analysis.

## Contents

- [Analysis pipeline](#analysis-pipeline)
- [Implementation](#implementation)
- [Repository layout](#repository-layout)
- [Requirements](#requirements)
- [Installation](#installation)
- [Running ArkPrism](#running-arkprism)
- [Command-line options](#command-line-options)
- [Output](#output)
- [Rule configuration](#rule-configuration)
- [Validation and troubleshooting](#validation-and-troubleshooting)
- [Known analysis boundaries](#known-analysis-boundaries)

## Analysis pipeline

```text
ArkTS project + privacy rules + OpenHarmony SDK
                         |
                         v
             ArkAnalyzer Scene and ArkIR
                         |
             +-----------+-----------+
             |                       |
             v                       v
       View-tree model       Sensitive API recognition
             |                       |
             +-----------+-----------+
                         v
           Lifecycle-aware call-graph recovery
                         |
                         v
       Entry-to-API chains and control evidence
                         |
             +-----------+-----------+
             |                       |
             v                       v
       Sink classification    HapFlow IFDS analysis
             |                + pointer analysis
             |                + callback/Promise recovery
             +-----------+-----------+
                         v
       Evidence assembly, collaboration analysis,
                 JSON report, and DOT graph
```

The pipeline is evidence preserving: each detected API usage retains its package, namespace, method, ArkIR statement, source file, declaring method, permission, and profiling category. Call-chain and taint results refer back to this evidence instead of reporting only aggregate counts.

## Implementation

### 1. ArkAnalyzer frontend

`src/arkprism.ts` builds an ArkAnalyzer `Scene` from the target project. The normal project loader is used first. If the project metadata is incomplete and produces no Ark files, ArkPrism discovers `.ets` and `.ts` files and rebuilds the scene from the source-file list.

The frontend:

1. parses project files and imports;
2. creates ArkIR statements, CFGs, classes, methods, and signatures;
3. performs ArkAnalyzer type inference;
4. excludes generated or dependency directories such as `build`, `cache`, `node_modules`, `oh_modules`, and `.preview`;
5. builds ArkUI view-tree evidence for components, callback bindings, and state-to-UI flows.

The OpenHarmony SDK is loaded again for taint-rule signature resolution. The SDK path must point to the SDK's `ets` directory, not merely to the SDK installation root.

### 2. Sensitive API recognition

`src/apiDetector.ts` reads `config/sensitive_apis.json` and binds rules to actual imports in each Ark file. Recognition is performed over ArkIR, not by searching for bare method-name strings.

ArkPrism handles four principal usage forms:

| Form | Example | Main evidence |
|---|---|---|
| Direct invocation | `pasteboard.getSystemPasteboard()` | imported package, namespace alias, invoke signature, and method |
| Assigned invocation | `const id = identifier.getOAID()` | direct-call evidence plus assignment IR |
| Manager/helper invocation | `calendarMgr.getCalendar()` | inferred receiver namespace or package-scoped method fallback |
| Field/property access | `deviceInfo.deviceType` | imported namespace and field reference |

Package aliases bridge equivalent `@ohos.*` and `@kit.*` APIs. Namespace-member aliases are recovered when ArkIR lowers compound APIs, for example assigning `request.agent` to a local and invoking `local.create(...)`.

For indirect calls, ArkPrism first uses the inferred receiver namespace. If ArkAnalyzer cannot infer a usable receiver type, the detector applies a package-scoped method match among rules associated with imports in the same file. Rule authors should therefore avoid unqualified generic methods such as `get`, `set`, `create`, `request`, `on`, or `start` unless the package and namespace make the owner unambiguous.

Each `privacyApiUsages` record contains the matched rule and its evidence location.

### 3. Lifecycle and callback modeling

`src/lifecycleModeler.ts` models HarmonyOS execution as three related layers:

1. **Ability lifecycle**: creation, window creation, foreground, background, and destruction;
2. **Component lifecycle**: appearance, build, page show/hide, and disappearance;
3. **UI callbacks**: user-interaction and registered callback methods.

The model discovers UIAbility, Ability, ExtensionAbility, FormExtensionAbility, BackupExtensionAbility, service classes, ArkUI components, and callback methods. It constructs legal intra-layer transitions and framework-driven cross-layer transitions, such as Ability foregrounding to component appearance.

`src/lifecycleDummyMain.ts` orders discovered entry methods by lifecycle phase and creates the synthetic entry used by the IFDS analysis. The default bounded model represents one lifecycle instance and prevents a synthetic lifecycle loop from dominating memory consumption. This bound can be disabled only for controlled ablation experiments through `ARKPRISM_DISABLE_LIFECYCLE_BOUNDS=1`.

### 4. Call-graph and call-chain recovery

`src/callGraphBuilder.ts` constructs the base call graph. `src/callChainTracer.ts` then builds an enhanced reverse call map from complementary edge sources:

- ArkAnalyzer call-graph edges;
- CHA resolution for virtual/interface calls;
- invoke edges recovered directly from ArkIR;
- uniquely resolvable unknown-signature calls;
- FunctionType and ClosureType callback arguments;
- whitelisted event, Promise, and callback APIs;
- class-field arrow-function callbacks;
- anonymous-method parent relationships;
- ArkUI builder-option callbacks;
- lifecycle transitions supplied by the state-machine model.

For each sensitive API usage, ArkPrism traverses callers toward a recognized application, component, initialization, or user-interaction entry. If no framework entry is recoverable, the declaring method is retained as a precise local entry; ArkPrism does not invent a caller.

The resulting chain records:

- entry method, entry type, file, and line;
- caller/callee links and call kinds;
- readable names for ArkIR anonymous methods;
- asynchronous usage evidence;
- source snippets for methods on the path;
- enclosing `if`, `switch`, loop, and `try/catch` structures.

Control evidence uses CFG dominance information to distinguish a condition that actually governs the API call from a condition that is merely nearby.

### 5. Sink analysis and semantic evidence

`src/dataSinkAnalyzer.ts` classifies operations that may expose or persist sensitive data. Rules in `config/data_sinks.json` cover:

- network transmission;
- persistent or distributed storage;
- log and console output;
- UI display;
- intents and inter-component transfer;
- sharing;
- returned data.

The analysis follows variables produced by sensitive APIs through the declaring method, related same-class methods, and callbacks. A sink record contains its category, API, enclosing method, file, line, and data variable when recoverable.

`src/callChainTracer.ts` also assembles semantic context: page/component name, the nearest meaningful application method, a simplified chain, and a concise purpose hint. These fields are evidence summaries; they do not replace the underlying call chain or source location.

### 6. Multi-source collaboration analysis

`src/multiSourceAnalyzer.ts` groups sensitive APIs by profiling category and identifies methods that combine multiple privacy dimensions. It computes a common ancestor in the recovered call graph and constructs an evidence subgraph:

```text
entry -> common ancestor -> sensitive API branches -> sinks
```

The output includes involved categories, API branches, entry method, lowest common ancestor, sink evidence, and a risk level derived from the number of combined categories.

### 7. HapFlow IFDS taint analysis

`src/hapflowRunner.ts` integrates the HapFlow IFDS solver with ArkPrism.

The taint stage:

1. loads SDK declarations from the explicitly supplied OpenHarmony SDK;
2. builds the lifecycle-aware synthetic entry;
3. runs context-sensitive pointer analysis for aliases and dynamic callees;
4. resolves configured source and sink signatures;
5. solves the interprocedural distributive data-flow problem;
6. supplements IR propagation for ArkTS callbacks, closures, Promise chains, and `await`;
7. converts path facts into source-to-sink evidence.

`config/hapflow_sources.json` supports return-value sources and callback-parameter sources. `config/hapflow_sinks.json` defines sink signatures. The IFDS implementation propagates facts through normal, call, return, call-to-return, exceptional, field, and receiver-refined edges.

By default, all resolved sources are processed in one solver run. `--ifds-batch-size` is an explicit memory fallback and should remain unset in accuracy-oriented runs because a single solver preserves the complete shared context.

The supplementary callback analysis is enabled by default. It handles patterns that are frequently incomplete in ArkIR, including:

- source values delivered through callbacks;
- Promise `.then(...)` and chained callbacks;
- `await` assignments;
- closure and lexical-environment captures;
- Promise executor `resolve(...)` propagation;
- callback fields and manager/helper aliases.

### 8. Additional project evidence

ArkPrism also reports:

- permissions declared in `module.json5`;
- CFG unreachable-block statistics;
- recursive and loop-pattern statistics;
- ArkUI component, callback, and state-flow evidence;
- project-level totals for files, methods, APIs, chains, collaborations, and taint flows.

## Repository layout

| Path | Purpose |
|---|---|
| `src/arkprism.ts` | CLI and end-to-end pipeline |
| `src/apiDetector.ts` | import-aware sensitive API recognition |
| `src/callGraphBuilder.ts` | base call-graph construction |
| `src/callChainTracer.ts` | enhanced reverse graph, call chains, control and semantic evidence |
| `src/lifecycleModeler.ts` | HarmonyOS lifecycle state machine |
| `src/lifecycleDummyMain.ts` | lifecycle-aware IFDS entry construction |
| `src/dataSinkAnalyzer.ts` | sink recognition and local/callback data tracking |
| `src/multiSourceAnalyzer.ts` | cross-category collaboration subgraphs |
| `src/hapflowRunner.ts` | SDK loading, pointer analysis, IFDS orchestration, result conversion |
| `src/hapflow/` | IFDS problem, solver, facts, rules, and callback/Promise propagation |
| `src/arkanalyzer/` | bundled ArkAnalyzer frontend and graph infrastructure |
| `src/dotExporter.ts` | DOT evidence-graph generation |
| `config/` | sensitive API, source, sink, package, and permission rules |
| `scripts/run_argus_batch_isolated.js` | process-isolated, resumable large-corpus runner |

## Requirements

- 64-bit Windows, Linux, or macOS;
- Node.js 20.x recommended;
- npm;
- an OpenHarmony SDK containing ArkTS declaration files;
- sufficient memory for the analyzed project;
- Graphviz, optional, for rendering DOT files.

The SDK argument must identify the `ets` directory. Example on Windows:

```powershell
$sdk = "E:\OpenHarmony_SDK\20\ets"
Test-Path $sdk
Get-ChildItem $sdk -Recurse -Filter *.d.ts | Select-Object -First 1
```

Both commands must return usable results. Do not substitute project-local stubs for the SDK in a formal analysis.

## Installation

```powershell
git clone https://github.com/moanyilmaz/ArkPrism.git
cd ArkPrism
npm install
npm run build
node dist/arkprism.js --help
```

For development-time execution:

```powershell
npx ts-node src/arkprism.ts --help
```

Compiled execution is recommended for repeatable experiments.

## Running ArkPrism

### Single project

```powershell
$env:OPENHARMONY_SDK_PATH = "E:\OpenHarmony_SDK\20\ets"
$env:NODE_OPTIONS = "--max-old-space-size=8192"

node dist/arkprism.js `
  "E:\Projects\MyHarmonyApp" `
  --output-dir "E:\ArkPrismResults\single" `
  --sdkPath "$env:OPENHARMONY_SDK_PATH"
```

Default output:

```text
E:\ArkPrismResults\single\
└── MyHarmonyApp\
    ├── MyHarmonyApp-arkprism-report.json
    └── MyHarmonyApp-privacy-graph.dot
```

### Accuracy-oriented single-project run

The following configuration raises resource ceilings while leaving IFDS unbatched:

```powershell
$env:NODE_OPTIONS = "--max-old-space-size=8192"

node dist/arkprism.js `
  "E:\Projects\MyHarmonyApp" `
  --output-dir "E:\ArkPrismResults\full" `
  --sdkPath "E:\OpenHarmony_SDK\20\ets" `
  --ifds-max-edges 30000000 `
  --ifds-max-worklist 8000000 `
  --ifds-timeout-ms 1800000 `
  --callback-analysis true `
  --callback-max-methods 200000 `
  --callback-max-sources 20000 `
  --callback-max-states 50000 `
  --callback-max-path-len 160
```

`--ifds-batch-size` is intentionally omitted.

### Built-in sequential batch mode

The dataset directory must contain one project per immediate subdirectory:

```text
dataset\
├── ProjectA\
├── ProjectB\
└── ProjectC\
```

Run:

```powershell
node dist/arkprism.js `
  --batch "E:\Datasets\HarmonyApps" `
  --output-dir "E:\ArkPrismResults\batch" `
  --sdkPath "E:\OpenHarmony_SDK\20\ets"
```

The runner writes one project directory plus `batch_summary.json`.

### Process-isolated large-corpus mode

For a large corpus, use the isolated runner. Each project runs in a separate Node.js process, preventing heap state from accumulating across projects.

```powershell
node scripts\run_argus_batch_isolated.js `
  --dataset "E:\Datasets\HarmonyApps" `
  --output-dir "E:\ArkPrismResults\isolated" `
  --sdkPath "E:\OpenHarmony_SDK\20\ets" `
  --log-dir "E:\ArkPrismResults\isolated\logs" `
  --timeout-ms 3600000 `
  --node-options "--max-old-space-size=8192" `
  --concurrency 2 `
  -- `
  --ifds-max-edges 30000000 `
  --ifds-max-worklist 8000000 `
  --ifds-timeout-ms 1800000 `
  --callback-analysis true `
  --callback-max-methods 200000 `
  --callback-max-sources 20000 `
  --callback-max-states 50000 `
  --callback-max-path-len 160
```

Arguments before `--` configure the isolated runner. Arguments after `--` are passed unchanged to ArkPrism.

Resume an interrupted run:

```powershell
node scripts\run_argus_batch_isolated.js `
  --dataset "E:\Datasets\HarmonyApps" `
  --output-dir "E:\ArkPrismResults\isolated" `
  --sdkPath "E:\OpenHarmony_SDK\20\ets" `
  --log-dir "E:\ArkPrismResults\isolated\logs" `
  --concurrency 2 `
  --resume `
  -- `
  --ifds-max-edges 30000000 `
  --ifds-max-worklist 8000000 `
  --ifds-timeout-ms 1800000
```

Use the same analysis arguments when resuming.

### Detector-only and ablation modes

```powershell
# API recognition, call chains, sinks, and project evidence; no IFDS taint paths
node dist/arkprism.js "E:\Projects\MyHarmonyApp" `
  --sdkPath "E:\OpenHarmony_SDK\20\ets" `
  --no-taint

# Disable pointer analysis; intended for ablation/debugging, not final accuracy claims
node dist/arkprism.js "E:\Projects\MyHarmonyApp" `
  --sdkPath "E:\OpenHarmony_SDK\20\ets" `
  --no-pta

# Skip DOT generation
node dist/arkprism.js "E:\Projects\MyHarmonyApp" `
  --sdkPath "E:\OpenHarmony_SDK\20\ets" `
  --no-dot
```

`--no-taint` and `--no-pta` reduce analysis coverage or precision and should not be used as silent fallbacks in a delivery run.

## Command-line options

| Option | Meaning | Default |
|---|---|---:|
| `<project_dir>` | analyze one ArkTS project | required in single mode |
| `--batch <dataset_dir>` | analyze immediate child directories sequentially | off |
| `--config <file>` | legacy JSON configuration mode | off |
| `--output-dir <dir>` | output root | `./out` |
| `--sdkPath <dir>` | OpenHarmony SDK `ets` directory | environment/default path |
| `--no-dot` | do not create DOT graphs | off |
| `--no-taint` | skip HapFlow taint analysis | off |
| `--no-pta` | skip pointer analysis | off |
| `--ifds-batch-size <n>` | sources per solver batch | all sources together |
| `--ifds-max-edges <n>` | maximum processed IFDS edges | `10000000` |
| `--ifds-max-worklist <n>` | maximum IFDS worklist size | `2000000` |
| `--ifds-timeout-ms <n>` | IFDS solver time limit | `900000` |
| `--callback-analysis <bool>` | enable supplementary callback analysis | `true` |
| `--callback-max-methods <n>` | maximum scanned callback methods | `100000` |
| `--callback-max-sources <n>` | maximum callback sources | `5000` |
| `--callback-max-states <n>` | maximum states per callback source | `10000` |
| `--callback-max-path-len <n>` | maximum callback path length | `100` |

Use `node dist/arkprism.js --help` as the authoritative option list for the checked-out revision.

## Output

### JSON report

`{project}-arkprism-report.json` contains:

| Field | Description |
|---|---|
| `projectName`, `projectDirectory`, `analysisTimestamp` | analysis identity and provenance |
| `privacyApiUsages` | matched package/namespace/method, arguments, IR, file, declaring method, permission, and category |
| `callChains` | entry point, call links, control structures, source snippets, sinks, async flag, and semantic context |
| `multiSourceCollaborations` | common-ancestor subgraphs combining multiple privacy categories |
| `permissionUsages` | permissions declared by application modules |
| `taintFlows` | source, sink, tainted value, files, lines, and complete propagation path |
| `statistics` | files, methods, APIs, chains, collaborations, and taint-flow totals |
| `dataFlowStats` | unreachable-block and dead-variable statistics |
| `recursivePatternStats` | loop and recursion statistics |

Indexes in `callChains[*].apiUsageIndex` refer to `privacyApiUsages`.

### DOT graph

`{project}-privacy-graph.dot` visualizes the evidence graph. Render it with Graphviz:

```powershell
dot -Tsvg `
  "MyHarmonyApp-privacy-graph.dot" `
  -o "MyHarmonyApp-privacy-graph.svg"
```

DOT is emitted only when at least one sensitive API is detected.

## Rule configuration

### Sensitive APIs

`config/sensitive_apis.json` is the authoritative recognition rule set:

```json
[
  {
    "systemPackage": "@kit.BasicServicesKit",
    "privacyApis": [
      {
        "namespace": "deviceInfo",
        "method": "deviceType",
        "permission": null,
        "profilingCategory": "device_identity.hardware",
        "directCall": null
      }
    ]
  }
]
```

`directCall` means:

- `true`: namespace/direct invocation;
- `false`: manager, helper, or receiver invocation;
- `null`: field/property-style usage.

Use a qualified package, namespace, and method. Do not add a generic method name without owner evidence.

### Sink rules

`config/data_sinks.json` defines evidence-oriented sink categories used by call-chain analysis. Each pattern specifies a namespace, method set, API label, package/kit, and severity.

### IFDS sources and sinks

- `config/hapflow_sources.json`: SDK source signatures, source type, tainted parameter index, sensitivity, and reason;
- `config/hapflow_sinks.json`: sink signatures and reasons.

Types containing `${OPENHARMONY_SDK_PATH}` are expanded with the SDK path supplied to the current run. After changing any rule file, rebuild if required by the workflow and rerun the relevant regression projects before a corpus experiment.

## Validation and troubleshooting

### Recommended preflight

```powershell
npm run build
node dist/arkprism.js --help

node dist/arkprism.js `
  "E:\Projects\SmallKnownProject" `
  --output-dir "E:\ArkPrismResults\preflight" `
  --sdkPath "E:\OpenHarmony_SDK\20\ets"
```

Verify:

1. the process exits successfully;
2. the JSON report parses;
3. `privacyApiUsages.length` agrees with the API count;
4. every `apiUsageIndex` is valid;
5. source and sink files are not `unknown` when project provenance exists;
6. logs contain no budget-exceeded, timeout, SDK-loading, pointer-analysis, or solver failure.

### SDK loading failures

- Pass the full `ets` path explicitly with `--sdkPath`.
- Confirm that the directory exists and contains SDK `.d.ts` files.
- Do not rely on a different SDK version through a fallback path.
- Quote Windows paths containing spaces.

### Out-of-memory conditions

Use project-level process isolation first:

1. run the compiled entry;
2. set `NODE_OPTIONS=--max-old-space-size=8192` or a value appropriate for the machine;
3. keep concurrency conservative;
4. increase per-project timeout for large projects;
5. resume completed projects with the isolated runner.

Do not disable pointer or taint analysis merely to obtain a success exit code. Explicit IFDS batching is a last-resort memory control and changes the analysis execution model.

### Budget or timeout messages

A report produced after `BUDGET_EXCEEDED`, solver timeout, or process timeout is not equivalent to a complete run. Increase `--ifds-max-edges`, `--ifds-max-worklist`, `--ifds-timeout-ms`, or the isolated runner's `--timeout-ms`, then rerun the affected project.

### No project files found

Confirm that the target contains `.ets` or `.ts` source files and is not only a build artifact. ArkPrism retries source-file discovery when standard project loading yields no Ark files, but malformed or encrypted projects still require repair or explicit exclusion with documented criteria.

## Known analysis boundaries

- Static analysis over-approximates some dynamic dispatch and framework behavior.
- Reflection, native code, dynamically loaded modules, generated code unavailable in the source tree, and encrypted artifacts may be unresolved.
- ArkIR type or callback information can be incomplete; supplementary recovery improves coverage but does not make runtime behavior observable.
- Source and sink coverage is bounded by the configured rule sets and the SDK version used for signature resolution.
- A detected API usage is evidence of an executable ArkIR access, not proof that the code executes in every runtime state.
- A reported taint path is a static may-flow unless independently confirmed at runtime.

For research or delivery results, retain the analyzed source revision, ArkPrism revision, rule-file hashes, SDK path/version, command line, per-project logs, JSON reports, DOT files, failures, exclusions, and resource limits.

## License

This repository is distributed under the license declared in the project metadata. Bundled third-party components retain their respective notices and licenses.
