/**
 * ArkPrism - Data Sink Analyzer
 *
 * Analyzes where privacy data flows after being collected.
 * Classifies data sinks into: network, storage, ui_display, log, unknown.
 *
 * Configuration: Sink patterns are loaded from JSON (config/data_sinks.json)
 * instead of hardcoded strings, enabling easy extension without code changes.
 *
 * Based on HarmonyOS NEXT developer documentation.
 */

import { Scene, ArkMethod, ArkReturnStmt } from './arkanalyzer';
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

// ---- Analysis functions ----

/**
 * Check if an IR statement string matches a sink pattern.
 * Uses JSON config for extensible sink definitions.
 * Returns the sink classification or null.
 */
function classifySinkStatement(stmtStr: string): {
    sinkType: DataSinkInfo['sinkType'];
    sinkApi: string;
} | null {
    const categories = ['network', 'storage', 'ui_display', 'log'] as const;

    for (const category of categories) {
        const patterns = getSinkPatterns(category);
        for (const { ns, methods, api } of patterns) {
            // Check if namespace appears in statement
            if (stmtStr.includes(ns)) {
                for (const method of methods) {
                    if (stmtStr.includes(`.${method}(`)) {
                        return { sinkType: category, sinkApi: `${api}.${method}` };
                    }
                }
            }
        }
    }

    return null;
}

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
 * Enhanced: uses Stmt.getUses() to precisely track which statements
 * use the tracked variables, rather than pure string matching.
 */
function scanMethodForSinks(
    method: ArkMethod,
    trackedVars: string[]
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
            let s = stmt.toString();
            let classification = classifySinkStatement(s);
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

        let sinks = scanMethodForSinks(method, varsToTrack);
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
        }
    }

    console.log(`[SINK] Data sink analysis complete. Found ${totalSinks} sinks:`);
    console.log(`  [SINK] - network: ${networkCount}, storage: ${storageCount}, ui_display: ${uiCount}, log: ${logCount}`);
}
