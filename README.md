# ArkPrism

> **ArkTS Privacy-sensitive API Recognition and Information-flow Subgraph Mapping**

A static analysis tool for HarmonyOS app privacy compliance, built on [ArkAnalyzer](https://gitee.com/ArkAnalyzer/ArkAnalyzer). ArkPrism extracts privacy-sensitive control flow subgraphs — tracing data from entry methods through sensitive API calls to data sinks — and detects multi-source collaborative profiling behaviors.

## Features

- **Privacy API Detection**: Configurable rule-based detection covering 20+ privacy categories (device info, location, network, sensors, etc.)
- **Call Graph Construction**: RTA/CHA call graphs enhanced with lifecycle implicit edges and callback resolution
- **Call Chain Tracing**: Backward BFS from sensitive APIs to entry methods, extracting complete invocation paths
- **Control Flow Analysis**: Conditional branches (if/switch), loops, try-catch, with dominance tree precision
- **Data Sink Analysis**: Tracks where privacy data flows (network, storage, logs, UI display, return values)
- **Multi-Source Collaboration Detection**: Identifies combinations of non-permission APIs used for user profiling (e.g., device fingerprinting), constructing LCA-rooted subgraphs
- **Semantic Context**: Extracts page names, component classes, semantic anchors, and purpose hints for downstream LLM analysis
- **Visualization**: JSON reports + Graphviz DOT call graphs

## Quick Start

### Prerequisites

- Node.js ≥ 16
- npm ≥ 8

### Installation

```bash
git clone https://github.com/moanyilmaz/ArkPrism.git
cd ArkPrism
npm install
```

### Usage

```bash
# Analyze a single project
npx ts-node src/arkprism.ts <project-directory>

# Batch analyze all projects in a directory
npx ts-node src/arkprism.ts --batch <dataset-directory>

# Use a config file
npx ts-node src/arkprism.ts --config <config.json>
```

### Output

Results are written to `out/<project-name>/`:

| File | Description |
|------|-------------|
| `*-arkprism-report.json` | Full analysis report (API detections, call chains, multi-source collaborations, permissions) |
| `*-privacy-graph.dot` | Graphviz DOT visualization of privacy call graphs |

## Analysis Pipeline

![ArkPrism Analysis Pipeline](./img/pipeline.pdf)

## Project Structure

```
ArkPrism/
├── src/
│   ├── arkprism.ts              # CLI entry point
│   ├── apiDetector.ts           # Layer 2: Privacy API detection
│   ├── callGraphBuilder.ts      # Layer 3: Call graph construction
│   ├── callChainTracer.ts       # Layer 4: Call chain tracing
│   ├── dataSinkAnalyzer.ts      # Layer 5a: Data sink analysis
│   ├── multiSourceAnalyzer.ts   # Layer 5b: Multi-source detection
│   ├── permissionAnalyzer.ts    # Permission declaration analysis
│   ├── dotExporter.ts           # DOT visualization exporter
│   ├── prototypes.ts            # Type definitions
│   ├── utils.ts                 # Utility functions
│   └── arkanalyzer/             # ArkAnalyzer library (bundled)
├── config/
│   ├── privacy_apis.json        # Privacy API rule definitions
│   └── system_packages14.json   # HarmonyOS system package list
├── package.json
├── tsconfig.json
└── docs/
    └── implementation_details.md
```

## Configuration

### Privacy API Rules (`config/privacy_apis.json`)

```json
{
  "packageName": "@ohos.deviceInfo",
  "methodName": "brand",
  "profilingCategory": "device_identity.hardware",
  "sensitivityLevel": "low"
}
```

### CLI Options

| Option | Description |
|--------|-------------|
| `--dot` / `--no-dot` | Enable/disable DOT visualization (default: enabled) |
| `--batch <dir>` | Batch analyze all projects in a directory |
| `--config <file>` | Use a JSON config file |

## Tech Stack

- **ArkAnalyzer** — HarmonyOS static analysis framework (call graph, CFG, Def-Use chains, dominance tree)
- **TypeScript** — Type-safe analysis code
- **Node.js** — Runtime environment

## License

MIT
