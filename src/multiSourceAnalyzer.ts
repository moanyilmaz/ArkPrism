/**
 * ArkPrism - Layer 5: Multi-Source Collaborative Profiling Detector (v3)
 * Identifies combinations of non-permission APIs used for user profiling.
 *
 * Builds complete multi-source subgraphs:
 *   entry → LCA → source₁ → sink₁
 *                → source₂ → sink₂
 *                → ...
 *
 * Detection strategies:
 *   1. Same-method: multiple profiling categories in one method
 *   2. Cross-method via LCA: different methods sharing a common caller
 *   3. Per-file aggregation: same file uses APIs from multiple categories
 *   4. Application-level aggregation
 *
 * Uses ArkAnalyzer's CallGraph edges + CHA for accurate path finding.
 */

import { Scene, CallGraph, CallGraphNode, ClassHierarchyAnalysis, getCallbackMethodFromStmt } from './arkanalyzer';
import {
    PrivacyDataApiResult, MultiSourceCollaboration, CallChainLink,
    DataSinkInfo, CallChainResult, MultiSourceSubgraph, MultiSourceBranch
} from './prototypes';
import { ENTRY_METHOD_NAMES, getEntryType } from './callGraphBuilder';

// ---- Reverse + Forward Call Map Construction ----

/**
 * Build both reverse and forward call maps from the Scene and CallGraph.
 * These maps are used for BFS path finding in both directions.
 */
function buildCallMaps(scene: Scene, callGraph: CallGraph): {
    reverseMap: Map<string, Set<string>>;  // callee → callers
    forwardMap: Map<string, Set<string>>;  // caller → callees
} {
    let reverseMap = new Map<string, Set<string>>();
    let forwardMap = new Map<string, Set<string>>();

    function ensureKey(key: string) {
        if (!reverseMap.has(key)) reverseMap.set(key, new Set());
        if (!forwardMap.has(key)) forwardMap.set(key, new Set());
    }

    // Source 1: Built-in CG edges
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
                            forwardMap.get(callerSig)!.add(calleeSig);
                        }
                    }
                }
            }
        }
    } catch { /* CG traversal may fail */ }

    // Source 2: CHA virtual call resolution
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
                                    reverseMap.get(rSigStr)!.add(callerSig);
                                    forwardMap.get(callerSig)!.add(rSigStr);
                                }
                            }
                        } catch { /* ignore */ }
                    }
                }
            }
        }
    } catch { /* CHA may fail */ }

    // Source 3: Standard invoke + callback edges
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
                        forwardMap.get(callerSig)!.add(calleeSig);
                    }
                }
            }

            // Callback %AM edges
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
                                        forwardMap.get(callerSig)!.add(callbackSig);
                                    }
                                }
                            }
                        }
                    }
                }
            }

            // getCallbackMethodFromStmt
            try {
                let cbMethods = getCallbackMethodFromStmt(stmt, scene);
                if (cbMethods && Array.isArray(cbMethods)) {
                    for (let cbMethod of cbMethods) {
                        if (cbMethod) {
                            let cbSig = cbMethod.getSignature().toString();
                            if (cbSig !== callerSig) {
                                ensureKey(cbSig);
                                reverseMap.get(cbSig)!.add(callerSig);
                                forwardMap.get(callerSig)!.add(cbSig);
                            }
                        }
                    }
                }
            } catch { /* ignore */ }
        }
    }

    return { reverseMap, forwardMap };
}

// ---- Path Finding ----

/**
 * BFS upward from a method to find an entry method. Returns the path as CallChainLinks.
 */
function findPathToEntry(
    startSig: string,
    reverseMap: Map<string, Set<string>>,
    maxDepth: number = 15
): { path: CallChainLink[]; entrySig: string; entryName: string } | null {
    let queue: { sig: string; path: CallChainLink[] }[] = [{ sig: startSig, path: [] }];
    let visited = new Set<string>([startSig]);

    while (queue.length > 0) {
        let nextQueue: { sig: string; path: CallChainLink[] }[] = [];
        for (let { sig, path } of queue) {
            if (path.length >= maxDepth) continue;
            // Check if current method is an entry
            let methodName = extractMethodName(sig);
            if (path.length > 0 && isEntryMethod(methodName)) {
                return { path: path.reverse(), entrySig: sig, entryName: methodName };
            }

            let callers = reverseMap.get(sig);
            if (callers) {
                for (let caller of callers) {
                    if (visited.has(caller)) continue;
                    visited.add(caller);
                    let link: CallChainLink = {
                        caller: extractDisplayName(caller),
                        callee: extractDisplayName(sig),
                        callType: determineCallType(extractMethodName(caller), extractMethodName(sig))
                    };
                    nextQueue.push({ sig: caller, path: [...path, link] });
                }
            }
        }
        queue = nextQueue;
    }
    return null;
}

/**
 * BFS downward from LCA to a target method. Returns the path as CallChainLinks.
 */
function findPathDown(
    lcaSig: string,
    targetSig: string,
    forwardMap: Map<string, Set<string>>,
    maxDepth: number = 10
): CallChainLink[] {
    if (lcaSig === targetSig) return [];

    let queue: { sig: string; path: CallChainLink[] }[] = [{ sig: lcaSig, path: [] }];
    let visited = new Set<string>([lcaSig]);

    while (queue.length > 0) {
        let nextQueue: { sig: string; path: CallChainLink[] }[] = [];
        for (let { sig, path } of queue) {
            if (path.length >= maxDepth) continue;
            let callees = forwardMap.get(sig);
            if (callees) {
                for (let callee of callees) {
                    if (visited.has(callee)) continue;
                    visited.add(callee);
                    let link: CallChainLink = {
                        caller: extractDisplayName(sig),
                        callee: extractDisplayName(callee),
                        callType: determineCallType(extractMethodName(sig), extractMethodName(callee))
                    };
                    let newPath = [...path, link];
                    if (callee === targetSig) return newPath;
                    nextQueue.push({ sig: callee, path: newPath });
                }
            }
        }
        queue = nextQueue;
    }
    return []; // Not reachable
}

/**
 * Find LCA of multiple method signatures.
 * Extended: finds LCA for 2+ methods by accumulating ancestor sets.
 */
function findMultiLCA(
    methodSigs: string[],
    reverseMap: Map<string, Set<string>>,
    maxDepth: number = 10
): string | null {
    if (methodSigs.length === 0) return null;
    if (methodSigs.length === 1) return methodSigs[0];

    // Build ancestors for first method
    let commonAncestors = buildAncestorSet(methodSigs[0], reverseMap, maxDepth);
    commonAncestors.add(methodSigs[0]);

    // Intersect with ancestors of each subsequent method
    for (let i = 1; i < methodSigs.length; i++) {
        let ancestorsI = buildAncestorSet(methodSigs[i], reverseMap, maxDepth);
        ancestorsI.add(methodSigs[i]);
        // Keep only common ancestors
        let intersection = new Set<string>();
        for (let a of commonAncestors) {
            if (ancestorsI.has(a)) intersection.add(a);
        }
        commonAncestors = intersection;
        if (commonAncestors.size === 0) return null;
    }

    // Find the closest LCA: BFS from methodSigs[1], first hit in commonAncestors
    let queue = [methodSigs[1]];
    let visited = new Set<string>([methodSigs[1]]);
    if (commonAncestors.has(methodSigs[1])) return methodSigs[1];

    let depth = 0;
    while (queue.length > 0 && depth < maxDepth) {
        let nextQueue: string[] = [];
        for (let current of queue) {
            let callers = reverseMap.get(current);
            if (callers) {
                for (let caller of callers) {
                    if (commonAncestors.has(caller)) return caller;
                    if (!visited.has(caller)) {
                        visited.add(caller);
                        nextQueue.push(caller);
                    }
                }
            }
        }
        queue = nextQueue;
        depth++;
    }
    return null;
}

function buildAncestorSet(sig: string, reverseMap: Map<string, Set<string>>, maxDepth: number): Set<string> {
    let ancestors = new Set<string>();
    let queue = [sig];
    let depth = 0;
    while (queue.length > 0 && depth < maxDepth) {
        let nextQueue: string[] = [];
        for (let current of queue) {
            let callers = reverseMap.get(current);
            if (callers) {
                for (let caller of callers) {
                    if (!ancestors.has(caller)) {
                        ancestors.add(caller);
                        nextQueue.push(caller);
                    }
                }
            }
        }
        queue = nextQueue;
        depth++;
    }
    return ancestors;
}

// ---- Helpers ----

function extractMethodName(sig: string): string {
    let colonIdx = sig.lastIndexOf(": ");
    let rest = colonIdx >= 0 ? sig.substring(colonIdx + 2) : sig;
    let parenIdx = rest.indexOf("(");
    let name = parenIdx >= 0 ? rest.substring(0, parenIdx) : rest;
    // Extract just the method name (after last dot for Class.method)
    let dotIdx = name.lastIndexOf(".");
    return dotIdx >= 0 ? name.substring(dotIdx + 1) : name;
}

function extractDisplayName(sig: string): string {
    let colonIdx = sig.lastIndexOf(": ");
    let rest = colonIdx >= 0 ? sig.substring(colonIdx + 2) : sig;
    let parenIdx = rest.indexOf("(");
    return parenIdx >= 0 ? rest.substring(0, parenIdx) : rest;
}

function extractFilePath(sig: string): string {
    let colonIdx = sig.indexOf(": ");
    let prefix = colonIdx >= 0 ? sig.substring(0, colonIdx) : sig;
    let slashIdx = prefix.indexOf("/");
    return slashIdx >= 0 ? prefix.substring(slashIdx + 1) : prefix;
}

function isEntryMethod(methodName: string): boolean {
    if (ENTRY_METHOD_NAMES.includes(methodName)) return true;
    if (methodName === "%dflt" || methodName === "[static]%dflt") return true;
    if (methodName === "initialRender") return true;
    return false;
}

function determineCallType(callerName: string, calleeName: string): CallChainLink['callType'] {
    if (calleeName.includes("%AM")) return "callback";
    if (["aboutToAppear", "build", "onCreate", "onForeground"].includes(calleeName)) return "lifecycle_implicit";
    return "direct";
}

function assessRisk(categoryCount: number): "low" | "medium" | "high" {
    if (categoryCount >= 4) return "high";
    if (categoryCount >= 3) return "medium";
    return "low";
}

function groupApisByProfilingCategory(
    apiResults: PrivacyDataApiResult[]
): Map<string, PrivacyDataApiResult[]> {
    let groups = new Map<string, PrivacyDataApiResult[]>();
    for (let result of apiResults) {
        if (result.profilingCategory) {
            if (!groups.has(result.profilingCategory)) {
                groups.set(result.profilingCategory, []);
            }
            groups.get(result.profilingCategory)!.push(result);
        }
    }
    return groups;
}

// ---- Subgraph Construction ----

/**
 * Build a complete subgraph for a multi-source collaboration.
 */
function buildSubgraph(
    lcaSig: string,
    sourceApis: { api: PrivacyDataApiResult; declaringMethod: string }[],
    reverseMap: Map<string, Set<string>>,
    forwardMap: Map<string, Set<string>>,
    callChainResults: CallChainResult[],
    apiResults: PrivacyDataApiResult[]
): MultiSourceSubgraph | undefined {
    // 1. Find entry → LCA path
    let entryResult = findPathToEntry(lcaSig, reverseMap);
    let entryToLca: CallChainLink[] = [];
    let entry = { name: extractDisplayName(lcaSig), type: 'unknown', file: extractFilePath(lcaSig) };

    if (entryResult) {
        entryToLca = entryResult.path;
        entry = {
            name: entryResult.entryName,
            type: getEntryType(entryResult.entryName),
            file: extractFilePath(entryResult.entrySig)
        };
    }

    // 2. For each source API, find LCA → source path + attach sinks
    let branches: MultiSourceBranch[] = [];
    for (let { api, declaringMethod } of sourceApis) {
        let lcaToSource = findPathDown(lcaSig, declaringMethod, forwardMap);

        // Find sinks from existing call chain results
        let sinks: DataSinkInfo[] = [];
        let apiIndex = apiResults.indexOf(api);
        if (apiIndex >= 0) {
            let matchingChain = callChainResults.find(c => c.apiUsageIndex === apiIndex);
            if (matchingChain && matchingChain.dataSinks) {
                sinks = matchingChain.dataSinks;
            }
        }

        branches.push({
            api: `${api.namespace}.${api.method}`,
            category: api.profilingCategory!,
            declaringMethod: declaringMethod,
            lcaToSource,
            sinks
        });
    }

    return {
        entryToLca,
        entry,
        lcaMethodSig: lcaSig,
        branches
    };
}

// ---- Main Detection ----

/**
 * Detect multi-source collaborative profiling behaviors.
 * Enhanced: builds complete subgraphs with entry → LCA → sources → sinks paths.
 */
export function detectMultiSourceCollaborations(
    apiResults: PrivacyDataApiResult[],
    scene: Scene,
    cg: CallGraph,
    callChainResults: CallChainResult[] = []
): MultiSourceCollaboration[] {
    console.log("[MULTI-SOURCE] Detecting multi-source collaborative profiling...");

    let categoryGroups = groupApisByProfilingCategory(apiResults);
    let categories = Array.from(categoryGroups.keys());

    if (categories.length < 2) {
        console.log("[MULTI-SOURCE] Less than 2 profiling categories found, no collaboration possible.");
        return [];
    }

    console.log(`[MULTI-SOURCE] Found ${categories.length} profiling categories: ${categories.join(", ")}`);

    let { reverseMap, forwardMap } = buildCallMaps(scene, cg);
    let collaborations: MultiSourceCollaboration[] = [];

    // Strategy 1: Same-method collaborations
    let methodToApis = new Map<string, PrivacyDataApiResult[]>();
    for (let result of apiResults) {
        if (result.profilingCategory && result.declaringMethod) {
            if (!methodToApis.has(result.declaringMethod)) {
                methodToApis.set(result.declaringMethod, []);
            }
            methodToApis.get(result.declaringMethod)!.push(result);
        }
    }

    for (let [methodSig, apis] of methodToApis) {
        let uniqueCategories = [...new Set(apis.map(a => a.profilingCategory!))];
        if (uniqueCategories.length >= 2) {
            // Same-method: LCA IS the method itself
            let sourceApis = apis.map(a => ({ api: a, declaringMethod: methodSig }));
            let subgraph = buildSubgraph(methodSig, sourceApis, reverseMap, forwardMap, callChainResults, apiResults);

            collaborations.push({
                lcaMethod: extractDisplayName(methodSig),
                lcaMethodSig: methodSig,
                entryMethod: subgraph?.entry.name || extractDisplayName(methodSig),
                categories: uniqueCategories,
                apis: apis.map(a => ({
                    api: `${a.namespace}.${a.method}`,
                    category: a.profilingCategory!
                })),
                riskLevel: assessRisk(uniqueCategories.length),
                reason: `Same-method: ${uniqueCategories.length} profiling categories (${uniqueCategories.join(", ")})`,
                subgraph
            });
        }
    }

    // Strategy 2: Cross-method collaborations via LCA
    let allProfilingApis = apiResults.filter(a => a.profilingCategory && a.declaringMethod);
    let processedPairs = new Set<string>();

    for (let i = 0; i < allProfilingApis.length; i++) {
        for (let j = i + 1; j < allProfilingApis.length; j++) {
            let a = allProfilingApis[i];
            let b = allProfilingApis[j];
            if (a.profilingCategory === b.profilingCategory) continue;
            if (a.declaringMethod === b.declaringMethod) continue;

            let pairKey = [a.declaringMethod, b.declaringMethod].sort().join("||");
            if (processedPairs.has(pairKey)) continue;
            processedPairs.add(pairKey);

            let lcaSig = findMultiLCA([a.declaringMethod!, b.declaringMethod!], reverseMap);
            if (lcaSig) {
                let lcaDisplay = extractDisplayName(lcaSig);
                let existing = collaborations.find(c => c.lcaMethodSig === lcaSig);
                if (existing) {
                    // Merge into existing collaboration
                    for (let api of [a, b]) {
                        let apiStr = `${api.namespace}.${api.method}`;
                        if (!existing.apis.some(x => x.api === apiStr)) {
                            existing.apis.push({ api: apiStr, category: api.profilingCategory! });
                        }
                        if (!existing.categories.includes(api.profilingCategory!)) {
                            existing.categories.push(api.profilingCategory!);
                        }
                    }
                    existing.riskLevel = assessRisk(existing.categories.length);
                    existing.reason = `Cross-method LCA: ${existing.categories.length} categories (${existing.categories.join(", ")})`;
                    // Rebuild subgraph with all apis
                    let allSourceApis = existing.apis.map(x => {
                        let matchApi = allProfilingApis.find(pa =>
                            `${pa.namespace}.${pa.method}` === x.api && pa.profilingCategory === x.category
                        );
                        return matchApi ? { api: matchApi, declaringMethod: matchApi.declaringMethod! } : null;
                    }).filter((x): x is { api: PrivacyDataApiResult; declaringMethod: string } => x !== null);
                    existing.subgraph = buildSubgraph(lcaSig, allSourceApis, reverseMap, forwardMap, callChainResults, apiResults);
                } else {
                    let sourceApis = [
                        { api: a, declaringMethod: a.declaringMethod! },
                        { api: b, declaringMethod: b.declaringMethod! }
                    ];
                    let subgraph = buildSubgraph(lcaSig, sourceApis, reverseMap, forwardMap, callChainResults, apiResults);

                    collaborations.push({
                        lcaMethod: lcaDisplay,
                        lcaMethodSig: lcaSig,
                        entryMethod: subgraph?.entry.name || lcaDisplay,
                        categories: [a.profilingCategory!, b.profilingCategory!],
                        apis: [
                            { api: `${a.namespace}.${a.method}`, category: a.profilingCategory! },
                            { api: `${b.namespace}.${b.method}`, category: b.profilingCategory! }
                        ],
                        riskLevel: assessRisk(2),
                        reason: `Cross-method LCA: (${a.profilingCategory}, ${b.profilingCategory})`,
                        subgraph
                    });
                }
            }
        }
    }

    // Strategy 3: Per-file profiling aggregation
    let fileToApis = new Map<string, PrivacyDataApiResult[]>();
    for (let result of apiResults) {
        if (result.profilingCategory && result.file) {
            if (!fileToApis.has(result.file)) {
                fileToApis.set(result.file, []);
            }
            fileToApis.get(result.file)!.push(result);
        }
    }

    for (let [file, apis] of fileToApis) {
        let uniqueCategories = [...new Set(apis.map(a => a.profilingCategory!))];
        if (uniqueCategories.length >= 2) {
            let alreadyFound = collaborations.some(c =>
                c.reason.includes("Same-method") &&
                c.categories.sort().join(",") === uniqueCategories.sort().join(",")
            );
            if (!alreadyFound) {
                // Try to find LCA for all APIs in this file
                let methodSigs = [...new Set(apis.filter(a => a.declaringMethod).map(a => a.declaringMethod!))];
                let lcaSig = methodSigs.length > 1 ? findMultiLCA(methodSigs, reverseMap) : methodSigs[0];

                let sourceApis = apis.filter(a => a.declaringMethod).map(a => ({
                    api: a, declaringMethod: a.declaringMethod!
                }));
                let subgraph = lcaSig
                    ? buildSubgraph(lcaSig, sourceApis, reverseMap, forwardMap, callChainResults, apiResults)
                    : undefined;

                collaborations.push({
                    lcaMethod: lcaSig ? extractDisplayName(lcaSig) : `[file] ${file}`,
                    lcaMethodSig: lcaSig || '',
                    entryMethod: subgraph?.entry.name || `[file] ${file}`,
                    categories: uniqueCategories,
                    apis: apis.map(a => ({
                        api: `${a.namespace}.${a.method}`,
                        category: a.profilingCategory!
                    })),
                    riskLevel: assessRisk(uniqueCategories.length),
                    reason: `Same-file: ${uniqueCategories.length} profiling categories in ${file}`,
                    subgraph
                });
            }
        }
    }

    // Strategy 4: Application-level profiling aggregation
    let appCategories = new Set<string>();
    let appCategoryApis = new Map<string, { api: string; category: string; file: string }[]>();
    for (let api of allProfilingApis) {
        appCategories.add(api.profilingCategory!);
        if (!appCategoryApis.has(api.profilingCategory!)) {
            appCategoryApis.set(api.profilingCategory!, []);
        }
        appCategoryApis.get(api.profilingCategory!)!.push({
            api: `${api.namespace}.${api.method}`,
            category: api.profilingCategory!,
            file: api.file
        });
    }

    if (appCategories.size >= 2) {
        let uniqueCats = [...appCategories];
        let allApis: { api: string; category: string }[] = [];
        let filesInvolved = new Set<string>();

        for (let [, apis] of appCategoryApis) {
            for (let a of apis) {
                allApis.push({ api: a.api, category: a.category });
                filesInvolved.add(a.file);
            }
        }

        let deduped = allApis.filter((v, i, a) =>
            a.findIndex(t => t.api === v.api && t.category === v.category) === i
        );

        collaborations.push({
            lcaMethod: `[application-level]`,
            lcaMethodSig: '',
            entryMethod: `[application-level]`,
            categories: uniqueCats,
            apis: deduped,
            riskLevel: assessRisk(uniqueCats.length),
            reason: `Application-level: ${uniqueCats.length} profiling categories across ${filesInvolved.size} files (${uniqueCats.join(", ")})`
            // No subgraph for application-level (too broad)
        });
    }

    console.log(`[MULTI-SOURCE] Detected ${collaborations.length} collaborative profiling behaviors.`);
    let withSubgraph = collaborations.filter(c => c.subgraph).length;
    console.log(`[MULTI-SOURCE] ${withSubgraph} collaborations have complete subgraphs.`);

    return collaborations;
}
