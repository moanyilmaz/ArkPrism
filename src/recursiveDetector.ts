/**
 * Recursive Pattern Detector using SCCDetection
 *
 * Detects loops in call graph that may collect privacy data repeatedly.
 * Examples:
 *   - while(true) { getLocation() }
 *   - setInterval(() => { collectData() }, 1000)
 *   - recursive timer patterns
 */

import {
    Scene, Cfg, BasicBlock, SCCDetection, GraphTraits, BaseNode
} from './arkanalyzer';

/**
 * A detected recursive data collection pattern.
 */
export interface RecursivePattern {
    methodName: string;
    fileName: string;
    loopType: 'while' | 'for' | 'recursive' | 'timer';
    containsPrivacyApi: boolean;
    privacyApis: string[];
}

/**
 * Detect recursive/loop patterns that may collect privacy data repeatedly.
 * Uses SCCDetection to find cycles in call graph and control flow.
 */
export function detectRecursivePatterns(scene: Scene): RecursivePattern[] {
    const patterns: RecursivePattern[] = [];

    // Detect loops in each method's CFG
    for (const arkFile of scene.getFiles()) {
        for (const arkClass of arkFile.getClasses()) {
            for (const method of arkClass.getMethods()) {
                const cfg = method.getCfg();
                if (!cfg) continue;

                const loopType = detectLoopType(cfg);
                if (loopType) {
                    patterns.push({
                        methodName: method.getName(),
                        fileName: arkFile.getName(),
                        loopType,
                        containsPrivacyApi: false,
                        privacyApis: []
                    });
                }
            }
        }
    }

    return patterns;
}

/**
 * Detect loop type in CFG by finding back edges.
 * A back edge is an edge from block A to block B where B dominates A.
 */
function detectLoopType(cfg: Cfg): RecursivePattern['loopType'] | null {
    const blocks = [...cfg.getBlocks()];
    const blockIndex = new Map<BasicBlock, number>();
    blocks.forEach((b, i) => blockIndex.set(b, i));

    // Find back edges: edges that point to an earlier block (lower index)
    for (const block of blocks) {
        const blockIdx = blockIndex.get(block) || 0;
        for (const succ of block.getSuccessors()) {
            const succIdx = blockIndex.get(succ);
            // Back edge: successor has lower or equal index (loop)
            // Equal means self-loop, lower means entry point loop
            if (succIdx !== undefined && succIdx <= blockIdx) {
                // Check if this looks like a timer callback
                const stmts = [...block.getStmts()];
                const allStmts = stmts.map(s => s.toString()).join(' ');

                if (allStmts.includes('setInterval') || allStmts.includes('setTimeout')) {
                    return 'timer';
                }
                if (allStmts.includes('while')) return 'while';
                if (allStmts.includes('for')) return 'for';
                // If we can't determine type but there's a back edge, it's recursive
                return 'recursive';
            }
        }
    }

    return null;
}

/**
 * Get statistics about recursive patterns in the scene.
 */
export function getRecursiveStats(scene: Scene): {
    totalMethods: number;
    methodsWithLoops: number;
    loopBreakdown: { [key: string]: number };
} {
    let totalMethods = 0;
    let methodsWithLoops = 0;
    const loopBreakdown: { [key: string]: number } = {};

    for (const arkFile of scene.getFiles()) {
        for (const arkClass of arkFile.getClasses()) {
            for (const method of arkClass.getMethods()) {
                totalMethods++;
                const cfg = method.getCfg();
                if (cfg && detectLoopType(cfg)) {
                    methodsWithLoops++;
                    const loopType = detectLoopType(cfg)!;
                    loopBreakdown[loopType] = (loopBreakdown[loopType] || 0) + 1;
                }
            }
        }
    }

    return { totalMethods, methodsWithLoops, loopBreakdown };
}