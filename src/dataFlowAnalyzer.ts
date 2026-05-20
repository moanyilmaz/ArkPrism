/**
 * Data Flow Analyzer using ArkAnalyzer's built-in Cfg capabilities.
 *
 * Leverages:
 * 1. Cfg.getDefUseChains() - Def-Use chains built by the framework
 * 2. Cfg.getUnreachableBlocks() - Detected unreachable code blocks
 * 3. TypeInference - Type-based data flow resolution
 * 4. VisibleValue - Scoped variable visibility tracking
 *
 * These replace manual pattern-matching approaches and provide
 * more precise reachability and data flow analysis.
 */

import {
    Scene, ArkClass, ArkMethod, ArkFile,
    Cfg, BasicBlock, DefUseChain, Local, Value, Stmt
} from './arkanalyzer';

/**
 * Result of data flow analysis for a method.
 */
export interface DataFlowAnalysisResult {
    methodName: string;
    fileName: string;
    /** Variables with definitions but unreachable uses */
    deadVariables: DeadVariable[];
    /** API call sites reachable from entry point */
    reachableApiCalls: ReachableApiCall[];
    /** Summary statistics */
    stats: {
        totalStatements: number;
        unreachableBlocks: number;
        deadVariables: number;
    };
}

/**
 * A variable defined but never used (dead code indicator).
 */
export interface DeadVariable {
    name: string;
    definedAt: number;
    definedLine: number;
    type: string;
}

/**
 * An API call that's reachable from entry point.
 */
export interface ReachableApiCall {
    stmtText: string;
    line: number;
    method: string;
    isReachable: boolean;
}

/**
 * Analyze data flow in a scene using built-in Cfg capabilities.
 *
 * This analysis:
 * 1. Detects dead/unreachable code blocks
 * 2. Identifies dead variables (defined but unused)
 * 3. Validates reachability of API calls
 */
export function analyzeDataFlow(scene: Scene): DataFlowAnalysisResult[] {
    const results: DataFlowAnalysisResult[] = [];

    for (const arkFile of scene.getFiles()) {
        for (const arkClass of arkFile.getClasses()) {
            for (const arkMethod of arkClass.getMethods()) {
                const cfg = arkMethod.getCfg();
                if (!cfg) continue;

                const result = analyzeMethodDataFlow(arkMethod, arkFile.getName());
                if (result.stats.unreachableBlocks > 0 || result.stats.deadVariables > 0) {
                    results.push(result);
                }
            }
        }
    }

    return results;
}

/**
 * Analyze data flow for a single method.
 */
function analyzeMethodDataFlow(method: ArkMethod, fileName: string): DataFlowAnalysisResult {
    const cfg = method.getCfg()!;
    const deadVariables: DeadVariable[] = [];
    const reachableApiCalls: ReachableApiCall[] = [];

    // Get unreachable blocks (detected by the framework)
    const unreachableBlocks = cfg.getUnreachableBlocks();
    const unreachableStmts = new Set<Stmt>();
    for (const block of unreachableBlocks) {
        for (const stmt of block.getStmts()) {
            unreachableStmts.add(stmt);
        }
    }

    // Build def-use chains from the framework's analysis
    const defUseChains = cfg.getDefUseChains();
    const definedVars = new Map<string, { stmt: Stmt; chain: DefUseChain }>();

    // Collect all definitions
    for (const chain of defUseChains) {
        const varName = getValueName(chain.value);
        if (varName && !varName.startsWith('_')) {
            definedVars.set(varName, { stmt: chain.def, chain });
        }
    }

    // Find dead variables (defined but never used)
    for (const [varName, info] of definedVars) {
        let useCount = 0;
        for (const chain of defUseChains) {
            if (getValueName(chain.value) === varName && chain.use !== info.stmt) {
                useCount++;
            }
        }
        if (useCount === 0) {
            deadVariables.push({
                name: varName,
                definedAt: info.stmt.getOriginPositionInfo()?.getLineNo() || 0,
                definedLine: info.stmt.getOriginPositionInfo()?.getLineNo() || 0,
                type: getValueType(info.chain.value)
            });
        }
    }

    // Check reachability of API calls
    const allStmts = cfg.getStmts();
    for (const stmt of allStmts) {
        const stmtText = stmt.toString();
        if (looksLikePrivacyApiCall(stmtText)) {
            const isReachable = !unreachableStmts.has(stmt);
            reachableApiCalls.push({
                stmtText,
                line: stmt.getOriginPositionInfo()?.getLineNo() || 0,
                method: method.getName(),
                isReachable
            });
        }
    }

    return {
        methodName: method.getName(),
        fileName,
        deadVariables,
        reachableApiCalls,
        stats: {
            totalStatements: allStmts.length,
            unreachableBlocks: unreachableBlocks.size,
            deadVariables: deadVariables.length
        }
    };
}

/**
 * Get the name of a Value if it's a Local variable.
 */
function getValueName(value: Value): string | null {
    if ('getName' in value && typeof value.getName === 'function') {
        return (value as Local).getName();
    }
    return null;
}

/**
 * Get the type name of a Value.
 */
function getValueType(value: Value): string {
    if ('getType' in value && typeof value.getType === 'function') {
        const t = (value as any).getType();
        return t?.toString() || 'unknown';
    }
    return 'unknown';
}

/**
 * Check if a statement looks like a privacy-sensitive API call.
 * This heuristic supplements the API detection rules.
 */
function looksLikePrivacyApiCall(stmtText: string): boolean {
    const patterns = [
        /\.(getDeviceId|getUniqueId|getIMEI|getOaid|getUUid)\s*\(/i,
        /\.(getLocation|requestLocation)\s*\(/i,
        /\.(getContacts|getCalendar)\s*\(/i,
        /\.(getClipboard|copyFromClipboard)\s*\(/i,
        /\.(captureScreen|screenshot)\s*\(/i,
        /\.(sendSms|readSms)\s*\(/i,
        /\.(startBluetooth|scanBluetooth)\s*\(/i,
        /\.(connectWifi|getConnectedWifi)\s*\(/i,
        /\.(getBatteryInfo|getCpuInfo)\s*\(/i,
        /\.(getRunningAppInfo|getProcessInfo)\s*\(/i,
    ];
    return patterns.some(p => p.test(stmtText));
}

/**
 * Get data flow statistics for a scene.
 */
export function getDataFlowStats(scene: Scene): {
    totalMethods: number;
    methodsWithUnreachableBlocks: number;
    totalUnreachableBlocks: number;
    totalDeadVariables: number;
} {
    let totalMethods = 0;
    let methodsWithUnreachableBlocks = 0;
    let totalUnreachableBlocks = 0;
    let totalDeadVariables = 0;

    for (const arkFile of scene.getFiles()) {
        for (const arkClass of arkFile.getClasses()) {
            for (const arkMethod of arkClass.getMethods()) {
                const cfg = arkMethod.getCfg();
                if (!cfg) continue;

                totalMethods++;
                const unreachable = cfg.getUnreachableBlocks().size;
                if (unreachable > 0) {
                    methodsWithUnreachableBlocks++;
                    totalUnreachableBlocks += unreachable;
                }

                // Count dead variables
                const chains = cfg.getDefUseChains();
                const definedVars = new Set<string>();
                const usedVars = new Set<string>();

                for (const chain of chains) {
                    const name = getValueName(chain.value);
                    if (name) {
                        if (chain.use === chain.def) {
                            definedVars.add(name);
                        } else {
                            usedVars.add(name);
                        }
                    }
                }

                for (const v of definedVars) {
                    if (!usedVars.has(v)) {
                        totalDeadVariables++;
                    }
                }
            }
        }
    }

    return {
        totalMethods,
        methodsWithUnreachableBlocks,
        totalUnreachableBlocks,
        totalDeadVariables
    };
}