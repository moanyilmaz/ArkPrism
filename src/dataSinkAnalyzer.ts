/**
 * ArkPrism - Data Sink Analyzer
 *
 * Analyzes where privacy data flows after being collected.
 * Classifies data sinks into: network, storage, ui_display, log, unknown.
 *
 * Configuration: Sink patterns are loaded from JSON (config/data_sinks.json)
 * instead of hardcoded strings, enabling easy extension without code changes.
 *
 * Key improvement: Uses ArkAnalyzer's structured APIs (getInvokeExpr, getMethodSignature)
 * instead of string matching to avoid false positives from variable names containing
 * similar keywords (e.g., 'requestInfo' being matched as 'request.downloadTask').
 *
 * Based on HarmonyOS NEXT developer documentation.
 */

import { Scene, ArkMethod, ArkReturnStmt } from './arkanalyzer';
import { AbstractInvokeExpr, ArkInstanceInvokeExpr, ArkStaticInvokeExpr } from './arkanalyzer/core/base/Expr';
import { ClassSignature, MethodSignature } from './arkanalyzer/core/model/ArkSignature';
import { PrivacyDataApiResult, CallChainResult, DataSinkInfo } from './prototypes';
import * as fs from 'fs';
import * as path from 'path';

// ---- JSON Configuration Loading ----

interface SinkPattern {
    namespace: string;
    methods: string[];
    api: string;
    kit?: string;
}

interface SinkCategory {
    description: string;
    patternMatch: string;
    patterns: SinkPattern[];
}

interface SinkConfig {
    sinkCategories: { [key: string]: SinkCategory };
    version: string;
    updated: string;
}

/** Loaded sink configuration */
let sinkConfig: SinkConfig | null = null;

/**
 * Load sink configuration from JSON file.
 * Uses cached config on subsequent calls.
 */
function loadSinkConfig(): SinkConfig {
    if (sinkConfig) return sinkConfig!;

    const configPath = path.resolve(__dirname, '..', 'config', 'data_sinks.json');
    try {
        if (fs.existsSync(configPath)) {
            const content = fs.readFileSync(configPath, 'utf8');
            sinkConfig = JSON.parse(content);
            console.log(`[SINK] Loaded sink config from: ${configPath} (v${sinkConfig!.version})`);
            return sinkConfig!;
        }
    } catch (e) {
        console.log(`[SINK][WARN] Failed to load sink config: ${e}`);
    }

    // Return empty config if file not found
    sinkConfig = { sinkCategories: {}, version: 'fallback', updated: '' };
    return sinkConfig!;
}

/**
 * Get all namespace-method pairs for a sink category.
 */
function getSinkPatterns(category: string): { ns: string; methods: string[]; api: string }[] {
    const config = loadSinkConfig();
    const cat = config.sinkCategories[category];
    if (!cat) return [];
    return cat.patterns.map(p => ({ ns: p.namespace, methods: p.methods, api: p.api }));
}

// ---- Structured Sink Matching using ArkAnalyzer APIs ----

/**
 * Extract namespace from method signature.
 * Handles both instance calls (base.namespace.method) and static calls.
 */
function extractNamespace(invokeExpr: AbstractInvokeExpr, stmt: any): string | null {
    try {
        if (invokeExpr instanceof ArkInstanceInvokeExpr) {
            // For instance calls: base.method()
            const base = invokeExpr.getBase();
            if (base) {
                const baseStr = base.toString();
                // The base could be a namespace like 'geoLocationManager', 'console', etc.
                // or an imported module alias
                return baseStr;
            }
        } else if (invokeExpr instanceof ArkStaticInvokeExpr) {
            // For static calls: <namespace.Class.method>()
            const sig = invokeExpr.getMethodSignature();
            if (sig) {
                const classSig = sig.getDeclaringClassSignature();
                const className = classSig.getClassName();
                // Static invoke format is typically 'namespace.Class.method'
                // Extract the namespace part (before the first dot)
                const dotIdx = className.indexOf('.');
                if (dotIdx > 0) {
                    return className.substring(0, dotIdx);
                }
                // If no dot, the className might be just the namespace
                return className;
            }
        }
    } catch { /* ignore */ }
    return null;
}

/**
 * Extract method name from invoke expression.
 */
function extractMethodName(invokeExpr: AbstractInvokeExpr): string | null {
    try {
        const sig = invokeExpr.getMethodSignature();
        if (sig) {
            return sig.getMethodSubSignature()?.getMethodName() || null;
        }
    } catch { /* ignore */ }
    return null;
}

/**
 * Map method patterns to their possible namespaces based on SDK documentation.
 * This is derived from HarmonyOS/OpenHarmony API reference:
 * - SystemPasteboard.setData comes from @kit.BasicServicesKit pasteboard module
 * - RdbStore operations come from @kit.ArkData rdb module
 * - KVStore operations come from @kit.DistributedServiceKit distributedKVStore module
 *
 * Format: { methodName: [possibleNamespace1, possibleNamespace2, ...] }
 * Note: Some methods exist in multiple namespaces (e.g., 'delete', 'get')
 */
const METHOD_NAMESPACE_PATTERNS: { [methodName: string]: string[] } = {
    // pasteboard module methods - verified via HarmonyOS SDK type definitions
    'setData': ['pasteboard'],
    'setPrimaryData': ['pasteboard'],
    'setClipboardData': ['pasteboard'],
    'getData': ['pasteboard'],
    'getPrimaryText': ['pasteboard'],
    'getUnifiedDataSync': ['pasteboard'],
    'createData': ['pasteboard'],
    'hasClipboardData': ['pasteboard'],

    // rdb module methods
    'insert': ['rdb', 'RdbStore', 'relationalStore'],
    'update': ['rdb', 'RdbStore', 'relationalStore'],
    'delete': ['rdb', 'RdbStore', 'relationalStore', 'photoAccessHelper'],
    'batchInsert': ['rdb', 'RdbStore', 'relationalStore'],
    'executeSql': ['rdb'],
    'query': ['rdb', 'RdbStore', 'relationalStore'],

    // distributedKVStore module methods
    'put': ['distributedKVStore', 'kvStore', 'distributedData'],
    'batchPut': ['distributedKVStore', 'kvStore'],
    'batchPutSync': ['distributedKVStore', 'kvStore'],
    'getAll': ['distributedKVStore', 'kvStore'],

    // fs module methods
    'write': ['fs'],
    'writeSync': ['fs'],
    'writeFile': ['fs', 'fileio'],
    'writeFileSync': ['fs', 'fileio'],
    'appendFile': ['fs', 'fileio'],
    'appendFileSync': ['fs', 'fileio'],

    // photoAccessHelper module methods
    'createAsset': ['photoAccessHelper'],
    'modifyAsset': ['photoAccessHelper'],

    // preferences module methods
    'putSync': ['preferences', 'Preferences', 'dataPreferences'],
    'flushSync': ['preferences', 'Preferences', 'dataPreferences'],
    'getSync': ['preferences', 'Preferences', 'dataPreferences'],
};

/**
 * Standalone write operations: APIs where the call itself IS a sink.
 * These operations write/persist data, regardless of whether privacy data flows to them.
 *
 * For example: createAsset() creates a media file (write operation),
 * even if no tracked privacy variable is passed to it.
 *
 * Based on HarmonyOS API documentation:
 * - photoAccessHelper.createAsset: Creates a media asset (photo/video) on device
 * - photoAccessHelper.modifyAsset: Modifies an existing media asset
 */
const STANDALONE_WRITE_OPERATIONS: { [methodName: string]: { sinkType: DataSinkInfo['sinkType']; api: string } } = {
    // photoAccessHelper write operations
    'createAsset': { sinkType: 'storage', api: 'photoAccessHelper.PhotoAccessHelper.createAsset' },
    'modifyAsset': { sinkType: 'storage', api: 'photoAccessHelper.PhotoAccessHelper.modifyAsset' },
};

// ---- Callback Parameter Tracking ----

/**
 * Trace data flow from callback parameters to sinks.
 *
 * For example, in:
 *   getData((err, pasteData) => {
 *       let text = pasteData.getPrimaryText();
 *       console.log(text);
 *   })
 *
 * This function traces 'pasteData' (parameter at index 1) to detect
 * the 'console.log' sink that receives the de-obfuscated text.
 *
 * @param callbackMethod - The callback's ArkMethod
 * @param parameterIndex - Index of the parameter to trace (0-based)
 * @param outerTrackedVars - Variables from the outer method to check against
 * @param filePath - Source file path for sink reporting
 * @returns Array of DataSinkInfo found in the callback body
 */
function traceCallbackParameterDataFlow(
    callbackMethod: ArkMethod,
    parameterIndex: number,
    outerTrackedVars: string[],
    filePath: string
): DataSinkInfo[] {
    let sinks: DataSinkInfo[] = [];

    try {
        // Get the parameter variable at the given index
        const paramInstances = callbackMethod.getParameterInstances();
        if (!paramInstances || parameterIndex >= paramInstances.length) {
            return sinks;
        }

        const paramLocal = paramInstances[parameterIndex];
        const paramName = paramLocal?.toString();
        if (!paramName) return sinks;

        // Scan the callback method for sinks using this parameter
        // Note: We don't pass scene here to avoid recursive callback-in-callback detection
        // (which would be extremely rare in practice)
        const callbackSinks = scanMethodForSinks(callbackMethod, [paramName]);

        for (const sink of callbackSinks) {
            // Update the file path to reflect the actual callback location
            let callbackFilePath = filePath;
            try {
                const declaringFile = callbackMethod.getDeclaringArkFile();
                if (declaringFile) {
                    callbackFilePath = declaringFile.getName();
                }
            } catch { /* ignore */ }

            sinks.push({
                ...sink,
                sinkFile: callbackFilePath,
                // Mark this sink as coming from a callback parameter
                dataVariable: `[callback:param${parameterIndex}] ${sink.dataVariable || paramName}`,
            });
        }
    } catch { /* ignore */ }

    return sinks;
}

/**
 * Extract namespace from a type signature string.
 * Handles formats like 'pasteboard.SystemPasteboard' -> 'pasteboard'
 */
function extractNamespaceFromType(typeStr: string | null): string | null {
    if (!typeStr) return null;
    // Type signature format: 'namespace.ClassName' or just 'ClassName'
    const dotIdx = typeStr.indexOf('.');
    if (dotIdx > 0) {
        return typeStr.substring(0, dotIdx);
    }
    return typeStr;
}

/**
 * Check if an invoke expression matches a sink pattern.
 * Uses ArkAnalyzer's structured APIs for precise matching:
 * - getInvokeExpr() to get the call expression
 * - getMethodSignature() to get namespace and method name
 * - type inference for instance variables when direct namespace match fails
 *
 * This avoids false positives like 'requestInfo' variable matching 'request.downloadTask'.
 * When the base variable name doesn't directly match a namespace (e.g., 'systemPasteboard'),
 * we use the method name to infer the expected namespace based on SDK documentation.
 */
function classifySinkInvoke(invokeExpr: AbstractInvokeExpr, stmt: any): {
    sinkType: DataSinkInfo['sinkType'];
    sinkApi: string;
} | null {
    const categories = ['network', 'storage', 'ui_display', 'log', 'intent', 'share'] as const;

    // Extract namespace and method name from the invoke expression
    let namespace = extractNamespace(invokeExpr, stmt);
    const methodName = extractMethodName(invokeExpr);

    if (!namespace || !methodName) {
        return null;
    }

    // Check if the method name indicates a known sink API method
    const inferredNamespace = METHOD_NAMESPACE_PATTERNS[methodName];

    for (const category of categories) {
        const patterns = getSinkPatterns(category);
        for (const { ns, methods, api } of patterns) {
            // Direct namespace match (e.g., 'console.error', 'geoLocationManager.on')
            if (namespace === ns) {
                if (methods.includes(methodName)) {
                    return { sinkType: category, sinkApi: `${api}.${methodName}` };
                }
            }
            // Method-based namespace inference for instance variables
            // e.g., 'systemPasteboard.setData' -> 'pasteboard.setData'
            // This handles cases where the variable name differs from the module namespace
            else if (inferredNamespace && inferredNamespace.includes(ns) && methods.includes(methodName)) {
                // Verify the method belongs to this namespace's type system
                // by checking if the method is commonly associated with this namespace
                return { sinkType: category, sinkApi: `${api}.${methodName}` };
            }
        }
    }

    return null;
}

/**
 * Legacy fallback: Check statement string for sink patterns.
 * Only used when getInvokeExpr() returns null (e.g., property access patterns).
 * Uses word boundary checks to avoid partial matches.
 */
function classifySinkStatementFallback(stmtStr: string): {
    sinkType: DataSinkInfo['sinkType'];
    sinkApi: string;
} | null {
    const categories = ['network', 'storage', 'ui_display', 'log', 'intent', 'share'] as const;

    for (const category of categories) {
        const patterns = getSinkPatterns(category);
        for (const { ns, methods, api } of patterns) {
            // Use word boundary regex pattern: namespace followed by .method(
            // This ensures 'requestInfo' (no dot) doesn't match 'request.'
            const nsPattern = new RegExp(`\\b${ns}\\.`);
            if (nsPattern.test(stmtStr)) {
                for (const method of methods) {
                    // Check for .method( with word boundary before the dot
                    const methodPattern = new RegExp(`\\.${method}\\(`);
                    if (methodPattern.test(stmtStr)) {
                        return { sinkType: category, sinkApi: `${api}.${method}` };
                    }
                }
            }
        }
    }

    return null;
}

// ---- Analysis functions ----

/**
 * Extract the assigned variable from a privacy API usage statement.
 * Uses ArkAnalyzer's structured Stmt APIs instead of string parsing.
 * getLeftOp() returns the Local variable being defined.
 */
function extractAssignedVariable(method: ArkMethod, apiResult: PrivacyDataApiResult): string[] {
    let vars: string[] = [];
    try {
        let body = method.getBody();
        if (!body) return vars;
        let stmts = body.getCfg().getStmts();
        let apiName = apiResult.method;

        for (let stmt of stmts) {
            // Use structured API: check if stmt is an assignment with an invoke on the RHS
            if (typeof (stmt as any).getLeftOp === 'function' && stmt.containsInvokeExpr()) {
                let invokeExpr = stmt.getInvokeExpr();
                if (invokeExpr) {
                    let calledMethodName = invokeExpr.getMethodSignature()?.getMethodSubSignature()?.getMethodName();
                    // Match by method name (API method name)
                    if (calledMethodName && calledMethodName === apiName) {
                        let lhs = (stmt as any).getLeftOp();
                        if (lhs) {
                            vars.push(lhs.toString());
                        }
                    }
                }
            }
            // Fallback: also check by string matching for property access patterns
            // (e.g., deviceInfo.productModel which may not be an invoke)
            if (vars.length === 0) {
                let s = stmt.toString();
                if (s.includes(apiName)) {
                    let eqIdx = s.indexOf(' = ');
                    if (eqIdx >= 0) {
                        let lhs = s.substring(0, eqIdx).trim();
                        if (lhs.length > 0 && !vars.includes(lhs)) {
                            vars.push(lhs);
                        }
                    }
                }
            }
        }
    } catch { /* ignore */ }
    return vars;
}

/**
 * Scan a method's body for data sink patterns.
 * Uses ArkAnalyzer's getInvokeExpr() API for precise matching.
 * Falls back to string matching only when structural APIs are unavailable.
 *
 * @param method - The method to scan
 * @param trackedVars - Variables that carry privacy data from source APIs
 * @param scene - ArkAnalyzer scene for callback method lookup
 */
function scanMethodForSinks(
    method: ArkMethod,
    trackedVars: string[],
    scene?: Scene
): DataSinkInfo[] {
    let sinks: DataSinkInfo[] = [];
    try {
        let body = method.getBody();
        if (!body) return sinks;
        let stmts = body.getCfg().getStmts();
        let filePath = 'unknown';
        try {
            let f = method.getDeclaringArkFile();
            if (f) filePath = f.getName();
        } catch { /* ignore */ }

        for (let stmt of stmts) {
            // Try structured API matching first (precise, avoids false positives)
            let classification: { sinkType: DataSinkInfo['sinkType']; sinkApi: string } | null = null;

            try {
                if (stmt.containsInvokeExpr()) {
                    const invokeExpr = stmt.getInvokeExpr();
                    if (invokeExpr) {
                        classification = classifySinkInvoke(invokeExpr, stmt);

                        // Check for standalone write operations (createAsset, modifyAsset, etc.)
                        // These are sinks even without tracked variable data flow
                        if (!classification) {
                            const methodName = extractMethodName(invokeExpr);
                            if (methodName && STANDALONE_WRITE_OPERATIONS[methodName]) {
                                const op = STANDALONE_WRITE_OPERATIONS[methodName];
                                classification = { sinkType: op.sinkType, sinkApi: op.api };
                            }
                        }
                    }
                }
            } catch { /* ignore */ }

            // Fallback to string matching only if structural matching failed
            if (!classification) {
                const s = stmt.toString();
                classification = classifySinkStatementFallback(s);

                // Also check for standalone write operations via string matching
                // This handles cases like "photoAccessHelper.createAsset(...)" directly in code
                if (!classification) {
                    for (const [methodName, op] of Object.entries(STANDALONE_WRITE_OPERATIONS)) {
                        if (s.includes(methodName + '(')) {
                            classification = { sinkType: op.sinkType, sinkApi: op.api };
                            break;
                        }
                    }
                }
            }

            if (classification) {
                // Method 1: Precise variable tracking via getUses()
                let usedVar: string | undefined;
                try {
                    let uses = stmt.getUses ? stmt.getUses() : [];
                    for (let u of uses) {
                        if (u && u.toString) {
                            let uStr = u.toString();
                            if (trackedVars.includes(uStr)) {
                                usedVar = uStr;
                                break;
                            }
                        }
                    }
                } catch { /* ignore */ }

                // Method 2: Fallback to string matching for field refs (this.xxx)
                if (!usedVar) {
                    let s = stmt.toString();
                    for (let v of trackedVars) {
                        if (s.includes(v)) {
                            usedVar = v;
                            break;
                        }
                    }
                }

                let lineNo = 0;
                try {
                    let pos = stmt.getOriginPositionInfo();
                    if (pos) lineNo = pos.getLineNo();
                } catch { /* ignore */ }

                sinks.push({
                    sinkType: classification.sinkType,
                    sinkApi: classification.sinkApi,
                    sinkMethod: method.getSignature().toString(),
                    sinkFile: filePath,
                    sinkLine: lineNo > 0 ? lineNo : undefined,
                    dataVariable: usedVar,
                });
            }

            // Callback parameter tracking: trace data flow through callback parameters
            // This handles patterns like: getData((err, pasteData) => { ... })
            if (scene && stmt.containsInvokeExpr()) {
                try {
                    const invokeExpr = stmt.getInvokeExpr();
                    if (invokeExpr) {
                        const args = invokeExpr.getArgs() || [];
                        for (let i = 0; i < args.length; i++) {
                            const arg = args[i];
                            if (!arg || typeof arg.getType !== 'function') continue;

                            const argType = arg.getType();
                            // Check if this argument has FunctionType (it's a callback function)
                            if (argType && argType.constructor && argType.constructor.name === 'FunctionType') {
                                try {
                                    const funcType = argType as any;
                                    const sig = funcType.getMethodSignature ? funcType.getMethodSignature() : null;
                                    if (sig) {
                                        const callbackMethod = scene.getMethod(sig.toString());
                                        if (callbackMethod) {
                                            // Trace data flow through callback parameter
                                            const callbackSinks = traceCallbackParameterDataFlow(
                                                callbackMethod,
                                                i,
                                                trackedVars,
                                                filePath
                                            );
                                            sinks.push(...callbackSinks);
                                        }
                                    }
                                } catch { /* ignore */ }
                            }
                        }
                    }
                } catch { /* ignore */ }
            }
        }

        // ArkReturnStmt tracking: detect if return value carries privacy data
        for (let stmt of stmts) {
            try {
                if (typeof (stmt as any).getOp === 'function' && stmt.constructor.name === 'ArkReturnStmt') {
                    let returnVal = (stmt as any).getOp();
                    if (returnVal) {
                        let retStr = returnVal.toString();
                        let matchedVar: string | undefined;
                        // Check if the returned value is one of the tracked variables
                        for (let v of trackedVars) {
                            if (retStr === v || retStr.includes(v)) {
                                matchedVar = v;
                                break;
                            }
                        }
                        // Also check getUses() for precise match
                        if (!matchedVar) {
                            let uses = stmt.getUses ? stmt.getUses() : [];
                            for (let u of uses) {
                                if (u && u.toString) {
                                    let uStr = u.toString();
                                    if (trackedVars.includes(uStr)) {
                                        matchedVar = uStr;
                                        break;
                                    }
                                }
                            }
                        }
                        if (matchedVar) {
                            let lineNo = 0;
                            try {
                                let pos = stmt.getOriginPositionInfo();
                                if (pos) lineNo = pos.getLineNo();
                            } catch { /* ignore */ }
                            sinks.push({
                                sinkType: 'data_return',
                                sinkApi: 'return',
                                sinkMethod: method.getSignature().toString(),
                                sinkFile: filePath,
                                sinkLine: lineNo > 0 ? lineNo : undefined,
                                dataVariable: matchedVar,
                            });
                        }
                    }
                }
            } catch { /* ignore */ }
        }
    } catch { /* ignore */ }
    return sinks;
}

/**
 * Get all methods in the same class as the given method.
 */
function getSameClassMethods(method: ArkMethod, scene: Scene): ArkMethod[] {
    try {
        let cls = method.getDeclaringArkClass();
        if (!cls) return [method];
        let methods: ArkMethod[] = [];
        for (let m of cls.getMethods()) {
            methods.push(m);
        }
        return methods;
    } catch { return [method]; }
}

/**
 * Analyze data sinks for a single API detection result.
 * Scans the declaring method and all sibling methods in the same class.
 */
function analyzeDataSinksForApi(
    apiResult: PrivacyDataApiResult,
    methodMap: Map<string, ArkMethod>,
    scene: Scene
): DataSinkInfo[] {
    let allSinks: DataSinkInfo[] = [];

    let declaringMethodSig = apiResult.declaringMethod;
    if (!declaringMethodSig) return allSinks;

    let declaringMethod = methodMap.get(declaringMethodSig);
    if (!declaringMethod) return allSinks;

    // Step 1: Extract assigned variables from the API call
    let trackedVars = extractAssignedVariable(declaringMethod, apiResult);

    // Also track field assignments (this.xxx) which propagate across methods
    let fieldVars = trackedVars.filter(v => v.startsWith('this.'));

    // Step 2: Scan the same class for sinks
    let classMethods = getSameClassMethods(declaringMethod, scene);
    for (let method of classMethods) {
        // For the declaring method, track all assigned vars
        // For sibling methods, only track field variables (this.xxx)
        let varsToTrack = (method === declaringMethod) ? trackedVars : fieldVars;
        if (varsToTrack.length === 0 && method !== declaringMethod) continue;

        let sinks = scanMethodForSinks(method, varsToTrack, scene);
        allSinks = allSinks.concat(sinks);
    }

    // Deduplicate by sinkApi + sinkMethod
    let seen = new Set<string>();
    let unique: DataSinkInfo[] = [];
    for (let sink of allSinks) {
        let key = `${sink.sinkApi}|${sink.sinkMethod}`;
        if (!seen.has(key)) {
            seen.add(key);
            unique.push(sink);
        }
    }

    return unique;
}

/**
 * Main entry point: Analyze data sinks for all call chain results.
 * Enriches each CallChainResult with dataSinks field.
 */
export function analyzeDataSinks(
    apiResults: PrivacyDataApiResult[],
    callChainResults: CallChainResult[],
    scene: Scene
): void {
    console.log(`[SINK] Analyzing data sinks for ${callChainResults.length} call chains...`);

    // Build method map
    let methodMap = new Map<string, ArkMethod>();
    for (const method of scene.getMethods()) {
        methodMap.set(method.getSignature().toString(), method);
    }

    let totalSinks = 0;
    let networkCount = 0;
    let storageCount = 0;
    let uiCount = 0;
    let logCount = 0;
    let intentCount = 0;
    let shareCount = 0;

    for (let chainResult of callChainResults) {
        let apiResult = apiResults[chainResult.apiUsageIndex];
        if (!apiResult) continue;

        let sinks = analyzeDataSinksForApi(apiResult, methodMap, scene);
        chainResult.dataSinks = sinks;

        totalSinks += sinks.length;
        for (let s of sinks) {
            if (s.sinkType === 'network') networkCount++;
            else if (s.sinkType === 'storage') storageCount++;
            else if (s.sinkType === 'ui_display') uiCount++;
            else if (s.sinkType === 'log') logCount++;
            else if (s.sinkType === 'intent') intentCount++;
            else if (s.sinkType === 'share') shareCount++;
        }
    }

    console.log(`[SINK] Data sink analysis complete. Found ${totalSinks} sinks:`);
    console.log(`  [SINK] - network: ${networkCount}, storage: ${storageCount}, ui_display: ${uiCount}, log: ${logCount}, intent: ${intentCount}, share: ${shareCount}`);
}