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
    getCallbackMethodFromStmt, Stmt,
    ClassHierarchyAnalysis,
    CallGraphNode
} from './arkanalyzer';
import {
    PrivacyDataApiResult, CallChainResult,
    CallChainLink, ControlStructureInfo, SourceSnippetInfo, SemanticContext
} from './prototypes';
import { ENTRY_METHOD_NAMES, getEntryPriority, getEntryType } from './callGraphBuilder';
import { readFileSync, existsSync } from 'fs';
import * as path from 'path';

// ---- ArkUI callback event registration whitelist ----
// Only these method names are allowed to trigger getCallbackMethodFromStmt
const CALLBACK_EVENT_METHODS = new Set([
    'then', 'catch', 'finally',  // Promise
    'onClick', 'onChange', 'onSubmit', 'onTouch', 'onAppear', 'onDisappear',  // Common UI events
    'onPageShow', 'onPageHide', 'onBackPress',  // Page lifecycle
    'onDragStart', 'onDragMove', 'onDragEnd', 'onDrop',  // Drag events
    'onLongPress', 'onSwipe', 'onPinchMove', 'onPinchEnd',  // Gesture events
    'onKeyPress', 'onKeyDown', 'onKeyUp',  // Keyboard events
    'onFocus', 'onBlur',  // Focus events
    'onVisibleAreaChange', 'onAreaChange',  // Layout events
    'onScroll', 'onScrollStop',  // Scroll events
    'onMouse', 'onHover',  // Mouse events
    'onCut', 'onPaste', 'onCopy',  // Clipboard events
]);

// ---- Helper functions ----

/**
 * Safely parse callback methods from invoke statement arguments.
 * Only uses FunctionType/ClosureType signatures, no regex fallback.
 * Returns array of callback ArkMethods found in invoke arguments.
 */
function getCallbackMethodsFromInvokeArgs(stmt: Stmt, scene: Scene): ArkMethod[] {
    const results: ArkMethod[] = [];

    if (!stmt.containsInvokeExpr()) {
        return results;
    }

    const invokeExpr = stmt.getInvokeExpr();
    if (!invokeExpr) {
        return results;
    }

    const args = invokeExpr.getArgs();
    for (const arg of args) {
        const argType = arg.getType();
        if (!argType) continue;

        // Handle FunctionType - getMethodSignature returns MethodSignature
        if (argType.constructor.name === 'FunctionType') {
            try {
                const funcType = argType as any;
                if (funcType.getMethodSignature) {
                    const sig = funcType.getMethodSignature();
                    if (sig) {
                        // Try to find the method by signature string
                        const sigStr = sig.toString();
                        const callbackMethod = scene.getMethod(sigStr);
                        if (callbackMethod) {
                            results.push(callbackMethod);
                        }
                    }
                }
            } catch { /* ignore */ }
        }

        // Handle ClosureType (lambda expressions) - try to find method by closure name pattern
        if (argType.constructor.name === 'ClosureType') {
            try {
                const typeStr = argType.toString();
                // Extract closure method name from type string: closures: ClassName.%AMn$parentMethod
                const match = typeStr.match(/closures:\s*([^\s,]+)/);
                if (match) {
                    const closureName = match[1].trim();
                    // Find method by name in the declaring class
                    const callerMethod = stmt.getCfg()?.getDeclaringMethod();
                    if (callerMethod) {
                        const declaringClass = callerMethod.getDeclaringArkClass();
                        if (declaringClass) {
                            const allMethods = declaringClass.getMethods(true);
                            for (const m of allMethods) {
                                if (m.getName() === closureName) {
                                    results.push(m);
                                    break;
                                }
                            }
                        }
                    }
                }
            } catch { /* ignore */ }
        }
    }

    return results;
}

/**
 * Check if a method name is a callback event registration (whitelist check).
 */
function isCallbackEventMethod(methodName: string): boolean {
    return CALLBACK_EVENT_METHODS.has(methodName);
}

function extractMethodName(sig: string): string {
    const displayName = extractDisplayName(sig);
    const dotIdx = displayName.lastIndexOf(".");
    return dotIdx >= 0 ? displayName.substring(dotIdx + 1) : displayName;
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

function extractAnonymousParentName(methodName: string): string | null {
    const match = methodName.match(/%AM\d+\$(.+)$/);
    if (match) return match[1];
    if (/^%AM\d+$/.test(methodName)) return '%dflt';
    return null;
}

function findMethodByNameInClass(method: ArkMethod, methodName: string): ArkMethod | null {
    try {
        const cls = method.getDeclaringArkClass();
        for (const candidate of cls.getMethods(true)) {
            if (candidate === method) continue;
            if (candidate.getName() === methodName) {
                return candidate;
            }
        }
    } catch { /* ignore */ }
    return null;
}

function findMethodInFileClass(scene: Scene, fileName: string, className: string, methodName: string): ArkMethod | null {
    for (const method of scene.getMethods()) {
        try {
            const cls = method.getDeclaringArkClass();
            const file = method.getDeclaringArkFile();
            if (file?.getName() === fileName && cls.getName() === className && method.getName() === methodName) {
                return method;
            }
        } catch { /* ignore */ }
    }
    return null;
}

function extractAnonymousObjectOwner(className: string): { className: string; ownerMethodName: string } | null {
    const match = className.match(/^%AC\d+\$([^.]+)\.(.+)$/);
    if (!match) return null;
    return { className: match[1], ownerMethodName: match[2] };
}

function extractThisMethodRefAssignment(stmtText: string): { localName: string; methodName: string } | null {
    const match = stmtText.match(/^(\S+)\s*=\s*this\.<[^>]+:\s*([^>]+)>/);
    if (!match) return null;
    const fieldRef = match[2].trim();
    const dotIdx = fieldRef.lastIndexOf('.');
    const methodName = dotIdx >= 0 ? fieldRef.substring(dotIdx + 1) : fieldRef;
    if (!methodName) return null;
    return { localName: match[1], methodName };
}

function extractBuilderFieldAssignmentLocal(stmtText: string): string | null {
    const match = stmtText.match(/^this\.<[^>]+:\s*[^>]*\.builder>\s*=\s*(\S+)/);
    return match ? match[1] : null;
}

function normalizeArkMethodName(methodName: string): string {
    return methodName.replace(/^\[static\]/, '');
}

function findMethodsByNameInClass(method: ArkMethod, methodName: string): ArkMethod[] {
    const results: ArkMethod[] = [];
    try {
        const cls = method.getDeclaringArkClass();
        for (const candidate of cls.getMethods(true)) {
            if (candidate === method) continue;
            if (normalizeArkMethodName(candidate.getName()) === methodName) {
                results.push(candidate);
            }
        }
    } catch { /* ignore */ }
    return results;
}

function findWrappedAopMethodsByName(scene: Scene, methodName: string): ArkMethod[] {
    const results: ArkMethod[] = [];
    for (const method of scene.getMethods()) {
        try {
            const clsName = method.getDeclaringArkClass().getName();
            if ((clsName.startsWith('Wrapped') || clsName.includes('$AOPUtil.wrap')) &&
                normalizeArkMethodName(method.getName()) === methodName) {
                results.push(method);
            }
        } catch { /* ignore */ }
    }
    return results;
}

function isGeneratedOrArchiveFile(fileName: string): boolean {
    const normalized = fileName.replace(/\\/g, '/').toLowerCase();
    return normalized.includes('/.preview/') ||
        normalized.includes('/build/') ||
        normalized.includes('/cache/') ||
        normalized.includes('/archive_files/');
}

function findUniqueProjectMethodByName(scene: Scene, methodName: string): ArkMethod[] {
    const candidates: ArkMethod[] = [];
    for (const method of scene.getMethods()) {
        try {
            const fileName = method.getDeclaringArkFile()?.getName() || '';
            if (isGeneratedOrArchiveFile(fileName)) continue;
            if (normalizeArkMethodName(method.getName()) === methodName) {
                candidates.push(method);
            }
        } catch { /* ignore */ }
    }
    return candidates.length === 1 ? candidates : [];
}

function buildProjectMethodNameIndex(scene: Scene): Map<string, ArkMethod[]> {
    const index = new Map<string, ArkMethod[]>();
    for (const method of scene.getMethods()) {
        try {
            const fileName = method.getDeclaringArkFile()?.getName() || '';
            if (isGeneratedOrArchiveFile(fileName)) continue;
            const name = normalizeArkMethodName(method.getName());
            if (!index.has(name)) {
                index.set(name, []);
            }
            index.get(name)!.push(method);
        } catch { /* ignore */ }
    }
    return index;
}

function buildWrappedAopMethodNameIndex(scene: Scene): Map<string, ArkMethod[]> {
    const index = new Map<string, ArkMethod[]>();
    for (const method of scene.getMethods()) {
        try {
            const clsName = method.getDeclaringArkClass().getName();
            if (!clsName.startsWith('Wrapped') && !clsName.includes('$AOPUtil.wrap')) continue;
            const name = normalizeArkMethodName(method.getName());
            if (!index.has(name)) {
                index.set(name, []);
            }
            index.get(name)!.push(method);
        } catch { /* ignore */ }
    }
    return index;
}

function extractThisFieldCallbackAssignment(stmtText: string): { fieldName: string; callbackName: string } | null {
    const match = stmtText.match(/^this\.<[^>]+:\s*[^>]*\.([A-Za-z_$][\w$]*)>\s*=\s*(%AM\d+(?:\$[A-Za-z0-9_$%]+)?)/);
    if (!match) return null;
    return { fieldName: match[1], callbackName: match[2] };
}

function extractLocalFromThisField(stmtText: string): { localName: string; fieldName: string } | null {
    const match = stmtText.match(/^(\S+)\s*=\s*this\.<[^>]+:\s*([^>]+)>/);
    if (!match) return null;
    const fieldRef = match[2].trim();
    const dotIdx = fieldRef.lastIndexOf('.');
    const fieldName = dotIdx >= 0 ? fieldRef.substring(dotIdx + 1) : fieldRef;
    if (!fieldName) return null;
    return { localName: match[1], fieldName };
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

    const projectMethodsByName = buildProjectMethodNameIndex(scene);
    const wrappedAopMethodsByName = buildWrappedAopMethodNameIndex(scene);

    // ---- Source 3: Standard invoke edges (supplement what CG may have missed) ----
    let invokeEdgeCount = 0;
    let unresolvedInvokeEdgeCount = 0;
    for (const method of scene.getMethods()) {
        let callerSig = method.getSignature().toString();
        ensureKey(callerSig);
        let body = method.getBody();
        if (!body) continue;
        for (let stmt of body.getCfg().getStmts()) {
            if (!stmt.containsInvokeExpr()) continue;

            let invokeExpr = stmt.getInvokeExpr();
            if (!invokeExpr) continue;

            let calleeSig = invokeExpr.getMethodSignature().toString();
            let invokeMethodName = invokeExpr.getMethodSignature().getMethodSubSignature().getMethodName();
            ensureKey(calleeSig);
            if (!reverseMap.get(calleeSig)!.has(callerSig)) {
                reverseMap.get(calleeSig)!.add(callerSig);
                invokeEdgeCount++;
            }

            if (calleeSig.includes('@%unk/%unk')) {
                const uniqueProjectCandidates = projectMethodsByName.get(invokeMethodName) || [];
                const candidates = [
                    ...findMethodsByNameInClass(method, invokeMethodName),
                    ...(wrappedAopMethodsByName.get(invokeMethodName) || []),
                    ...(uniqueProjectCandidates.length === 1 ? uniqueProjectCandidates : []),
                ];
                for (const candidate of candidates) {
                    const candidateSig = candidate.getSignature().toString();
                    if (candidateSig === callerSig) continue;
                    ensureKey(candidateSig);
                    if (!reverseMap.get(candidateSig)!.has(callerSig)) {
                        reverseMap.get(candidateSig)!.add(callerSig);
                        unresolvedInvokeEdgeCount++;
                    }
                }
            }

            // ---- Source 4: FunctionType/ClosureType callback edges (NO regex fallback) ----
            let funcTypeCallbackCount = 0;
            try {
                const callbackMethods = getCallbackMethodsFromInvokeArgs(stmt, scene);
                for (const cbMethod of callbackMethods) {
                    const cbSig = cbMethod.getSignature().toString();
                    if (cbSig !== callerSig && !reverseMap.get(cbSig)!.has(callerSig)) {
                        ensureKey(cbSig);
                        reverseMap.get(cbSig)!.add(callerSig);
                        funcTypeCallbackCount++;
                    }
                }
            } catch { /* ignore */ }

            // ---- Source 5: getCallbackMethodFromStmt (ONLY for whitelisted callback events) ----
            let getCallbackCallbackCount = 0;
            try {
                const invokeMethodName = invokeExpr.getMethodSignature().getMethodSubSignature().getMethodName();
                if (isCallbackEventMethod(invokeMethodName)) {
                    let cbMethods = getCallbackMethodFromStmt(stmt, scene);
                    if (cbMethods && Array.isArray(cbMethods)) {
                        for (let cbMethod of cbMethods) {
                            if (cbMethod) {
                                let cbSig = cbMethod.getSignature().toString();
                                if (cbSig !== callerSig && !reverseMap.get(cbSig)!.has(callerSig)) {
                                    ensureKey(cbSig);
                                    reverseMap.get(cbSig)!.add(callerSig);
                                    getCallbackCallbackCount++;
                                }
                            }
                        }
                    }
                }
            } catch { /* ignore */ }
        }
    }
    console.log(`[CHAIN] Source 3 - Supplemental invoke edges: ${invokeEdgeCount}`);
    console.log(`[CHAIN] Source 4 - Unresolved invoke name edges: ${unresolvedInvokeEdgeCount}`);

    // ---- Source 5: Field callback edges ----
    // Class fields initialized with arrow functions are lowered as
    // this.field = %AMx$%instInit. Later API calls often pass this.field as a
    // callback. Reconnect that callback method to the caller method.
    const fieldCallbacks = new Map<string, Map<string, ArkMethod>>();
    for (const method of scene.getMethods()) {
        if (method.getName() !== '%instInit') continue;
        const body = method.getBody();
        if (!body) continue;

        let classSig = '';
        try {
            classSig = method.getDeclaringArkClass().getSignature().toString();
        } catch { /* ignore */ }
        if (!classSig) continue;

        for (const stmt of body.getCfg().getStmts()) {
            const assignment = extractThisFieldCallbackAssignment(stmt.toString());
            if (!assignment) continue;

            const callbackMethod = findMethodByNameInClass(method, assignment.callbackName);
            if (!callbackMethod) continue;

            if (!fieldCallbacks.has(classSig)) {
                fieldCallbacks.set(classSig, new Map());
            }
            fieldCallbacks.get(classSig)!.set(assignment.fieldName, callbackMethod);
        }
    }

    let fieldCallbackEdgeCount = 0;
    for (const method of scene.getMethods()) {
        let classSig = '';
        try {
            classSig = method.getDeclaringArkClass().getSignature().toString();
        } catch { /* ignore */ }
        const callbacksForClass = fieldCallbacks.get(classSig);
        if (!callbacksForClass || callbacksForClass.size === 0) continue;

        const body = method.getBody();
        if (!body) continue;

        const localToField = new Map<string, string>();
        const callerSig = method.getSignature().toString();
        for (const stmt of body.getCfg().getStmts()) {
            const fieldRead = extractLocalFromThisField(stmt.toString());
            if (fieldRead) {
                localToField.set(fieldRead.localName, fieldRead.fieldName);
            }

            if (!stmt.containsInvokeExpr()) continue;
            const invokeExpr = stmt.getInvokeExpr();
            if (!invokeExpr) continue;

            for (const arg of invokeExpr.getArgs()) {
                const fieldName = localToField.get(arg.toString());
                if (!fieldName) continue;
                const callbackMethod = callbacksForClass.get(fieldName);
                if (!callbackMethod) continue;

                const callbackSig = callbackMethod.getSignature().toString();
                if (callbackSig === callerSig) continue;
                ensureKey(callbackSig);
                if (!reverseMap.get(callbackSig)!.has(callerSig)) {
                    reverseMap.get(callbackSig)!.add(callerSig);
                    fieldCallbackEdgeCount++;
                }
            }
        }
    }
    console.log(`[CHAIN] Source 5 - Field callback edges: ${fieldCallbackEdgeCount}`);

    // ---- Source 6: Anonymous callback parent edges ----
    // ArkAnalyzer encodes callbacks as %AMn$parentMethod. Some callback locals
    // lose FunctionType/ClosureType metadata, so add a conservative structural
    // edge from the callback method back to its same-class parent method.
    let anonymousParentEdgeCount = 0;
    for (const method of scene.getMethods()) {
        const parentName = extractAnonymousParentName(method.getName());
        if (!parentName) continue;

        const parentMethod = findMethodByNameInClass(method, parentName);
        if (!parentMethod) continue;

        const cbSig = method.getSignature().toString();
        const parentSig = parentMethod.getSignature().toString();
        if (cbSig === parentSig) continue;

        ensureKey(cbSig);
        if (!reverseMap.get(cbSig)!.has(parentSig)) {
            reverseMap.get(cbSig)!.add(parentSig);
            anonymousParentEdgeCount++;
        }
    }
    console.log(`[CHAIN] Source 6 - Anonymous parent edges: ${anonymousParentEdgeCount}`);

    // ---- Source 7: ArkUI builder option edges ----
    // ArkUI APIs such as bindPopup({ builder: this.popupBuilder }) are lowered
    // into anonymous object initializers. Reconstruct the implicit edge from
    // popupBuilder() back to the owner method that created the option object.
    let builderOptionEdgeCount = 0;
    for (const method of scene.getMethods()) {
        if (method.getName() !== '%instInit') continue;

        let owner: { className: string; ownerMethodName: string } | null = null;
        let fileName = '';
        try {
            owner = extractAnonymousObjectOwner(method.getDeclaringArkClass().getName());
            fileName = method.getDeclaringArkFile()?.getName() || '';
        } catch { /* ignore */ }
        if (!owner || !fileName) continue;

        const body = method.getBody();
        if (!body) continue;

        const localToMethodRef = new Map<string, string>();
        for (const stmt of body.getCfg().getStmts()) {
            const stmtText = stmt.toString();
            const methodRef = extractThisMethodRefAssignment(stmtText);
            if (methodRef) {
                localToMethodRef.set(methodRef.localName, methodRef.methodName);
                continue;
            }

            const localName = extractBuilderFieldAssignmentLocal(stmtText);
            if (!localName) continue;

            const builderMethodName = localToMethodRef.get(localName);
            if (!builderMethodName) continue;

            const builderMethod = findMethodInFileClass(scene, fileName, owner.className, builderMethodName);
            const ownerMethod = findMethodInFileClass(scene, fileName, owner.className, owner.ownerMethodName);
            if (!builderMethod || !ownerMethod) continue;

            const builderSig = builderMethod.getSignature().toString();
            const ownerSig = ownerMethod.getSignature().toString();
            if (builderSig === ownerSig) continue;

            ensureKey(builderSig);
            if (!reverseMap.get(builderSig)!.has(ownerSig)) {
                reverseMap.get(builderSig)!.add(ownerSig);
                builderOptionEdgeCount++;
            }
        }
    }
    console.log(`[CHAIN] Source 7 - ArkUI builder option edges: ${builderOptionEdgeCount}`);

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
    if (methodName === "%statInit" || methodName === "%instInit") return true;
    if (methodName === "initialRender") return true;
    return false;
}

function getTraceEntryType(methodName: string): "user_interaction" | "component_lifecycle" | "app_lifecycle" | "initialization" | "unknown" {
    if (methodName === "%dflt" || methodName === "[static]%dflt" ||
        methodName === "%statInit" || methodName === "%instInit" ||
        methodName === "initialRender") {
        return "initialization";
    }
    return getEntryType(methodName);
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

/**
 * Compute immediate dominators with the Cooper-Harvey-Kennedy algorithm.
 *
 * DominanceFinder assumes that CFG blocks are already in a suitable order.
 * ArkAnalyzer does not guarantee that ordering, so irreducible or generated
 * ArkUI CFGs can make its fixed-point iteration oscillate. Reverse postorder
 * provides the ordering required for convergence without dropping CFG nodes.
 */
export function computeImmediateDominators(cfg: any, blocks: BasicBlock[]): Map<BasicBlock, BasicBlock> {
    const idoms = new Map<BasicBlock, BasicBlock>();
    const start = cfg.getStartingBlock?.() as BasicBlock | undefined;
    if (!start || blocks.length === 0) return idoms;

    const blockSet = new Set(blocks);
    if (!blockSet.has(start)) return idoms;

    const visited = new Set<BasicBlock>([start]);
    const postorder: BasicBlock[] = [];
    const stack: Array<{ block: BasicBlock; expanded: boolean }> = [
        { block: start, expanded: false }
    ];

    while (stack.length > 0) {
        const item = stack.pop()!;
        if (item.expanded) {
            postorder.push(item.block);
            continue;
        }

        stack.push({ block: item.block, expanded: true });
        const successors = Array.from(item.block.getSuccessors())
            .filter(successor => blockSet.has(successor));
        for (let i = successors.length - 1; i >= 0; i--) {
            const successor = successors[i];
            if (!visited.has(successor)) {
                visited.add(successor);
                stack.push({ block: successor, expanded: false });
            }
        }
    }

    const reversePostorder = postorder.reverse();
    const rpoIndex = new Map<BasicBlock, number>();
    reversePostorder.forEach((block, index) => rpoIndex.set(block, index));
    idoms.set(start, start);

    const intersect = (left: BasicBlock, right: BasicBlock): BasicBlock => {
        let finger1 = left;
        let finger2 = right;
        while (finger1 !== finger2) {
            while (rpoIndex.get(finger1)! > rpoIndex.get(finger2)!) {
                finger1 = idoms.get(finger1)!;
            }
            while (rpoIndex.get(finger2)! > rpoIndex.get(finger1)!) {
                finger2 = idoms.get(finger2)!;
            }
        }
        return finger1;
    };

    let changed = true;
    while (changed) {
        changed = false;
        for (let i = 1; i < reversePostorder.length; i++) {
            const block = reversePostorder[i];
            const definedPredecessors = Array.from(block.getPredecessors())
                .filter(predecessor => idoms.has(predecessor));
            if (definedPredecessors.length === 0) continue;

            let newIdom = definedPredecessors[0];
            for (let j = 1; j < definedPredecessors.length; j++) {
                newIdom = intersect(definedPredecessors[j], newIdom);
            }

            if (idoms.get(block) !== newIdom) {
                idoms.set(block, newIdom);
                changed = true;
            }
        }
    }

    return idoms;
}

function extractControlStructures(method: ArkMethod): ControlStructureInfo[] {
    let results: ControlStructureInfo[] = [];
    let file = extractFilePath(method);
    try {
        let body = method.getBody();
        if (!body) return results;
        let cfg = body.getCfg();
        let blocks = Array.from(cfg.getBlocks());

        // Build block ordering for loop detection via back-edges
        let blockOrder = new Map<BasicBlock, number>();
        let idx = 0;
        for (let block of blocks) {
            blockOrder.set(block, idx++);
        }

        // Build immediate dominators for precise "if dominates API call" analysis.
        let immDominators = new Map<BasicBlock, BasicBlock>();
        try {
            immDominators = computeImmediateDominators(cfg, blocks);
        } catch { /* Malformed CFGs keep conservative non-dominating evidence. */ }

        // Collect all blocks containing invoke statements (API call candidates)
        let invokeBlocks = new Set<BasicBlock>();
        for (let block of blocks) {
            if (blockContainsInvoke(block)) {
                invokeBlocks.add(block);
            }
        }

        // A block dominates an invocation iff it occurs on the invocation's
        // immediate-dominator chain. Compute the union once for the method.
        let invokeDominators = new Set<BasicBlock>();
        for (const invokeBlock of invokeBlocks) {
            let current: BasicBlock | undefined = invokeBlock;
            const visitedDominators = new Set<BasicBlock>();
            while (current && !visitedDominators.has(current)) {
                invokeDominators.add(current);
                visitedDominators.add(current);
                const parent = immDominators.get(current);
                if (!parent || parent === current) break;
                current = parent;
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
                let dominatesInvoke = invokeDominators.has(block);

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

function getCachedControlStructures(
    method: ArkMethod,
    cache: Map<string, ControlStructureInfo[]>
): ControlStructureInfo[] {
    const signature = method.getSignature().toString();
    if (!cache.has(signature)) {
        cache.set(signature, extractControlStructures(method));
    }
    return cache.get(signature)!;
}

function getCachedSourceSnippet(
    method: ArkMethod,
    projectDir: string | undefined,
    cache: Map<string, SourceSnippetInfo | null>
): SourceSnippetInfo | null {
    const signature = method.getSignature().toString();
    if (!cache.has(signature)) {
        cache.set(signature, extractSourceSnippet(method, projectDir));
    }
    return cache.get(signature) ?? null;
}

function buildDeclaringMethodApiChain(
    apiUsageIndex: number,
    apiResult: PrivacyDataApiResult,
    apiMethodSig: string,
    methodMap: Map<string, ArkMethod>,
    controlStructureCache: Map<string, ControlStructureInfo[]>,
    sourceSnippetCache: Map<string, SourceSnippetInfo | null>,
    projectDir?: string
): CallChainResult {
    const method = methodMap.get(apiMethodSig);
    const apiMethodName = extractMethodName(apiMethodSig);
    const displayName = extractDisplayName(apiMethodSig);
    const snippet = method
        ? getCachedSourceSnippet(method, projectDir, sourceSnippetCache)
        : null;

    return {
        apiUsageIndex,
        entryMethod: {
            name: displayName,
            type: getTraceEntryType(apiMethodName),
            file: method ? extractFilePath(method) : apiResult.file,
            line: method ? extractMethodLine(method) : 0
        },
        chain: [{
            caller: displayName,
            callee: `${apiResult.namespace}.${apiResult.method}`,
            callType: "direct"
        }],
        controlStructures: method
            ? getCachedControlStructures(method, controlStructureCache)
            : [],
        sourceSnippets: snippet ? [snippet] : []
    };
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
    const controlStructureCache = new Map<string, ControlStructureInfo[]>();
    const sourceSnippetCache = new Map<string, SourceSnippetInfo | null>();

    let callChainResults: CallChainResult[] = [];

    for (let i = 0; i < apiResults.length; i++) {
        let apiResult = apiResults[i];
        let apiMethodSig = apiResult.declaringMethod;
        if (!apiMethodSig) continue;

        // Quick check: if the declaring method itself is an entry point
        let apiMethodName = extractMethodName(apiMethodSig);
        if (isEntryMethod(apiMethodName)) {
            // API is directly in an entry method — create a self-contained chain
            callChainResults.push(buildDeclaringMethodApiChain(
                i,
                apiResult,
                apiMethodSig,
                methodMap,
                controlStructureCache,
                sourceSnippetCache,
                projectDir
            ));
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
                    controlStructures = controlStructures.concat(
                        getCachedControlStructures(method, controlStructureCache)
                    );
                }
            }

            // Collect source snippets for all methods in the chain
            for (let sigStr of path) {
                let method = methodMap.get(sigStr);
                if (method) {
                    let snippet = getCachedSourceSnippet(method, projectDir, sourceSnippetCache);
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
            // No framework/user-interaction entry found. Keep the chain precise by
            // reporting the declaring method as the local entry instead of inventing
            // an upstream caller.
            callChainResults.push(buildDeclaringMethodApiChain(
                i,
                apiResult,
                apiMethodSig,
                methodMap,
                controlStructureCache,
                sourceSnippetCache,
                projectDir
            ));
        }
    }

    let chainsWithPath = callChainResults.filter(c => c.chain.length > 0).length;
    console.log(`[CHAIN] Built ${callChainResults.length} call chains (${chainsWithPath} with paths, ${callChainResults.length - chainsWithPath} without).`);
    return callChainResults;
}
