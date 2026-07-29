/**
 * ArkPrism - Type Definitions
 * ArkTS Privacy-sensitive API Recognition and Information-flow Subgraph Mapping
 */

import { ArkFile } from "./arkanalyzer";

// ==================== Layer 2: API Detection Types ====================

/** Import basic info extracted from ArkFile */
export interface ImportBasicInfo {
    originName: string;             // original namespace name
    importClauseName: string;       // alias or clause name used in code
    importFrom: string | undefined; // system package name, e.g. "@kit.BasicServicesKit"
    declaringArkFile: ArkFile;
}

/** A single privacy API rule definition */
export interface PrivacyDataAPI {
    directCall: boolean | null;     // true=direct, false=indirect, null=constant
    namespace: string;
    method: string;
    permission?: string;            // required permission, if any
    profilingCategory?: string;     // profiling dimension for multi-source collaboration
    receiverFactories?: string[];   // factory methods that produce the API receiver
}

/** A system package containing privacy APIs */
export interface PrivacyPackageInfo {
    systemPackage: string;
    privacyApis: PrivacyDataAPI[];
}

/** A check unit bound to a specific import in a file */
export interface ImportEntryCheckUnit {
    systemPackage: string;
    importSystemNamespace: string;  // original namespace name
    importClauseName: string;       // actual name used in code (may be aliased)
    relatedApis: PrivacyDataAPI[];
}

/** Result of a single privacy API detection */
export interface PrivacyDataApiResult {
    category: "direct invoke stmt" | "direct invoke stmt after assignment" | "indirect invoke" | "privacy constants" | "callback invoke";
    apiPackage: string;
    namespace: string;
    method: string;
    args: string[];
    code: string;                   // ArkAnalyzer IR representation
    file: string;
    declaringMethod?: string;       // method signature where this API is called
    line?: number;                  // source line number
    column?: number;                // source column number
    locationEvidence?: "arkir" | "source_ast";
    originalCode?: string;          // original ArkTS source code
    permission?: string;
    profilingCategory?: string;
    callbackHost?: string;          // for callback invoke: the host method name
    matchEvidence?: "namespace" | "receiver_origin" | "receiver_type" | "target_signature";
}

// ==================== Layer 3-4: Call Graph & Chain Types ====================

/** A single link in a call chain */
export interface CallChainLink {
    caller: string;
    callee: string;
    callType: "direct" | "instance_invoke" | "static_invoke" | "lifecycle_implicit" | "callback" | "unknown";
    resolvedCallerName?: string;   // Human-readable name for IR anonymous methods (e.g., %AM0$build → "build_callback_0")
    resolvedCalleeName?: string;   // Human-readable name for IR anonymous methods
}

/** Control structure encountered on the path */
export interface ControlStructureInfo {
    type: "if" | "switch" | "loop" | "try_catch";
    condition?: string;                // The condition expression (for if/switch)
    file: string;
    line: number;
    /** Whether the API call is INSIDE this control structure's branch (not just nearby) */
    containsApiCall?: boolean;
    /** Which branch side the API call is on: "true_branch", "false_branch", "catch_branch", or "unknown" */
    branchSide?: string;
    /** Whether this looks like a guard/permission check condition */
    isGuardCondition?: boolean;
    /** For try-catch: whether the API call is in the try block or catch block */
    hasCatchFallback?: boolean;
    /** Whether this control structure dominates the API call (precise dominance tree analysis) */
    isDominatingApiCall?: boolean;
}

/** Source code snippet of a method */
export interface SourceSnippetInfo {
    method: string;
    file: string;
    startLine: number;
    endLine: number;
    code: string;                   // ArkAnalyzer IR representation
    originalCode?: string;          // original .ets source code (human-readable)
}

/** Semantic context extracted for downstream LLM purpose analysis */
export interface SemanticContext {
    /** Page/component name derived from file path, e.g., "Account", "batteryInfo", "location" */
    pageName: string;
    /** The component/struct class name, e.g., "AccountInfo", "Index", "page" */
    componentClass: string;
    /** Most meaningful user-defined function nearest to the API call (excluding lifecycle/anonymous methods) */
    semanticAnchor: string | null;
    /** Simplified human-readable call path, e.g., "build() → getAccountInfo() → osAccount.getOsAccountLocalId" */
    simplifiedChain: string;
    /** Structured description summarizing data flow for LLM, e.g., "batteryInfo.ets page collects battery SOC via getBatteryInfo(), data logged" */
    purposeHint: string;
}

/** A complete call chain from entry method to sensitive API */
export interface CallChainResult {
    apiUsageIndex: number;          // index into privacyApiUsages array
    entryMethod: {
        name: string;
        type: "user_interaction" | "component_lifecycle" | "app_lifecycle" | "initialization" | "unknown";
        file: string;
        line: number;
    };
    chain: CallChainLink[];
    controlStructures: ControlStructureInfo[];
    sourceSnippets: SourceSnippetInfo[];
    dataSinks?: DataSinkInfo[];
    semanticContext?: SemanticContext;
    /** Whether the API call involves async/await (detected via ArkAwaitExpr) */
    isAsync?: boolean;
}

/** Data sink classification for privacy data flow */
export interface DataSinkInfo {
    sinkType: "network" | "storage" | "ui_display" | "log" | "intent" | "share" | "data_return" | "unknown";
    sinkApi: string;                // e.g. "http.HttpRequest.request"
    sinkMethod: string;             // method signature where the sink occurs
    sinkFile: string;
    sinkLine?: number;
    dataVariable?: string;          // variable name carrying the data
}

// ==================== Layer 5: Multi-Source Collaboration Types ====================

/** A single source branch in the multi-source subgraph */
export interface MultiSourceBranch {
    api: string;                        // e.g. "contact.selectContacts"
    category: string;                   // e.g. "user_data.contacts"
    declaringMethod: string;            // Full method signature
    /** Path from LCA down to the source API's declaring method */
    lcaToSource: CallChainLink[];
    /** Data sinks found for this source */
    sinks: DataSinkInfo[];
}

/** Complete multi-source subgraph: entry → LCA → sources → sinks */
export interface MultiSourceSubgraph {
    /** Path from the entry method down to the LCA */
    entryToLca: CallChainLink[];
    /** Entry method info */
    entry: { name: string; type: string; file: string };
    /** LCA method signature */
    lcaMethodSig: string;
    /** Each source branch: LCA → source → sinks */
    branches: MultiSourceBranch[];
}

/** A detected multi-source collaborative profiling behavior */
export interface MultiSourceCollaboration {
    lcaMethod: string;              // Lowest Common Ancestor method (display name)
    lcaMethodSig: string;           // Full method signature for the LCA
    entryMethod: string;
    categories: string[];           // unique profiling categories involved
    apis: Array<{
        api: string;
        category: string;
    }>;
    riskLevel: "low" | "medium" | "high";
    reason: string;
    /** Complete subgraph: entry → LCA → sources → sinks */
    subgraph?: MultiSourceSubgraph;
}

// ==================== Layer 5.5: HapFlow Taint Analysis Types ====================

/** A single step in a taint propagation path */
export interface TaintPathStep {
    statement: string;          // IR statement string
    file: string;               // Source file / position info
    line: number;               // Line number
    method: string;             // Enclosing method name
}

/** A detected taint flow from source to sink */
export interface TaintFlowResult {
    provenance: "ifds" | "async_supplement" | "both";
    analysisDerivations?: Array<"promise_then">;
    sourceKind: "privacy_data" | "framework_input";
    sourceIdentity: {
        module: string;
        namespace: string;
        className: string;
        apiName: string;
        sourceType: string;
        sourceIndex: number;
        callbackIndex: number;
        methodSignature: string;
        ruleOrigin: string;
    };
    sourceApi: string;          // Source statement or API signature
    sourceFile: string;         // Source file / position
    sourceLine: number;         // Source line number
    sinkApi: string;            // Sink statement or API signature
    sinkFile: string;           // Sink file / position
    sinkLine: number;           // Sink line number
    taintedValue: string;       // The tainted value being tracked
    path: TaintPathStep[];      // Complete propagation path from source to sink
}

/** A conservative join between detector evidence and an independent taint flow */
export interface TaintFlowLink {
    apiUsageIndex: number;
    taintFlowIndex: number;
    evidence: "exact_statement" | "source_location";
}

export interface TaintAnalysisMetadata {
    status: "SUCCESS" | "PARTIAL_SUCCESS";
    pointerAnalysis: {
        requested: boolean;
        status: "SUCCESS" | "SKIPPED";
        rejectedContainerFieldEdges: number;
    };
    ifds: {
        sources: number;
        sinks: number;
        rawFlows: number;
        edgesProcessed: number;
        malformedCfgEdges: number;
        budgetExceeded: boolean;
        batching: boolean;
        batches: number;
    };
    callback: {
        enabled: boolean;
        rawFlows: number;
    };
    flowsBeforeDeduplication: number;
    uniqueFlows: number;
    duplicatesRemoved: number;
}

// ==================== Layer 6: Output Types ====================

/** Permission declaration extracted from module.json5 */
export interface PermissionResult {
    moduleName: string;
    permission: string;
    reason: string[] | null;
}

/** Data flow analysis statistics */
export interface DataFlowStats {
    totalMethods: number;
    methodsWithUnreachableBlocks: number;
    totalUnreachableBlocks: number;
    totalDeadVariables: number;
}

/** Recursive/loop pattern detection statistics */
export interface RecursivePatternStats {
    totalMethods: number;
    methodsWithLoops: number;
    loopBreakdown: { [key: string]: number };
}

/** Top-level ArkPrism analysis output */
export interface ArkPrismOutput {
    projectName: string;
    projectDirectory: string;
    analysisTimestamp: string;
    privacyApiUsages: PrivacyDataApiResult[];
    callChains: CallChainResult[];
    multiSourceCollaborations: MultiSourceCollaboration[];
    permissionUsages: PermissionResult[];
    taintFlows?: TaintFlowResult[];
    taintFlowLinks?: TaintFlowLink[];
    taintAnalysis?: TaintAnalysisMetadata;
    statistics: {
        totalFilesAnalyzed: number;
        totalMethodsAnalyzed: number;
        totalApisDetected: number;
        totalCallChainsBuilt: number;
        totalCollaborationsDetected: number;
        totalTaintFlows?: number;
    };
    dataFlowStats?: DataFlowStats;
    recursivePatternStats?: RecursivePatternStats;
}

/** Helper type for string.json file objects */
export interface StringJsonFileObject {
    name: string;
    value: string;
}
