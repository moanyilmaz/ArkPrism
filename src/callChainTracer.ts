/**
 * ArkPrism - Layer 4: Call Chain Tracer (v2 - Enhanced)
 *
 * Backward BFS from sensitive API to entry methods.
 * Key Enhancement: ArkUI callback-as-parameter implicit edge detection.
 *
 * ArkAnalyzer transforms `.onClick(() => this.getBatteryInfo())` into:
 *   - `build()` method: `.onClick(%AM0$build)` — %AM0$build is a parameter, NOT a callee
 *   - `%AM0$build()` method: `this.getBatteryInfo()` — actual call
 *
 * The standard invokeExpr-based reverse map misses build()→%AM0$build because
 * %AM0$build is only a parameter to .onClick(), not a direct invocation target.
 *
 * Solution: Augment the reverse call map with ArkUI callback parameter edges.
 */

import {
    Scene, ArkMethod, CallGraph, ArkIfStmt,
    ArkInvokeStmt, ArkAssignStmt, BasicBlock,
    getCallbackMethodFromStmt,
    ClassHierarchyAnalysis, DominanceFinder, DominanceTree,
    CallGraphNode
} from './arkanalyzer';
import {
    PrivacyDataApiResult, CallChainResult,
    CallChainLink, ControlStructureInfo, SourceSnippetInfo, SemanticContext
} from './prototypes';
import { ENTRY_METHOD_NAMES, getEntryPriority, getEntryType } from './callGraphBuilder';
import { readFileSync, existsSync } from 'fs';
import * as path from 'path';

// ---- Helper functions ----

function extractMethodName(sig: string): string {
    let parts = sig.split(".");
    let last = parts[parts.length - 1];
    let paren = last.indexOf("(");
    return paren >= 0 ? last.substring(0, paren) : last;
}

function extractDisplayName(sig: string): string {
    let colonIdx = sig.lastIndexOf(": ");
    let rest = colonIdx >= 0 ? sig.substring(colonIdx + 2) : sig;
    let parenIdx = rest.indexOf("(");
    return parenIdx >= 0 ? rest.substring(0, parenIdx) : rest;
}

function extractFilePath(method: ArkMethod): string {
    try {
        let file = method.getDeclaringArkFile();
        return file ? file.getName() : "unknown";
    } catch { return "unknown"; }
}

// ---- Semantic enrichment helpers ----

/** Lifecycle / ArkUI framework method names that carry no semantic meaning */
const NON_SEMANTIC_PATTERNS = [
    /^build$/, /^aboutToAppear$/, /^aboutToDisappear$/, /^onPageShow$/, /^onPageHide$/,
    /^onBackPress$/, /^initialRender$/, /^func_main_0$/, /^%dflt$/,
    /^%AM\d+\$/, /^_?static_?%?/, /^__init__$/, /^constructor$/
];

/** Check if a method name carries meaningful semantic info (user-defined business logic) */
function isSemanticMethod(methodName: string): boolean {
    let name = methodName;
    let dotIdx = name.lastIndexOf('.');
    if (dotIdx >= 0) name = name.substring(dotIdx + 1);
    return !NON_SEMANTIC_PATTERNS.some(p => p.test(name));
}

/** Resolve ArkAnalyzer anonymous method names to human-readable labels */
function resolveAnonymousName(displayName: string): string | undefined {
    // Pattern: ClassName.%AMn$parentMethod -> "parentMethod_callback_n"
    let match = displayName.match(/^(.+)\.%AM(\d+)\$(.+)$/);
    if (match) {
        return `${match[1]}.${match[3]}_callback_${match[2]}`;
    }
    // Pattern: %dflt.methodName -> "[module].methodName"
    match = displayName.match(/^%dflt\.(.+)$/);
    if (match) {
        return `[module].${match[1]}`;
    }
    // Pattern: %dflt.[static]%dflt -> "[module-level init]"
    if (displayName.includes('%dflt.[static]%dflt') || displayName.includes('%dflt.func_main_0')) {
        return '[module-level init]';
    }
    return undefined;
}

/** Extract page/component name from file path */
function extractPageName(filePath: string): string {
    let basename = filePath.replace(/\\/g, '/').split('/').pop() || filePath;
    return basename.replace(/\.ets$/, '').replace(/\.ts$/, '');
}

/** Build semantic context for a call chain result */
export function buildSemanticContext(
    chainResult: CallChainResult,
    apiResult: PrivacyDataApiResult
): SemanticContext {
    let filePath = chainResult.entryMethod.file;
    let pageName = extractPageName(filePath);

    // Extract component class from entry method name
    let entryName = chainResult.entryMethod.name;
    let componentClass = entryName.includes('.') ? entryName.split('.')[0] : entryName;

    // Find semantic anchor: the most meaningful user-defined function in the chain
    // Walk chain from API-end backward (last callee first) to find the nearest meaningful name
    let semanticAnchor: string | null = null;
    for (let i = chainResult.chain.length - 1; i >= 0; i--) {
        let link = chainResult.chain[i];
        // Check callee first (it's closer to the API)
        if (isSemanticMethod(link.callee)) {
            semanticAnchor = link.callee;
            break;
        }
        // Then check caller
        if (isSemanticMethod(link.caller)) {
            semanticAnchor = link.caller;
            break;
        }
    }
    // Also check sourceSnippets for a meaningful method name
    if (!semanticAnchor) {
        for (let s of chainResult.sourceSnippets) {
            if (isSemanticMethod(s.method)) {
                semanticAnchor = s.method;
            }
        }
    }

    // Build simplified chain: show only meaningful nodes
    let simplifiedParts: string[] = [];
    for (let link of chainResult.chain) {
        let callerName = link.resolvedCallerName || link.caller;
        if (simplifiedParts.length === 0) {
            simplifiedParts.push(callerName + '()');
        }
        let calleeName = link.resolvedCalleeName || link.callee;
        simplifiedParts.push(calleeName + '()');
    }
    // Add API as last element
    let apiFullName = `${apiResult.namespace}.${apiResult.method}`;
    if (simplifiedParts.length > 0) {
        let last = simplifiedParts[simplifiedParts.length - 1];
        if (!last.includes(apiResult.method)) {
            simplifiedParts.push(apiFullName);
        }
    } else {
        simplifiedParts.push(apiFullName);
    }
    let simplifiedChain = simplifiedParts.join(' -> ');

    // Build purpose hint
    let sinkTypes = chainResult.dataSinks ?
        [...new Set(chainResult.dataSinks.map(s => s.sinkType))].join('/') : 'unknown';
    let apiShortName = apiResult.method;
    let category = apiResult.profilingCategory || apiResult.category;

    let purposeHint = `In ${pageName}.ets`;
    if (semanticAnchor) {
        purposeHint += `, function ${semanticAnchor}()`;
    }
    purposeHint += ` calls ${apiShortName} [${category}]`;
    if (chainResult.dataSinks && chainResult.dataSinks.length > 0) {
        let sinkApis = [...new Set(chainResult.dataSinks.map(s => s.sinkApi))].join(', ');
        purposeHint += `, data flows to ${sinkTypes} (${sinkApis})`;
    } else {
        purposeHint += `, data destination: not traced`;
    }
    // Append control flow context
    if (chainResult.controlStructures && chainResult.controlStructures.length > 0) {
        let ctrlDescs: string[] = [];
        for (let cs of chainResult.controlStructures) {
            if (cs.type === 'if') {
                let desc = `conditional call`;
                if (cs.isGuardCondition) desc = `permission-guarded call`;
                if (cs.condition) desc += ` (${cs.condition})`;
                if (cs.branchSide && cs.branchSide !== 'unknown') desc += ` on ${cs.branchSide}`;
                ctrlDescs.push(desc);
            } else if (cs.type === 'try_catch') {
                let desc = `inside try-catch`;
                if (cs.hasCatchFallback) desc += ` with catch fallback`;
                ctrlDescs.push(desc);
            } else if (cs.type === 'loop') {
                ctrlDescs.push(`called in loop`);
            }
        }
        if (ctrlDescs.length > 0) {
            purposeHint += `. Control flow: ${ctrlDescs.join('; ')}`;
        }
    }

    return {
        pageName,
        componentClass,
        semanticAnchor,
        simplifiedChain,
        purposeHint
    };
}

/**
 * Enrich all call chain results with semantic context.
 * Call this AFTER analyzeDataSinks so that purposeHint includes sink info.
 */
export function enrichCallChainsWithSemanticContext(
    callChains: CallChainResult[],
    apiResults: PrivacyDataApiResult[]
): void {
    for (let chain of callChains) {
        let api = apiResults[chain.apiUsageIndex];
        if (api) {
            chain.semanticContext = buildSemanticContext(chain, api);
        }
    }
    console.log(`[SEMANTIC] Enriched ${callChains.length} call chains with semantic context.`);
}

function extractMethodLine(method: ArkMethod): number {
    try {
        let body = method.getBody();
        if (body) {
            let stmts = body.getCfg().getStmts();
            if (stmts.length > 0) {
                let pos = stmts[0].getOriginPositionInfo();
                if (pos) return pos.getLineNo();
            }
        }
    } catch { /* ignore */ }
    return 0;
}

// ---- Core: Enhanced Reverse Call Map ----

/**
 * Build the enhanced reverse call map from the Scene and built-in CallGraph.
 * 
 * Five sources of edges (layered for maximum coverage):
 *   1. Built-in CG edges: from ArkAnalyzer's RTA/CHA call graph (getOutgoingEdges)
 *   2. CHA virtual call resolution: resolves interface/abstract method calls
 *   3. Standard invoke edges: from IR statement scanning (fallback/supplement)
 *   4. Callback parameter edges: %AMx references in statements
 *   5. getCallbackMethodFromStmt: Promise .then/.catch callbacks
 */
function buildEnhancedReverseCallMap(scene: Scene, callGraph: CallGraph): Map<string, Set<string>> {
    let reverseMap = new Map<string, Set<string>>();

    function ensureKey(key: string) {
        if (!reverseMap.has(key)) {
            reverseMap.set(key, new Set());
        }
    }

    // ---- Source 1: Built-in CallGraph edges ----
    // These are the most reliable since they come from ArkAnalyzer's own RTA/CHA analysis
    let cgEdgeCount = 0;
    try {
        let nodes = callGraph.nodesItor();
        for (let node of nodes) {
            let cgNode = node as CallGraphNode;
            let callerSig = cgNode.getMethod()?.toString();
            if (!callerSig) continue;
            ensureKey(callerSig);

            let outEdges = node.getOutgoingEdges();
            if (outEdges) {
                for (let edge of outEdges) {
                    let dstNode = edge.getDstNode() as CallGraphNode;
                    if (dstNode) {
                        let calleeSig = dstNode.getMethod()?.toString();
                        if (calleeSig && calleeSig !== callerSig) {
                            ensureKey(calleeSig);
                            reverseMap.get(calleeSig)!.add(callerSig);
                            cgEdgeCount++;
                        }
                    }
                }
            }
        }
    } catch (e) {
        console.log(`[CHAIN] Warning: CG edge traversal failed: ${e}`);
    }
    console.log(`[CHAIN] Source 1 - Built-in CG edges: ${cgEdgeCount}`);

    // ---- Source 2: CHA virtual call resolution ----
    let chaEdgeCount = 0;
    try {
        let cha = new ClassHierarchyAnalysis(scene, callGraph);
        for (const method of scene.getMethods()) {
            let callerSig = method.getSignature().toString();
            ensureKey(callerSig);
            let body = method.getBody();
            if (!body) continue;
            for (let stmt of body.getCfg().getStmts()) {
                if (stmt.containsInvokeExpr()) {
                    let invokeExpr = stmt.getInvokeExpr();
                    if (invokeExpr) {
                        try {
                            let resolved = (cha as any).resolveCall(method, stmt);
                            if (resolved && resolved.length > 0) {
                                for (let resolvedSig of resolved) {
                                    let rSigStr = resolvedSig.toString();
                                    ensureKey(rSigStr);
                                    if (!reverseMap.get(rSigStr)!.has(callerSig)) {
                                        reverseMap.get(rSigStr)!.add(callerSig);
                                        chaEdgeCount++;
                                    }
                                }
                            }
                        } catch { /* CHA may not resolve all calls */ }
                    }
                }
            }
        }
    } catch (e) {
        console.log(`[CHAIN] Warning: CHA resolution failed: ${e}`);
    }
    console.log(`[CHAIN] Source 2 - CHA resolved edges: ${chaEdgeCount}`);

    // ---- Source 3: Standard invoke edges (supplement what CG may have missed) ----
    let invokeEdgeCount = 0;
    for (const method of scene.getMethods()) {
        let callerSig = method.getSignature().toString();
        ensureKey(callerSig);
        let body = method.getBody();
        if (!body) continue;
        for (let stmt of body.getCfg().getStmts()) {
            if (stmt.containsInvokeExpr()) {
                let invokeExpr = stmt.getInvokeExpr();
                if (invokeExpr) {
                    let calleeSig = invokeExpr.getMethodSignature().toString();
                    ensureKey(calleeSig);
                    if (!reverseMap.get(calleeSig)!.has(callerSig)) {
                        reverseMap.get(calleeSig)!.add(callerSig);
                        invokeEdgeCount++;
                    }
                }
            }

            // ---- Source 4: Callback parameter edges (%AM references) ----
            let stmtStr = stmt.toString();
            if (stmtStr.includes("%AM")) {
                let amRefs = stmtStr.match(/%AM\d+(?:\$%AM\d+)*(?:\$\w+)*/g);
                if (amRefs) {
                    let declaringClass = method.getDeclaringArkClass();
                    if (declaringClass) {
                        for (let amRef of amRefs) {
                            for (let classMethod of declaringClass.getMethods()) {
                                let cmName = classMethod.getName();
                                if (cmName === amRef || cmName.endsWith(amRef)) {
                                    let callbackSig = classMethod.getSignature().toString();
                                    if (callbackSig !== callerSig) {
                                        ensureKey(callbackSig);
                                        reverseMap.get(callbackSig)!.add(callerSig);
                                    }
                                }
                            }
                        }
                    }
                }
            }

            // ---- Source 5: getCallbackMethodFromStmt (Promise .then/.catch) ----
            try {
                let cbMethods = getCallbackMethodFromStmt(stmt, scene);
                if (cbMethods && Array.isArray(cbMethods)) {
                    for (let cbMethod of cbMethods) {
                        if (cbMethod) {
                            let cbSig = cbMethod.getSignature().toString();
                            if (cbSig !== callerSig) {
                                ensureKey(cbSig);
                                reverseMap.get(cbSig)!.add(callerSig);
                            }
                        }
                    }
                }
            } catch { /* ignore */ }
        }
    }
    console.log(`[CHAIN] Source 3 - Supplemental invoke edges: ${invokeEdgeCount}`);

    return reverseMap;
}

// ---- BFS improvements ----

/**
 * Check if a method name is a recognized entry point.
 * Enhanced: recognizes build(), initialRender(), _DEFAULT_ARK_METHOD,
 * %dflt (module-level default methods), and constructor as entry points.
 */
function isEntryMethod(methodName: string): boolean {
    if (ENTRY_METHOD_NAMES.includes(methodName)) return true;
    // Module-level init and default methods
    if (methodName === "%dflt" || methodName === "[static]%dflt") return true;
    if (methodName === "initialRender") return true;
    return false;
}

/**
 * Determine the call type from caller→callee.
 */
function determineCallType(callerName: string, calleeName: string): "direct" | "instance_invoke" | "static_invoke" | "lifecycle_implicit" | "callback" | "unknown" {
    // If callee is %AMx pattern, it's a callback
    if (calleeName.includes("%AM")) return "callback";
    // If callee is a lifecycle method
    if (["aboutToAppear", "build", "onCreate", "onForeground"].includes(calleeName)) return "lifecycle_implicit";
    return "direct";
}

// ---- Extraction functions ----

function extractControlStructures(method: ArkMethod): ControlStructureInfo[] {
    let results: ControlStructureInfo[] = [];
    let file = extractFilePath(method);
    try {
        let body = method.getBody();
        if (!body) return results;
        let cfg = body.getCfg();
        let blocks = cfg.getBlocks();

        // Build block ordering for loop detection via back-edges
        let blockOrder = new Map<BasicBlock, number>();
        let idx = 0;
        for (let block of blocks) {
            blockOrder.set(block, idx++);
        }

        // Build dominance tree for precise "if dominates API call" analysis
        let immDominators: Map<BasicBlock, BasicBlock> | null = null;
        try {
            let domFinder = new DominanceFinder(cfg);
            let idoms = domFinder.getImmediateDominators();
            if (idoms) {
                immDominators = new Map<BasicBlock, BasicBlock>();
                // idoms is typically an array or map of blockIdx -> domBlockIdx
                let blockArr = Array.from(blocks);
                let blockIdxMap = domFinder.getBlockToIdx();
                if (blockIdxMap && idoms) {
                    // Build BasicBlock -> BasicBlock mapping from the idx-based result
                    for (let [block, blockIdx] of blockIdxMap) {
                        let domIdx = idoms[blockIdx];
                        if (domIdx !== undefined && domIdx >= 0 && domIdx < blockArr.length) {
                            // Find the block with this idx
                            for (let [b, bi] of blockIdxMap) {
                                if (bi === domIdx) {
                                    immDominators.set(block, b);
                                    break;
                                }
                            }
                        }
                    }
                }
            }
        } catch { /* DominanceFinder may fail on some CFGs */ }

        // Helper: check if blockA dominates blockB using immediate dominators
        function isDominatedBy(blockB: BasicBlock, blockA: BasicBlock): boolean {
            if (!immDominators) return false;
            let current: BasicBlock | undefined = blockB;
            let visited = new Set<BasicBlock>();
            while (current && !visited.has(current)) {
                if (current === blockA) return true;
                visited.add(current);
                current = immDominators.get(current);
            }
            return false;
        }

        // Collect all blocks containing invoke statements (API call candidates)
        let invokeBlocks = new Set<BasicBlock>();
        for (let block of blocks) {
            if (blockContainsInvoke(block)) {
                invokeBlocks.add(block);
            }
        }

        for (let block of blocks) {
            let blockStmts = block.getStmts();
            if (blockStmts.length === 0) continue;
            let lastStmt = blockStmts[blockStmts.length - 1];

            // --- IF / conditional branch ---
            if (lastStmt instanceof ArkIfStmt) {
                let line = 0;
                try {
                    let pos = lastStmt.getOriginPositionInfo();
                    if (pos) line = pos.getLineNo();
                } catch { /* ignore */ }

                let condStr = '';
                try { condStr = lastStmt.getConditionExpr()?.toString() || lastStmt.toString(); } catch { condStr = lastStmt.toString(); }

                // Check if the condition looks like a guard/permission check
                let isGuard = isGuardCondition(condStr);

                // Check successors: which branch contains invocations?
                let successors = block.getSuccessors();
                let trueBranchHasInvoke = false;
                let falseBranchHasInvoke = false;
                if (successors.length >= 1) {
                    trueBranchHasInvoke = blockContainsInvoke(successors[0]);
                }
                if (successors.length >= 2) {
                    falseBranchHasInvoke = blockContainsInvoke(successors[1]);
                }

                let branchSide = 'unknown';
                if (trueBranchHasInvoke && !falseBranchHasInvoke) branchSide = 'true_branch';
                else if (!trueBranchHasInvoke && falseBranchHasInvoke) branchSide = 'false_branch';
                else if (trueBranchHasInvoke && falseBranchHasInvoke) branchSide = 'both_branches';

                // Dominance check: does this if-block dominate any invoke block?
                let dominatesInvoke = false;
                for (let invokeBlock of invokeBlocks) {
                    if (isDominatedBy(invokeBlock, block)) {
                        dominatesInvoke = true;
                        break;
                    }
                }

                results.push({
                    type: "if",
                    condition: condStr,
                    file, line,
                    containsApiCall: trueBranchHasInvoke || falseBranchHasInvoke,
                    branchSide,
                    isGuardCondition: isGuard,
                    isDominatingApiCall: dominatesInvoke
                });
            }

            // --- TRY-CATCH via exceptional successors ---
            let exceptionalSuccessors = block.getExceptionalSuccessorBlocks();
            if (exceptionalSuccessors && exceptionalSuccessors.length > 0) {
                let hasInvokeInTry = blockContainsInvoke(block);
                let hasInvokeInCatch = exceptionalSuccessors.some((eb: BasicBlock) => blockContainsInvoke(eb));
                let line = 0;
                try {
                    let pos = blockStmts[0].getOriginPositionInfo();
                    if (pos) line = pos.getLineNo();
                } catch { /* ignore */ }

                results.push({
                    type: "try_catch",
                    file, line,
                    containsApiCall: hasInvokeInTry,
                    branchSide: hasInvokeInTry ? 'try_block' : (hasInvokeInCatch ? 'catch_block' : 'unknown'),
                    hasCatchFallback: hasInvokeInCatch
                });
            }

            // --- LOOP detection via back-edges ---
            let successors = block.getSuccessors();
            for (let succ of successors) {
                let succOrder = blockOrder.get(succ);
                let blockOrderNum = blockOrder.get(block);
                if (succOrder !== undefined && blockOrderNum !== undefined && succOrder <= blockOrderNum) {
                    // Back-edge detected: this block jumps to an earlier block = loop
                    let line = 0;
                    try {
                        let pos = blockStmts[0].getOriginPositionInfo();
                        if (pos) line = pos.getLineNo();
                    } catch { /* ignore */ }

                    let hasInvoke = blockContainsInvoke(block);
                    results.push({
                        type: "loop",
                        file, line,
                        containsApiCall: hasInvoke,
                        branchSide: hasInvoke ? 'loop_body' : 'unknown'
                    });
                    break; // only report once per block
                }
            }
        }
    } catch { /* ignore */ }
    return results;
}

/** Check if a BasicBlock contains any invoke statements */
function blockContainsInvoke(block: BasicBlock): boolean {
    for (let stmt of block.getStmts()) {
        if (stmt.containsInvokeExpr()) return true;
    }
    return false;
}

/** Permission/guard-related keywords in conditions */
const GUARD_PATTERNS = [
    /permission/i, /granted/i, /authorized/i, /allowed/i,
    /checkAccessToken/i, /requestPermission/i, /isLocationEnabled/i,
    /hasPermission/i, /canUse/i, /isAvailable/i, /isSupported/i,
    /verify/i, /enable/i, /isActive/i
];

/** Check if a condition string looks like a guard/permission check */
function isGuardCondition(condition: string): boolean {
    return GUARD_PATTERNS.some(p => p.test(condition));
}

function extractSourceSnippet(method: ArkMethod, projectDir?: string): SourceSnippetInfo | null {
    let file = extractFilePath(method);
    let displayName = extractDisplayName(method.getSignature().toString());
    try {
        let body = method.getBody();
        if (!body) return null;
        let stmts = body.getCfg().getStmts();
        if (stmts.length === 0) return null;

        let lines: string[] = [];
        let startLine = Infinity;
        let endLine = 0;
        for (let stmt of stmts) {
            lines.push("  " + stmt.toString());
            try {
                let pos = stmt.getOriginPositionInfo();
                if (pos) {
                    let lineNo = pos.getLineNo();
                    if (lineNo > 0 && lineNo < startLine) startLine = lineNo;
                    if (lineNo > endLine) endLine = lineNo;
                }
            } catch { /* ignore */ }
        }
        if (startLine === Infinity) startLine = 0;

        let result: SourceSnippetInfo = {
            method: displayName, file, startLine, endLine,
            code: lines.join("\n")
        };

        // Read original .ets source code if possible
        if (projectDir && startLine > 0 && endLine > 0) {
            try {
                let originalFilePath = path.resolve(projectDir, file);
                if (existsSync(originalFilePath)) {
                    let allLines = readFileSync(originalFilePath, 'utf8').split('\n');
                    let contextPadding = 2; // extra lines before/after for context
                    let readStart = Math.max(0, startLine - 1 - contextPadding);
                    let readEnd = Math.min(allLines.length, endLine + contextPadding);
                    result.originalCode = allLines.slice(readStart, readEnd).join('\n');
                }
            } catch { /* ignore file read errors */ }
        }

        return result;
    } catch { return null; }
}

// ---- Main trace function ----

/**
 * Trace call chains from detected API usages back to entry methods.
 * Enhanced with ArkUI callback parameter edge detection.
 */
export function traceCallChains(
    apiResults: PrivacyDataApiResult[],
    scene: Scene,
    cg: CallGraph,
    projectDir?: string
): CallChainResult[] {
    console.log("[CHAIN] Building enhanced reverse call map (with ArkUI callback edges)...");
    let reverseMap = buildEnhancedReverseCallMap(scene, cg);
    console.log(`[CHAIN] Enhanced reverse map built. ${reverseMap.size} entries.`);

    // Log some callback edges for debugging
    let callbackEdgeCount = 0;
    for (let [callee, callers] of reverseMap) {
        if (callee.includes("%AM")) {
            for (let caller of callers) {
                if (caller.includes("build") || caller.includes("initialRender")) {
                    callbackEdgeCount++;
                }
            }
        }
    }
    console.log(`[CHAIN] Callback parameter edges detected: ${callbackEdgeCount}`);

    let methodMap = new Map<string, ArkMethod>();
    for (const method of scene.getMethods()) {
        methodMap.set(method.getSignature().toString(), method);
    }

    let callChainResults: CallChainResult[] = [];

    for (let i = 0; i < apiResults.length; i++) {
        let apiResult = apiResults[i];
        let apiMethodSig = apiResult.declaringMethod;
        if (!apiMethodSig) continue;

        // Quick check: if the declaring method itself is an entry point
        let apiMethodName = extractMethodName(apiMethodSig);
        if (isEntryMethod(apiMethodName)) {
            // API is directly in an entry method — create a self-contained chain
            let method = methodMap.get(apiMethodSig);
            let snippet = method ? extractSourceSnippet(method, projectDir) : null;
            callChainResults.push({
                apiUsageIndex: i,
                entryMethod: {
                    name: extractDisplayName(apiMethodSig),
                    type: getEntryType(apiMethodName),
                    file: method ? extractFilePath(method) : apiResult.file,
                    line: method ? extractMethodLine(method) : 0
                },
                chain: [{
                    caller: extractDisplayName(apiMethodSig),
                    callee: `${apiResult.namespace}.${apiResult.method}`,
                    callType: "direct"
                }],
                controlStructures: method ? extractControlStructures(method) : [],
                sourceSnippets: snippet ? [snippet] : []
            });
            continue;
        }

        // BFS backward from the API declaring method
        let visited = new Set<string>([apiMethodSig]);
        let parent = new Map<string, string>(); // parent[child] = from which node we discovered child
        let queue: string[] = [apiMethodSig];
        let foundEntry: string | null = null;
        let maxDepth = 15;
        let depth = 0;

        bfs:
        while (queue.length > 0 && depth < maxDepth) {
            let nextQueue: string[] = [];
            for (let current of queue) {
                let callers = reverseMap.get(current);
                if (callers) {
                    for (let caller of callers) {
                        if (!visited.has(caller)) {
                            visited.add(caller);
                            parent.set(caller, current); // "I reached caller from current"
                            nextQueue.push(caller);

                            // Check if this caller is an entry method
                            let callerMethodName = extractMethodName(caller);
                            if (isEntryMethod(callerMethodName)) {
                                foundEntry = caller;
                                break bfs;
                            }
                        }
                    }
                }
            }
            queue = nextQueue;
            depth++;
        }

        if (foundEntry) {
            let chain: CallChainLink[] = [];
            let controlStructures: ControlStructureInfo[] = [];
            let sourceSnippets: SourceSnippetInfo[] = [];

            // Reconstruct path from entry to API
            // parent[caller] = current means: from caller, we go down to current
            // Start from foundEntry and follow parent values down to apiMethodSig
            let path: string[] = [foundEntry];
            let walk = foundEntry;
            while (walk !== apiMethodSig && parent.has(walk)) {
                // parent.get(walk) is wrong direction — parent[walk] = the node FROM which we found walk
                // We need to go the other way: foundEntry → ... → apiMethodSig
                // Actually parent[child] = discoverer, so we need to reverse
                break; // Will rebuild below
            }

            // Correct path reconstruction: BFS stored parent[caller] = current
            // meaning "caller was discovered while exploring current"
            // To get path from entry to API: start at entry, follow reverse of parent
            // Build forward map from parent: forwardEdge[from] = to
            // Actually simpler: walk backward from apiMethodSig using inverse
            path = [apiMethodSig];
            walk = apiMethodSig;
            let inverseParent = new Map<string, string>();
            for (let [child, discoverer] of parent) {
                // child was discovered from discoverer
                // In reverse BFS: discoverer is closer to API, child is closer to entry
                inverseParent.set(child, discoverer);
            }
            // Walk from foundEntry -> apiMethodSig using inverseParent
            path = [foundEntry];
            walk = foundEntry;
            let safety = 0;
            while (walk !== apiMethodSig && safety < 50) {
                let next = inverseParent.get(walk);
                if (!next) break;
                path.push(next);
                walk = next;
                safety++;
            }
            // path is now: entry → ... → apiMethod

            for (let j = 0; j < path.length - 1; j++) {
                let callerDisplay = extractDisplayName(path[j]);
                let calleeDisplay = extractDisplayName(path[j + 1]);
                let calleeName = extractMethodName(path[j + 1]);
                let link: CallChainLink = {
                    caller: callerDisplay,
                    callee: calleeDisplay,
                    callType: determineCallType(callerDisplay, calleeName)
                };
                // Resolve anonymous method names for readability
                let resolvedCaller = resolveAnonymousName(callerDisplay);
                let resolvedCallee = resolveAnonymousName(calleeDisplay);
                if (resolvedCaller) link.resolvedCallerName = resolvedCaller;
                if (resolvedCallee) link.resolvedCalleeName = resolvedCallee;
                chain.push(link);
                let method = methodMap.get(path[j]);
                if (method) {
                    controlStructures = controlStructures.concat(extractControlStructures(method));
                }
            }

            // Collect source snippets for all methods in the chain
            for (let sigStr of path) {
                let method = methodMap.get(sigStr);
                if (method) {
                    let snippet = extractSourceSnippet(method, projectDir);
                    if (snippet) sourceSnippets.push(snippet);
                }
            }

            let entryMethod = methodMap.get(foundEntry);
            let entryMethodName = extractMethodName(foundEntry);

            let result: CallChainResult = {
                apiUsageIndex: i,
                entryMethod: {
                    name: extractDisplayName(foundEntry),
                    type: getEntryType(entryMethodName),
                    file: entryMethod ? extractFilePath(entryMethod) : "unknown",
                    line: entryMethod ? extractMethodLine(entryMethod) : 0
                },
                chain, controlStructures, sourceSnippets
            };

            // ArkAwaitExpr detection: check if API-declaring method uses await
            try {
                let apiDeclMethod = methodMap.get(apiMethodSig);
                if (apiDeclMethod) {
                    let body = apiDeclMethod.getBody();
                    if (body) {
                        for (let stmt of body.getCfg().getStmts()) {
                            let uses = stmt.getUses ? stmt.getUses() : [];
                            for (let u of uses) {
                                if (u && u.constructor && u.constructor.name === 'ArkAwaitExpr') {
                                    result.isAsync = true;
                                    break;
                                }
                            }
                            if (result.isAsync) break;
                            // Fallback: check IR text
                            if (stmt.toString().includes('awaitexpr')) {
                                result.isAsync = true;
                                break;
                            }
                        }
                    }
                }
            } catch { /* ignore */ }

            callChainResults.push(result);
        } else {
            // No entry found — still output with fallback info
            callChainResults.push({
                apiUsageIndex: i,
                entryMethod: {
                    name: extractDisplayName(apiMethodSig),
                    type: "unknown",
                    file: apiResult.file,
                    line: 0
                },
                chain: [], controlStructures: [], sourceSnippets: []
            });
        }
    }

    let chainsWithPath = callChainResults.filter(c => c.chain.length > 0).length;
    console.log(`[CHAIN] Built ${callChainResults.length} call chains (${chainsWithPath} with paths, ${callChainResults.length - chainsWithPath} without).`);
    return callChainResults;
}
