import { ArkAssignStmt, ArkInvokeStmt, Stmt } from "../arkanalyzer";
import { ArrayType, ClassType, FunctionType, LexicalEnvType } from "../arkanalyzer";
import { Value } from "../arkanalyzer";
import { ArkClass } from "../arkanalyzer";
import { ExportInfo } from "../arkanalyzer";
import { ArkMethod } from "../arkanalyzer";
import { ArkNamespace } from "../arkanalyzer";
import { Scene } from "../arkanalyzer";
import { TaintFact } from "./TaintFact";
import { Local } from "../arkanalyzer";
import { AbstractRef, ArkArrayRef, ArkInstanceFieldRef, ArkParameterRef, ArkStaticFieldRef, ArkThisRef, ClosureFieldRef, GlobalRef } from "../arkanalyzer";
import { Cfg } from "../arkanalyzer";
import { PointerAnalysis } from "../arkanalyzer";
import { ClassHierarchyAnalysis } from "../arkanalyzer";
import { Constant } from "../arkanalyzer";
import { MultiRef } from "./MuiltiRef";
import { MethodSignature } from "../arkanalyzer";
import { AbstractInvokeExpr } from "../arkanalyzer";
import { Source } from "./Source";

// @ts-ignore - ClassCategory may not be in barrel export
import { ClassCategory } from "../arkanalyzer/core/model/ArkClass";

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
    const fileName = filenamePrefix + module + '.d.ts';
    const file = scene.getSdkArkFiles().filter(f => f.getName() == fileName)[0];
    if (!file) {
        return methodSignatures;
    }

    const expectedParamNames: string[] = (parameters && parameters.length > 0)
        ? parameters.map(p => p.name)
        : [];

    const namesMatch = (sig: MethodSignature, names: string[]): boolean => {
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
        if (ms) {
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
                    let mtd = cls.getMethodWithName(name);
                    if (!mtd) mtd = cls.getStaticMethodWithName(name);
                    const ms = collectFromMethod(mtd);
                    if (ms.length > 0) return ms;
                }
            } else {
                const defCls = ns.getDefaultClass();
                if (defCls) {
                    let mtd = defCls.getMethodWithName(name);
                    if (!mtd) mtd = defCls.getStaticMethodWithName(name);
                    const ms = collectFromMethod(mtd);
                    if (ms.length > 0) return ms;
                }
                for (const cls of ns.getClasses()) {
                    let mtd = cls.getMethodWithName(name);
                    if (!mtd) mtd = cls.getStaticMethodWithName(name);
                    const ms = collectFromMethod(mtd);
                    if (ms.length > 0) return ms;
                }
            }
        }
    }

    const defFileCls = file.getDefaultClass();
    if (defFileCls) {
        let mtd = defFileCls.getMethodWithName(name);
        if (!mtd) mtd = defFileCls.getStaticMethodWithName(name);
        const ms = collectFromMethod(mtd);
        if (ms.length > 0) return ms;
    }

    for (const cls of file.getClasses()) {
        let mtd = cls.getMethodWithName(name);
        if (!mtd) mtd = cls.getStaticMethodWithName(name);
        const ms = collectFromMethod(mtd);
        if (ms.length > 0) return ms;
    }

    for (const ns of file.getNamespaces()) {
        const defCls = ns.getDefaultClass();
        if (defCls) {
            let mtd = defCls.getMethodWithName(name);
            if (!mtd) mtd = defCls.getStaticMethodWithName(name);
            const ms = collectFromMethod(mtd);
            if (ms.length > 0) return ms;
        }
        for (const cls of ns.getClasses()) {
            let mtd = cls.getMethodWithName(name);
            if (!mtd) mtd = cls.getStaticMethodWithName(name);
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
    for (const param of stmt.getInvokeExpr().getArgs()) {
        if (param.getType() instanceof FunctionType) {
            const methodSignature = (param.getType() as FunctionType).getMethodSignature();
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

export function callSource(val: Value, sources: Map<string, Source>, scene: Scene): Source | null {
    if (val instanceof AbstractInvokeExpr) {
        const valMethodSignature = val.getMethodSignature();
        if (sources.has(valMethodSignature.toString())) {
            return sources.get(valMethodSignature.toString())!;
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
