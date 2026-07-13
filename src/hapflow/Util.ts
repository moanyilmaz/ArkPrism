import { ArkAssignStmt, ArkInvokeStmt, Stmt } from "../arkanalyzer";
import { ArrayType, ClassType, FunctionType, LexicalEnvType } from "../arkanalyzer";
import { Value } from "../arkanalyzer";
import { ArkClass } from "../arkanalyzer";
import { ArkMethod } from "../arkanalyzer";
import { ArkNamespace } from "../arkanalyzer";
import { Scene } from "../arkanalyzer";
import { TaintFact } from "./TaintFact";
import { Local } from "../arkanalyzer";
import { AbstractRef, ArkArrayRef, ArkInstanceFieldRef, ArkStaticFieldRef, ClosureFieldRef, GlobalRef } from "../arkanalyzer";
import { Cfg } from "../arkanalyzer";
import { PointerAnalysis } from "../arkanalyzer";
import { ClassHierarchyAnalysis } from "../arkanalyzer";
import { Constant } from "../arkanalyzer";
import { MultiRef } from "./MuiltiRef";
import { MethodSignature } from "../arkanalyzer";
import { AbstractInvokeExpr, ArkInstanceInvokeExpr, ArkThisRef } from "../arkanalyzer";
import { Source } from "./Source";

// @ts-ignore - ClassCategory may not be in barrel export
import { ClassCategory } from "../arkanalyzer/core/model/ArkClass";

// Cached method name to sources mapping for faster lookup
// Keyed by sources Map to avoid cross-contamination between analysis runs
const methodNameCacheMap = new WeakMap<Map<string, Source>, Map<string, Source[]>>();

/**
 * Build a reverse index from method name to sources for faster lookup.
 * This avoids scanning all sources for fuzzy matching.
 */
function buildMethodNameToSourcesCache(sources: Map<string, Source>): Map<string, Source[]> {
    const cache = new Map<string, Source[]>();
    for (const source of sources.values()) {
        const methodName = source.methodSignature.getMethodSubSignature().getMethodName();
        if (!cache.has(methodName)) {
            cache.set(methodName, []);
        }
        cache.get(methodName)!.push(source);
    }
    return cache;
}

/**
 * Get the method name to sources cache for the given sources Map.
 * Creates and caches the index lazily.
 */
function getMethodNameToSourcesCache(sources: Map<string, Source>): Map<string, Source[]> {
    if (!methodNameCacheMap.has(sources)) {
        methodNameCacheMap.set(sources, buildMethodNameToSourcesCache(sources));
    }
    return methodNameCacheMap.get(sources)!;
}

export const INTERNAL_PARAMETER_SOURCE: string[] = [
    '@ohos.app.ability.Want.d.ts: Want'
]

export const INTERNAL_SINK_METHOD_toString: string[] = [
    "@ohosSdk/api/@internal/full/global.d.ts: console.[static]log(string, any[])",
    "@ohosSdk/api/@internal/full/global.d.ts: console.[static]error(string, any[])",
    "@ohosSdk/api/@internal/full/global.d.ts: console.[static]info(string, any[])",
    "@ohosSdk/api/@internal/full/global.d.ts: console.[static]warn(string, any[])",
    "@ohosSdk/api/@internal/full/global.d.ts: console.[static]assert(string, any[])",
]

// Promise sink method names - Promise resolve/reject are data leakage endpoints
// Data passed to resolve() is returned from the Promise, potentially sent to external systems
// Data passed to reject() may also leak error information
export const RESOLVE_SINK_METHODS = ["resolve", "reject"];

// Log sink method names that should always be considered sinks
// Only console.* methods are considered sinks, NOT custom Logger classes
// Custom Logger.info() etc. are NOT sinks unless they output to network/file
export const LOG_SINK_METHODS: string[] = [
    'printLog'
]

const filenamePrefix = 'api/';
const paramCallbackString = 'AsyncCallback';

export function Json2ArkMethod(str: string, scene: Scene): MethodSignature | null {
    const mes = str.split(': ');
    const fileName = filenamePrefix + mes[0];
    const otherMes = mes.slice(1).join(': ').split('.');
    otherMes[2] = otherMes.slice(2).join('.');
    if (otherMes.length < 3) {
        return null;
    }
    const namespaceName = otherMes[0], className = otherMes[1], methodName = otherMes[2].split('(')[0];
    let paramInfos: string[] = [];
    if (otherMes[2]) {
        if (!otherMes[2].match(/\((.*?)\)/)) {
            return null;
        }
        paramInfos = otherMes[2].match(/\((.*?)\)/)![1].split(',').map((item: string) => item.replace(/\s/g, '')).filter((item: string) => item !== '');
    }

    const file = scene.getSdkArkFiles().filter(f => f.getName() == fileName)[0];
    if (!file) {
        return null;
    }
    let arkClass: ArkClass | null = null;
    if (namespaceName == "_") {
        if (className == '_') {
            arkClass = file.getDefaultClass();
        } else {
            for (const clas of file.getClasses()) {
                if (clas.getName() == className) {
                    arkClass = clas;
                    break;
                }
            }
        }
    } else {
        let arkNamespace: ArkNamespace | null = null;
        for (const ns of file.getNamespaces()) {
            if (ns.getName() == namespaceName) {
                arkNamespace = ns;
                break;
            }
        }
        if (arkNamespace) {
            if (className == '_') {
                arkClass = arkNamespace.getDefaultClass()
            } else {
                for (const clas of arkNamespace.getClasses()) {
                    if (clas.getName() == className) {
                        arkClass = clas;
                        break;
                    }
                }
            }
        } else {
            return null;
        }
    }
    if (!arkClass) {
        return null;
    } else {
        let arkMethod: ArkMethod | null = null;
        for (const method of arkClass.getMethods()) {
            if (method.getName() == methodName) {
                arkMethod = method;
                break;
            }
        }
        if (!arkMethod) {
            return null;
        }
        const declareSignatures = arkMethod.getDeclareSignatures();
        if (declareSignatures) {
            for (const methodSignature of declareSignatures) {
                if (paramEqual(methodSignature, paramInfos)) {
                    return methodSignature;
                }
            }
        } else if (arkMethod && arkMethod.getParameters().length == paramInfos.length) {
            if (paramEqual(arkMethod.getSignature(), paramInfos)) {
                return arkMethod.getSignature();
            }
        } else {
            return null;
        }
    }
    return null;
}

export function Json2ArkMethod_LLM(module: string, name: string, scene: Scene): MethodSignature[] {
    const methodSignatures: MethodSignature[] = [];
    const parts = module.split('api.');
    if (parts.length < 2) {
        return methodSignatures;
    }
    let fileName = filenamePrefix + parts[1] + '.d.ts';
    const file = scene.getSdkArkFiles().filter(f => f.getName() == fileName)[0];
    if (!file) {
        return methodSignatures;
    }
    for (const cls of file.getClasses()) {
        let mtd = cls.getMethodWithName(name);
        if (!mtd) {
            mtd = cls.getStaticMethodWithName(name);
            if (!mtd) {
                continue;
            }
        }
        const ms = mtd.getDeclareSignatures();
        if (ms) {
            return ms;
        }
        return [mtd.getSignature()];
    }
    for (const ns of file.getNamespaces()) {
        for (const cls of ns.getClasses()) {
            let mtd = cls.getMethodWithName(name);
            if (!mtd) {
                mtd = cls.getStaticMethodWithName(name);
                if (!mtd) {
                    continue;
                }
            }
            const ms = mtd.getDeclareSignatures();
            if (ms) {
                return ms;
            }
            return [mtd.getSignature()];
        }
    }
    return methodSignatures;
}

export function Json2ArkMethodSignature(module: string, namespace: string, className: string, name: string, scene: Scene, parameters?: { name: string, type: string }[]): MethodSignature[] {
    const methodSignatures: MethodSignature[] = [];

    // Handle full method names like "console.log" - extract just the method name
    let methodName = name;
    if (className && name.includes('.')) {
        const parts = name.split('.');
        methodName = parts[parts.length - 1];
    }

    // Map @kit.BasicServicesKit to @ohos.* based on namespace
    let sdkModule = module;
    if (module === '@kit.BasicServicesKit') {
        // Map namespace to @ohos file
        const namespaceMap: { [key: string]: string } = {
            'osAccount': '@ohos.account.osAccount',
            'appAccount': '@ohos.account.appAccount',
            'distributedAccount': '@ohos.account.distributedAccount',
            'deviceinfo': '@ohos.deviceInfo',
            'SystemPasteboard': '@ohos.pasteboard',
            'wallpaper': '@ohos.wallpaper',
            'geoLocationManager': '@ohos.geoLocationManager',
            'sim': '@ohos.telephony.sim',
            'bluetooth': '@ohos.bluetooth',
            'sensor': '@ohos.sensor',
        };
        if (namespaceMap[namespace]) {
            sdkModule = namespaceMap[namespace];
        }
    }

    const fileName = filenamePrefix + sdkModule + '.d.ts';
    const file = scene.getSdkArkFiles().filter(f => f.getName() == fileName)[0];
    if (!file) {
        return methodSignatures;
    }

    const expectedParamNames: string[] = (parameters && parameters.length > 0)
        ? parameters.map(p => p.name)
        : [];

    const namesMatch = (sig: MethodSignature, names: string[]): boolean => {
        // If no parameter names to match, accept any signature
        if (!names || names.length === 0) return true;
        if (sig.getParamLength() !== names.length) return false;
        for (let i = 0; i < names.length; i++) {
            const param = sig.getMethodSubSignature().getParameters()[i];
            if (param.getName() !== names[i]) return false;
        }
        return true;
    };

    const collectFromMethod = (mtd: ArkMethod | null): MethodSignature[] => {
        if (!mtd) return [];
        const ms = mtd.getDeclareSignatures();
        if (ms && ms.length > 0) {
            const matched: MethodSignature[] = [];
            for (const sig of ms) {
                if (namesMatch(sig, expectedParamNames)) {
                    matched.push(sig);
                }
            }
            return matched;
        }
        if (expectedParamNames.length === 0 || namesMatch(mtd.getSignature(), expectedParamNames)) {
            return [mtd.getSignature()];
        }
        return [];
    };

    if (namespace) {
        const ns = file.getNamespaces().find(n => n.getName() == namespace);
        if (ns) {
            if (className) {
                const cls = ns.getClasses().find(c => c.getName() == className);
                if (cls) {
                    let mtd = cls.getMethodWithName(methodName);
                    if (!mtd) mtd = cls.getStaticMethodWithName(methodName);
                    const ms = collectFromMethod(mtd);
                    if (ms.length > 0) return ms;
                }
            } else {
                const defCls = ns.getDefaultClass();
                if (defCls) {
                    let mtd = defCls.getMethodWithName(methodName);
                    if (!mtd) mtd = defCls.getStaticMethodWithName(methodName);
                    const ms = collectFromMethod(mtd);
                    if (ms.length > 0) return ms;
                }
                for (const cls of ns.getClasses()) {
                    let mtd = cls.getMethodWithName(methodName);
                    if (!mtd) mtd = cls.getStaticMethodWithName(methodName);
                    const ms = collectFromMethod(mtd);
                    if (ms.length > 0) return ms;
                }
            }
        }
    } else if (className) {
        // No namespace, but has className - search for the class directly in file's top-level classes
        // This handles cases like console.log where console is a top-level class
        for (const cls of file.getClasses()) {
            if (cls.getName() == className) {
                let mtd = cls.getMethodWithName(methodName);
                if (!mtd) mtd = cls.getStaticMethodWithName(methodName);
                const ms = collectFromMethod(mtd);
                if (ms.length > 0) return ms;
            }
        }
    }

    const defFileCls = file.getDefaultClass();
    if (defFileCls) {
        let mtd = defFileCls.getMethodWithName(methodName);
        if (!mtd) mtd = defFileCls.getStaticMethodWithName(methodName);
        const ms = collectFromMethod(mtd);
        if (ms.length > 0) return ms;
    }

    for (const cls of file.getClasses()) {
        let mtd = cls.getMethodWithName(methodName);
        if (!mtd) mtd = cls.getStaticMethodWithName(methodName);
        const ms = collectFromMethod(mtd);
        if (ms.length > 0) return ms;
    }

    for (const ns of file.getNamespaces()) {
        const defCls = ns.getDefaultClass();
        if (defCls) {
            let mtd = defCls.getMethodWithName(methodName);
            if (!mtd) mtd = defCls.getStaticMethodWithName(methodName);
            const ms = collectFromMethod(mtd);
            if (ms.length > 0) return ms;
        }
        for (const cls of ns.getClasses()) {
            let mtd = cls.getMethodWithName(methodName);
            if (!mtd) mtd = cls.getStaticMethodWithName(methodName);
            const ms = collectFromMethod(mtd);
            if (ms.length > 0) return ms;
        }
    }

    return methodSignatures;
}

function canBeSplitAndContained(a: string, b: string): boolean {
    const aParts = a.split('|');
    const bParts = b.split('|');
    if (aParts.length !== bParts.length) {
        return false;
    }
    for (let i = 0; i < aParts.length; i++) {
        if (!bParts[i].includes(aParts[i])) {
            return false;
        }
    }
    return true;
}

// Non-privacy API method names that should be excluded from source matching
// These are system management APIs that don't return sensitive data
const NON_PRIVACY_API_METHODS = new Set([
    'createSubscriber',
    'subscribe',
    'unsubscribe',
    'publish',
    'publishEvent',
    'delete',
    'release',
    'checkPermission',
    'requestPermission',
    'verifyPermission',
]);

function isNonPrivacyApi(methodName: string): boolean {
    return NON_PRIVACY_API_METHODS.has(methodName);
}

function paramEqual(methodSignature: MethodSignature, paramInfos: string[]): boolean {
    if (methodSignature.getParamLength() != paramInfos.length) {
        return false;
    }
    let result = true;
    for (let i = 0; i < methodSignature.getParamLength(); i++) {
        const param = methodSignature.getMethodSubSignature().getParameters()[i], paramType = param.getType();
        const [paramName, paramTypeName] = paramInfos[i].replace('...', '').split(':');
        if (param.getName() != paramName) {
            result = false;
            break;
        }

        if (!(param.getName() == paramName && (canBeSplitAndContained(paramTypeName, paramType.toString()) || paramType instanceof ClassType && paramType.getClassSignature().getClassName() == paramCallbackString && paramTypeName.startsWith(paramCallbackString + '<')))) {
            result = false;
            break;
        }
    }
    return result;
}

export function getRecallMethodInParam(stmt: ArkInvokeStmt): ArkMethod[] {
    const ret: ArkMethod[] = [];
    const invokeExpr = stmt.getInvokeExpr();
    const args = invokeExpr.getArgs ? invokeExpr.getArgs() : [];
    for (let i = 0; i < args.length; i++) {
        const param = args[i];
        const paramType = param?.getType ? param.getType() : null;
        if (paramType instanceof FunctionType) {
            const methodSignature = paramType.getMethodSignature();
            const method = stmt.getCfg()?.getDeclaringMethod().getDeclaringArkClass().getMethod(methodSignature);
            if (method) {
                ret.push(method);
            }
        }
    }
    return ret;
}

export function propagateFact(value: Value, stmt: Stmt, ret: Set<TaintFact>, fromFact?: TaintFact): TaintFact | null {
    const fact = new TaintFact(value);
    let last: TaintFact | undefined | null = fromFact;
    while (last) {
        if (ValueEqual(value, last.getValue()) && stmt == last.getPath()[last.getPath().length - 1]) return null;
        last = last.getLast();
    }
    if (fromFact) {
        fact.addPaths(fromFact.getPath());
        fact.setLast(fromFact);
    }
    fact.addPath(stmt);
    ret.add(fact);
    return fact;
}

export function getDeclaringCfg(local: Local): Cfg {
    let declaringStmt = local.getDeclaringStmt();
    if (!declaringStmt) {
        return new Cfg();
    }
    return local.getDeclaringStmt()!.getCfg();
}

export function isClosureLocal(local: Local): boolean {
    const declaringStmt = local.getDeclaringStmt();
    if (declaringStmt instanceof ArkAssignStmt) {
        const rightOp = declaringStmt.getRightOp();
        if (rightOp instanceof ClosureFieldRef) {
            return true;
        }
    }
    return false;
}

export function getClosures(method: ArkMethod): Local[] | undefined {
    let closures: Local[] | undefined = undefined;
    for (const stmt of method.getCfg()!.getStartingBlock()!.getStmts()) {
        if (stmt instanceof ArkAssignStmt && stmt.getRightOp().getType() instanceof LexicalEnvType) {
            closures = (stmt.getRightOp().getType() as LexicalEnvType).getClosures();
            break;
        }
    }
    return closures;
}

/**
 * Resolve a closure variable to its actual captured value.
 *
 * When a lambda/callback has parameters like `info`, they may be represented as
 * ClosureFieldRef that references a variable from the enclosing scope (e.g., %closures0).
 * This function finds the actual value that the closure variable captures.
 *
 * @param closureLocal - The closure variable (e.g., %closures0)
 * @param method - The callback method containing the closure
 * @returns The actual Value captured by this closure, or null if not found
 */
export function resolveClosureVariable(closureLocal: Local, method: ArkMethod): Value | null {
    const cfg = method.getCfg();
    if (!cfg) return null;

    // Get the LexicalEnvType from the starting block
    for (const stmt of cfg.getStartingBlock()!.getStmts()) {
        if (stmt instanceof ArkAssignStmt) {
            const rightOp = stmt.getRightOp();
            if (rightOp.getType() instanceof LexicalEnvType) {
                const lexicalEnv = rightOp.getType() as LexicalEnvType;
                const closures = lexicalEnv.getClosures();

                for (const closure of closures as Value[]) {
                    if (closure instanceof ClosureFieldRef) {
                        const closureRef = closure as ClosureFieldRef;
                        if (closureRef.toString() === closureLocal.toString()) {
                            return closureRef.getBase();
                        }
                    }
                }
            }
        }
    }

    // Fallback: try to find the closure by analyzing the method's statements
    for (const block of cfg.getBlocks()) {
        for (const stmt of block.getStmts()) {
            if (!(stmt instanceof ArkAssignStmt)) continue;
            const leftOp = stmt.getLeftOp();
            if (!(leftOp instanceof Local)) continue;

            if (leftOp.getName() === closureLocal.getName()) {
                const rightOp = stmt.getRightOp();
                if (rightOp instanceof ClosureFieldRef) {
                    return (rightOp as ClosureFieldRef).getBase();
                }
                if (rightOp instanceof Local) {
                    return rightOp;
                }
            }
        }
    }

    return null;
}

/**
 * Get the actual parameters from a callback method, resolving closure variables.
 *
 * For a .then() callback like:
 *   selectContacts().then((info) => { ... })
 *
 * The `info` parameter may be:
 * 1. A direct Local parameter (normal case)
 * 2. A ClosureFieldRef that captures a value from the enclosing scope
 *
 * This function returns the resolved values for all parameters.
 */
export function getResolvedCallbackParameters(callbackMethod: ArkMethod): Value[] {
    const resolvedParams: Value[] = [];
    const paramInstances = callbackMethod.getParameterInstances();
    if (!paramInstances) return resolvedParams;

    for (const param of paramInstances) {
        if (param instanceof Local) {
            const paramName = param.getName();
            // Check if this is a closure variable (by isClosureLocal check)
            if (isClosureLocal(param)) {
                // It's a closure that captures an outer scope variable
                const resolved = resolveClosureVariable(param, callbackMethod);
                if (resolved) {
                    resolvedParams.push(resolved);
                    continue;
                }
                // Fall through to add as regular param if resolution fails
            }
            // Regular parameter - add it directly
            resolvedParams.push(param);
        } else if (param instanceof ClosureFieldRef) {
            // The base of ClosureFieldRef is the actual captured value
            resolvedParams.push((param as ClosureFieldRef).getBase());
        } else {
            // Other value types
            resolvedParams.push(param);
        }
    }

    return resolvedParams;
}

export function ValueEqual(value1: Value, value2: Value): boolean {
    if (value1 instanceof Constant && value2 instanceof Constant) {
        return value1 == value2;
    } else if (value1 instanceof Local && value2 instanceof Local) {
        return LocalEqual(value1, value2);
    } else if (value1 instanceof AbstractRef && value2 instanceof AbstractRef) {
        return RefEqual(value1, value2);
    }
    return false;
}

export function LocalEqual(local1: Local, local2: Local): boolean {
    return local1.getName() == local2.getName() && (getDeclaringCfg(local1) == getDeclaringCfg(local2) || localInAnonymousClass(local1) || localInAnonymousClass(local2));
}

export function RefEqual(ref1: AbstractRef, ref2: AbstractRef): boolean {
    if (ref1 instanceof ArkStaticFieldRef && ref2 instanceof ArkStaticFieldRef) {
        return ref1.getFieldSignature().toString() == ref2.getFieldSignature().toString();
    } else if (ref1 instanceof ArkInstanceFieldRef && ref2 instanceof ArkInstanceFieldRef) {
        return LocalEqual(ref1.getBase(), ref2.getBase()) && ref1.getFieldSignature().toString() == ref2.getFieldSignature().toString()
    } else if (ref1 instanceof ArkArrayRef && ref2 instanceof ArkArrayRef) {
        return LocalEqual(ref1.getBase(), ref2.getBase()) && ref1.toString() == ref2.toString();
    } else if (ref1 instanceof MultiRef && ref2 instanceof MultiRef) {
        return MultiRefEqual(ref1, ref2);
    } else if (ref1 instanceof ArkArrayRef && ref2 instanceof ArkInstanceFieldRef || ref1 instanceof ArkInstanceFieldRef && ref2 instanceof ArkArrayRef) {
        return LocalEqual(ref1.getBase(), ref2.getBase());
    } else if (ref1 instanceof GlobalRef && ref2 instanceof GlobalRef && ref1.getRef() && ref2.getRef()) {
        return ValueEqual(ref1.getRef()!, ref2.getRef()!);
    }
    return false;
}

export function MultiRefEqual(ref1: MultiRef, ref2: MultiRef): boolean {
    const fs1 = ref1.getFieldSignatures(), fs2 = ref2.getFieldSignatures();
    if (!(LocalEqual(ref1.getBase(), ref2.getBase()) && fs1.length == fs2.length)) {
        return false;
    }
    for (let i = 0; i < fs1.length; i++) {
        if (fs1[i].toString() != fs2[i].toString()) {
            return false;
        }
    }
    return true;
}

export function localDeclaredInCfg(local: Local, cfg: Cfg): boolean {
    const declaringStmt = local.getDeclaringStmt();
    if (declaringStmt instanceof ArkAssignStmt && declaringStmt.getCfg() == cfg && !(declaringStmt.getRightOp() instanceof ClosureFieldRef)) {
        return true;
    }
    return false;
}

export function localInAnonymousClass(local: Local): boolean {
    const usedStmts = local.getUsedStmts();
    if (usedStmts.length == 0) {
        return false;
    }
    const cls = usedStmts[0].getCfg().getDeclaringMethod().getDeclaringArkClass();
    return cls.getCategory() == ClassCategory.OBJECT;
}

export function getChildrenClasses(arkClass: ArkClass, scene: Scene): ArkClass[] {
    const classes: ArkClass[] = [];
    for (const cls of scene.getClasses()) {
        let superClass = cls.getSuperClass();
        while (superClass) {
            if (superClass.getSignature() == arkClass.getSignature()) {
                classes.push(cls);
                break;
            }
        }
    }
    return classes;
}


export function getPossibleRelatedNodes(value: Value, pointerAnalysis: PointerAnalysis, max_recursion = 4): Set<Value> {
    if (max_recursion <= 0) {
        return new Set();
    }
    let relatedNodes = pointerAnalysis.getRelatedNodes(value);
    let workList: Value[] = [];
    for (const v of relatedNodes) {
        if (v != value) {
            workList.push(v);
        }
    }
    while (workList.length > 0) {
        const alias = workList.shift()!;
        if (alias instanceof Local && alias.getName()[0] == '%' && !(alias.getType() instanceof FunctionType)) {
            relatedNodes.delete(alias);
        } else if (alias instanceof ArkArrayRef) {
            const arrayRelatedNodes = getPossibleRelatedNodes(alias.getBase(), pointerAnalysis, max_recursion - 1);
            for (const v of arrayRelatedNodes) {
                relatedNodes.add(v);
            }
        } else if (alias instanceof ArkInstanceFieldRef) {
            const fieldRelatedNodes = getPossibleRelatedNodes(alias.getBase(), pointerAnalysis, max_recursion - 1);
            for (const v of fieldRelatedNodes) {
                if (v instanceof Local) {
                    if (v.getType() instanceof ArrayType) {
                        relatedNodes.add(v);
                    }
                    relatedNodes.add(new ArkInstanceFieldRef(v, alias.getFieldSignature()));
                } else if (v instanceof ArkInstanceFieldRef) {
                    const fieldSignatures = [v.getFieldSignature(), alias.getFieldSignature()];
                    const mRef = new MultiRef(v.getBase(), fieldSignatures);
                    relatedNodes.add(mRef);
                } else if (v instanceof MultiRef) {
                    const fieldSignatures = [...v.getFieldSignatures(), alias.getFieldSignature()];
                    const mRef = new MultiRef(v.getBase(), fieldSignatures);
                    relatedNodes.add(mRef);
                }
            }
        }
    }
    relatedNodes.delete(value);
    return relatedNodes;
}

export function getAllCalleeMethods(callNode: ArkInvokeStmt, CHA: ClassHierarchyAnalysis, entryMethod: ArkMethod, scene: Scene): Set<ArkMethod> {
    const callSites = CHA.resolveCall(CHA.getCallGraph().getCallGraphNodeByMethod(entryMethod.getSignature()).getID(), callNode);
    const methods: Set<ArkMethod> = new Set();
    for (const callSite of callSites) {
        const method = scene.getMethod(CHA.getCallGraph().getMethodByFuncID(callSite.calleeFuncID)!);
        if (method) {
            methods.add(method);
        }
    }
    return methods;
}

export function getThisAssignStmt(method: ArkMethod): Stmt {
    const stmts = method.getCfg()!.getStmts();
    for (const stmt of stmts) {
        if (stmt instanceof ArkAssignStmt && stmt.getRightOp() instanceof ArkThisRef) {
            return stmt;
        }
    }
    return stmts[0];
}

export function classInheritsAbility(arkClass: ArkClass): boolean {
    const ABILITY_BASE_CLASS = 'UIAbility';
    if (arkClass.getSuperClassName() == ABILITY_BASE_CLASS) {
        return true;
    }
    let superClass = arkClass.getSuperClass();
    while (superClass) {
        if (superClass.getSuperClassName() == ABILITY_BASE_CLASS) {
            return true;
        }
        superClass = superClass.getSuperClass();
    }
    return false;
}

export function callSource(val: Value, sources: Map<string, Source>, scene: Scene, pta?: any): Source | null {
    if (val instanceof AbstractInvokeExpr) {
        const valMethodSignature = val.getMethodSignature();
        const sigStr = valMethodSignature.toString();

        // Exact match first
        if (sources.has(sigStr)) {
            return sources.get(sigStr)!;
        }

        // HapFlow original: if the declaring class inherits from UIAbility,
        // match ArgIn sources by method sub-signature (e.g., onCreate's Want param)
        const declaringCls = scene.getClass(valMethodSignature.getDeclaringClassSignature());
        if (declaringCls && classInheritsAbility(declaringCls)) {
            const invokeMethodName = valMethodSignature.getMethodSubSignature().getMethodName();
            for (const source of sources.values()) {
                if (source.sourceType == 'ArgIn') {
                    const sourceMethodName = source.methodSignature.getMethodSubSignature().getMethodName();
                    if (sourceMethodName != invokeMethodName) continue;
                    // Compare parameter types by short name (strip file paths)
                    // Invoke sig: "onCreate(@ohosSdk/api/@ohos.app.ability.Want.d.ts: Want, ...)"
                    // Source sig:  "onCreate(Want, ...)"
                    const invokeParamTypes = valMethodSignature.getMethodSubSignature().getParameterTypes();
                    const sourceParamTypes = source.methodSignature.getMethodSubSignature().getParameterTypes();
                    if (invokeParamTypes.length !== sourceParamTypes.length) continue;
                    let paramsMatch = true;
                    for (let i = 0; i < invokeParamTypes.length; i++) {
                        const invokeTypeStr = invokeParamTypes[i].getTypeString();
                        const sourceTypeStr = sourceParamTypes[i].getTypeString();
                        // Extract short name from invoke type (e.g., "Want" from "@ohosSdk/api/@ohos.app.ability.Want.d.ts: Want")
                        const invokeShort = invokeTypeStr.includes(':') ? invokeTypeStr.split(':').pop()!.trim() : invokeTypeStr;
                        if (invokeShort !== sourceTypeStr) {
                            paramsMatch = false;
                            break;
                        }
                    }
                    if (paramsMatch) {
                        return source;
                    }
                }
            }
        }

        // Fuzzy match: when signature is unknown (@%unk), match by method name AND base type
        // This is more precise than just matching method name
        if (sigStr.includes('@%unk') || sigStr.includes('@unk')) {
            const methodName = valMethodSignature.getMethodSubSignature().getMethodName();

            // Skip non-privacy APIs (system management, event subscription, etc.)
            if (isNonPrivacyApi(methodName)) {
                return null;
            }

            // Skip known non-privacy base types (process, console, etc.)
            // These are Node.js built-in objects or app-level storage that should never match SDK privacy APIs
            const NON_PRIVACY_BASE_TYPES = new Set([
                'process', 'console', 'global', 'globalThis',
                'require', 'module', 'exports', '__dirname', '__filename',
                'Buffer', 'setTimeout', 'setInterval', 'setImmediate',
                'clearTimeout', 'clearInterval', 'clearImmediate',
                'queueMicrotask', 'structuredClone', 'URL', 'URLSearchParams',
                // HarmonyOS app-level storage (not privacy data)
                'AppStorage', 'LocalStorage', 'PersistentStorage',
                // App-level data models (not SDK privacy APIs)
                'DataModel', 'ViewModel', 'MainViewModel', 'HomeModel',
                // HTTP libraries (the library itself is not a source)
                'axios', 'http',
            ]);
            if (val instanceof ArkInstanceInvokeExpr) {
                const base = val.getBase();
                if (base && base.toString()) {
                    const baseStr = base.toString().toLowerCase();
                    for (const nonPrivacyBase of NON_PRIVACY_BASE_TYPES) {
                        if (baseStr === nonPrivacyBase.toLowerCase() || baseStr.startsWith(nonPrivacyBase.toLowerCase() + '.')) {
                            return null;
                        }
                    }
                }
            }

            // Get the base type if it's an instance invoke
            let baseTypeName: string | null = null;
            let baseTypeString: string | null = null;
            let pointerAliases: string[] = [];  // Aliases from pointer analysis

            if (val instanceof ArkInstanceInvokeExpr) {
                const base = val.getBase();
                if (base) {
                    const baseType = base.getType();
                    if (baseType) {
                        baseTypeName = baseType.toString();
                        baseTypeString = base.toString();
                    }

                    // Use pointer analysis to get more precise type information
                    if (pta && pta.getRelatedNodes) {
                        const relatedNodes = pta.getRelatedNodes(base);
                        if (relatedNodes) {
                            for (const related of relatedNodes) {
                                const relatedType = related.getType();
                                if (relatedType) {
                                    pointerAliases.push(relatedType.toString());
                                }
                            }
                        }
                    }
                }
            }

            // Find sources matching both method name AND (if available) base type
            // Use cached method name index for faster lookup
            let bestMatch: Source | null = null;
            let bestMatchScore = 0;

            // Get candidates from cache (sources with matching method name)
            const methodCache = getMethodNameToSourcesCache(sources);
            const candidates = methodCache.get(methodName) || [];

            for (const source of candidates) {
                if (source.sourceType === 'callback' && source.callbackIndex >= val.getArgs().length) {
                    continue;
                }
                const key = Array.from(sources.keys()).find(k => sources.get(k) === source) || '';
                let score = 1; // Base score for method name match

                // Extract the actual module name from source key
                // Key format: @ohosSdk/api/@ohos.geoLocationManager.d.ts -> 'geoLocationManager'
                // Or: @ohosSdk/api/@ohos.geoLocationManager.d.ts: ClassName.methodName
                const sourceNsMatch = key.match(/@ohos\.(\w+)/);
                const sourceNs = sourceNsMatch ? sourceNsMatch[1] : '';

                if (baseTypeName && sourceNs) {
                    // Normalize for comparison
                    const normalizedBase = baseTypeName.toLowerCase().replace(/\./g, '').replace(/@/g, '');
                    const normalizedNs = sourceNs.toLowerCase().replace(/\./g, '').replace(/@/g, '');
                    // Match if either contains the other
                    if (normalizedBase.includes(normalizedNs) || normalizedNs.includes(normalizedBase)) {
                        score = 2; // Higher score for namespace match
                    }
                }

                // If base type is unknown, try to match using module pattern from source key
                // e.g., source key "@@ohosSdk/api/@ohos.geoLocationManager.d.ts" -> extract "geoLocationManager"
                const sourceModuleMatch = key.match(/@ohos\.(\w+)/);
                if (sourceModuleMatch) {
                    const sourceModuleName = sourceModuleMatch[1].toLowerCase();
                    // Check if the base type string or full signature contains this module name
                    const baseStr = (baseTypeString || '').toLowerCase();
                    const fullSig = valMethodSignature.toString().toLowerCase();
                    if (baseStr.includes(sourceModuleName) || fullSig.includes(sourceModuleName)) {
                        score = 3; // Higher score for module name match

                        // Extra bonus for matching first argument pattern (like 'locationChange')
                        if (val instanceof AbstractInvokeExpr) {
                            const args = val.getArgs();
                            if (args.length > 0) {
                                const firstArg = args[0];
                                if (firstArg instanceof Constant) {
                                    const firstArgStr = firstArg.toString().toLowerCase();
                                    const sourceKeyLower = key.toLowerCase();
                                    // If the source key contains the first argument string
                                    if (sourceKeyLower.includes(firstArgStr.replace(/'/g, ''))) {
                                        score += 1; // Extra point for argument match
                                    }
                                }
                            }
                        }
                    }
                }

                // Level 5: Use pointer analysis aliases for precise matching
                // If PTA found related nodes with specific types, use them
                if (pointerAliases.length > 0) {
                    const sourceNsLower = sourceNs.toLowerCase();
                    for (const alias of pointerAliases) {
                        const aliasLower = alias.toLowerCase().replace(/\./g, '').replace(/@/g, '');
                        if (aliasLower.includes(sourceNsLower) || sourceNsLower.includes(aliasLower)) {
                            score = 5; // Highest confidence - direct pointer alias match
                            break;
                        }
                    }
                }

                // Prefer return sources when base type is unknown (for better data flow tracking)
                // When baseTypeName is 'unknown', 'return' sources are more likely to produce data flows
                if (score > bestMatchScore) {
                    bestMatchScore = score;
                    bestMatch = source;
                } else if (score === bestMatchScore && bestMatch) {
                    // Prefer return type over callback when base is unknown
                    if (baseTypeName === 'unknown' && source.sourceType === 'return') {
                        bestMatch = source;
                    }
                }
            }

            // For overly generic method names that appear on many types (get, set, on, etc.),
            // require at least score >= 2 (namespace or module match) to avoid false matches
            // like AppStorage.get() matching SingleKVStore.get()
            const GENERIC_METHOD_NAMES = new Set(['get', 'set', 'on', 'off', 'has', 'delete', 'clear', 'length', 'toString']);
            if (bestMatch && GENERIC_METHOD_NAMES.has(methodName) && bestMatchScore < 2) {
                return null;
            }

            // Special handling for contact APIs: if we didn't find a match yet, try method name only
            // This handles cases like contact.selectContacts() where base type is 'unknown'
            const CONTACT_APIS = ['selectContacts', 'queryContact', 'queryContacts', 'queryContactsByPhoneNumber', 'queryContactsByEmail'];
            if (!bestMatch && CONTACT_APIS.includes(methodName)) {
                // candidates already contains all sources with matching method name
                for (const source of candidates) {
                    const key = Array.from(sources.keys()).find(k => sources.get(k) === source) || '';
                    if (key.includes('contact')) {
                        bestMatch = source;
                        break;
                    }
                }
            }

            return bestMatch;
        }

        const cls = scene.getClass(valMethodSignature.getDeclaringClassSignature());
        if (cls && classInheritsAbility(cls)) {
            for (const source of sources.values()) {
                if (source.sourceType == 'ArgIn' && source.methodSignature.getMethodSubSignature().toString() == valMethodSignature.getMethodSubSignature().toString()) {
                    return source;
                }
            }
        }
    }
    return null;
}
