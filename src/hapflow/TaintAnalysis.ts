
import { Scene } from "../arkanalyzer";
import { ArkBody } from "../arkanalyzer";
import { DataflowProblem, FlowFunction } from "../arkanalyzer";
import { Local } from "../arkanalyzer";
import { Value } from "../arkanalyzer";
import { ArkAssignStmt, ArkInvokeStmt, ArkReturnStmt, ArkThrowStmt, Stmt } from "../arkanalyzer";
import { ArkMethod } from "../arkanalyzer";
import { Constant } from "../arkanalyzer";
import { AbstractFieldRef, AbstractRef, ArkArrayRef, ArkInstanceFieldRef, ArkParameterRef, ArkStaticFieldRef, ClosureFieldRef, GlobalRef } from "../arkanalyzer";
import { DataflowSolver } from "./DataflowSolver";
import { AbstractInvokeExpr, ArkInstanceInvokeExpr, ArkPtrInvokeExpr, ArkStaticInvokeExpr } from "../arkanalyzer";
import { ArrayType, ClassType, FunctionType, LexicalEnvType, UnclearReferenceType, UndefinedType, VoidType } from "../arkanalyzer";
import { MethodSignature } from "../arkanalyzer";
import { PointerAnalysis } from "../arkanalyzer";
import { PointerAnalysisConfig } from "../arkanalyzer";
import * as fs from 'fs';
import { Source } from "./Source";
import { Santization } from "./Santization";
import { getPossibleRelatedNodes, INTERNAL_PARAMETER_SOURCE, INTERNAL_SINK_METHOD_toString, Json2ArkMethod, LocalEqual, localDeclaredInCfg, propagateFact, RefEqual, ValueEqual, getThisAssignStmt, callSource, getRecallMethodInParam, Json2ArkMethod_LLM, Json2ArkMethodSignature, isClosureLocal, getClosures } from "./Util";
import { TaintFact } from "./TaintFact";
import { MultiRef } from "./MuiltiRef";
import { PathEdgePoint } from "../arkanalyzer";
import { Logger, LOG_MODULE_TYPE } from "../arkanalyzer";

// @ts-ignore - ClassCategory/ArkClass may need deep import  
import { ClassCategory } from "../arkanalyzer/core/model/ArkClass";
// @ts-ignore - ANONYMOUS/INSTANCE_INIT constants
import { ANONYMOUS_CLASS_PREFIX, ANONYMOUS_METHOD_PREFIX, INSTANCE_INIT_METHOD_NAME } from "../arkanalyzer";
// @ts-ignore - FileSignature, NamespaceSignature may need deep import
import { FileSignature, NamespaceSignature } from "../arkanalyzer";

const logger = Logger.getLogger(LOG_MODULE_TYPE.ARKANALYZER, 'HapFlow');

export class TaintAnalysisChecker extends DataflowProblem<TaintFact> {
    private zeroValue: TaintFact;
    private entryPoint: Stmt;
    private entryMethod: ArkMethod;
    private scene: Scene;
    private sources: Map<string, Source> = new Map();
    private sinks: MethodSignature[] = [];
    private santizations: MethodSignature[] = [];
    private pointerAnalysis: PointerAnalysis | undefined;
    private detectOutcome: TaintFact[] = [];
    constructor(stmt: Stmt, method: ArkMethod, pta?: PointerAnalysis) {
        super();
        this.zeroValue = new TaintFact(new Constant('zeroValue', UndefinedType.getInstance()));
        this.entryPoint = stmt;
        this.entryMethod = method;
        this.scene = method.getDeclaringArkFile().getScene();
        this.pointerAnalysis = pta;
    }

    getEntryPoint(): Stmt {
        return this.entryPoint;
    }

    getEntryMethod(): ArkMethod {
        return this.entryMethod;
    }

    public callSink(expr: AbstractInvokeExpr): boolean {
        for (const sink of this.sinks) {
            const methodSignature = expr.getMethodSignature().toString()
            if (sink.toString() == methodSignature || INTERNAL_SINK_METHOD_toString.includes(methodSignature)) {
                return true;
            }
        }
        return false;
    }

    data2Sink(srcStmt: Stmt, dataFact: TaintFact): void {
        const callExpr = srcStmt.getInvokeExpr();
        const dataValue = dataFact.getValue();
        if (callExpr && this.callSink(callExpr)) {
            for (const param of callExpr.getArgs()) {
                if (ValueEqual(param, dataValue) || dataValue instanceof ArkInstanceFieldRef && param instanceof Local && LocalEqual(dataValue.getBase(), param)) {
                    dataFact.addPath(srcStmt);
                    const dataFactPaths = dataFact.getPath()
                    let newOutcome = true;
                    for (let i = 0; i < this.detectOutcome.length; i++) {
                        const outcomeValue = this.detectOutcome[i].getValue();
                        const outcomePath = this.detectOutcome[i].getPath();
                        if (ValueEqual(outcomeValue, dataFact.getValue()) && outcomePath[outcomePath.length - 1] == srcStmt) {
                            if (outcomePath.every(item => dataFactPaths.includes(item))) {
                                newOutcome = false;
                            } else if (dataFactPaths.every(item => outcomePath.includes(item))) {
                                this.detectOutcome[i] = dataFact;
                                newOutcome = false;
                            }
                        }
                    }
                    if (newOutcome) {
                        this.detectOutcome.push(dataFact);
                    }
                    console.log("[HAPFLOW] source: " + dataFact);
                    console.log("[HAPFLOW] sink: " + srcStmt.getOriginPositionInfo().toString() + ", " + srcStmt.toString());
                }
            }
        }
    }

    protected addTaintFromSourceAssgin(dataFact: TaintFact, stmt: ArkAssignStmt, ret: Set<TaintFact>) {
        if (this.getZeroValue() == dataFact && callSource(stmt.getRightOp(), this.sources, this.scene)) {
            propagateFact(stmt.getDef()!, stmt, ret);
        }
    }

    protected addTaintFromSourceCall(stmt: Stmt, method: ArkMethod, ret: Set<TaintFact>) {
        const source = callSource(stmt.getInvokeExpr()!, this.sources, this.scene);
        if (source) {
            const invokeExpr = stmt.getInvokeExpr()!;
            if (source.sourceType == 'callback') {
                const arg = invokeExpr.getArgs()[source.callbackIndex];
                const methodSignature = (arg.getType() as FunctionType).getMethodSignature();
                const callbackMethod = stmt.getCfg()?.getDeclaringMethod().getDeclaringArkClass().getMethod(methodSignature);
                if (callbackMethod) {
                    if (method.getParameters().length <= source.sourceIndex) {
                        return;
                    }
                    const paramRef = callbackMethod.getParameterInstances()[source.sourceIndex + (method.getParameters()[0].getType() instanceof LexicalEnvType ? 1 : 0)];
                    if (!paramRef) {
                        return;
                    }
                    propagateFact(paramRef, stmt, ret);
                }
            } else if (source.sourceType == 'ArgIn') {
                const param = method.getParameterInstances()[source.sourceIndex + (method.getParameters()[0].getType() instanceof LexicalEnvType ? 1 : 0)];
                propagateFact(param, stmt, ret);
            }
        }
    }

    getNormalFlowFunction(srcStmt: Stmt, tgtStmt: Stmt): FlowFunction<TaintFact> {
        let checkerInstance: TaintAnalysisChecker = this;
        return new class implements FlowFunction<TaintFact> {
            getDataFacts(dataFact: TaintFact): Set<TaintFact> {
                const dataValue = dataFact.getValue();
                let ret: Set<TaintFact> = new Set();
                if (checkerInstance.getEntryPoint() == srcStmt && checkerInstance.getZeroValue() == dataFact) {
                    ret.add(checkerInstance.getZeroValue());
                    return ret;
                }
                const stmtDef = srcStmt.getDef();
                let reDef = stmtDef && ValueEqual(stmtDef, dataValue);
                if (stmtDef && checkerInstance.pointerAnalysis) {
                    for (const v of getPossibleRelatedNodes(dataValue, checkerInstance.pointerAnalysis)) {
                        if (ValueEqual(v, dataValue)) {
                            reDef = true;
                            break;
                        }
                    }
                }
                if (!(reDef || srcStmt.getDef() && ValueEqual(srcStmt.getDef()!, dataFact.getValue()))) {
                    let santiza = false;
                    const expr = srcStmt.getInvokeExpr()
                    if (expr) {
                        const args = expr.getArgs();
                        if (args.includes(dataValue)) {
                            const methodSignature = expr.getMethodSignature();
                            for (const santi of checkerInstance.santizations) {
                                if (santi == methodSignature) {
                                    santiza = true;
                                    break;
                                }
                            }
                        }
                    }
                    if (!santiza && !(dataValue instanceof Local && dataValue.toString()[0] == '%' && srcStmt.getUses().includes(dataValue) && dataValue.getUses().length == 1)) {
                        ret.add(dataFact);
                    }
                }
                if (srcStmt instanceof ArkAssignStmt) {
                    let stmt: ArkAssignStmt = (srcStmt as ArkAssignStmt);
                    let assigned: Value = stmt.getLeftOp();
                    let rightOp: Value = stmt.getRightOp();
                    checkerInstance.addTaintFromSourceAssgin(dataFact, stmt, ret);

                    if (dataValue instanceof ArkInstanceFieldRef && rightOp == dataValue.getBase()) {
                        const leftOp = srcStmt.getLeftOp();
                        if (leftOp instanceof Local) {
                            const field = new ArkInstanceFieldRef(leftOp, dataValue.getFieldSignature());
                            propagateFact(field, srcStmt, ret, dataFact);
                        } else if (leftOp instanceof ArkInstanceFieldRef) {
                            const field = new MultiRef(leftOp.getBase(), [leftOp.getFieldSignature(), dataValue.getFieldSignature()]);
                            propagateFact(field, srcStmt, ret, dataFact);
                        }
                    } else if (dataValue instanceof MultiRef) {
                        if (checkerInstance.pointerAnalysis) {
                            for (const v of getPossibleRelatedNodes(rightOp, checkerInstance.pointerAnalysis)) {
                                if (ValueEqual(dataValue, v)) {
                                    propagateFact(assigned, srcStmt, ret, dataFact);
                                    break;
                                }
                            }
                        }
                        if ((assigned instanceof Local || assigned instanceof ArkInstanceFieldRef) && rightOp instanceof ArkInstanceFieldRef && LocalEqual(rightOp.getBase(), dataValue.getBase()) && rightOp.getFieldSignature().toString() == dataValue.getFieldSignatures()[0].toString()) {
                            if (assigned instanceof Local && dataValue.getFieldSignatures().length == 2) {
                                const field = new ArkInstanceFieldRef(assigned, dataValue.getFieldSignatures()[1]);
                                propagateFact(field, srcStmt, ret, dataFact);
                            } else {
                                const fileds = [];
                                let base: Local;
                                if (assigned instanceof Local) {
                                    base = assigned;
                                } else {
                                    base = assigned.getBase();
                                    fileds.push(assigned.getFieldSignature());
                                }
                                for (let i = 1; i < dataValue.getFieldSignatures().length; i++) {
                                    fileds.push(dataValue.getFieldSignatures()[i]);
                                }
                                const m = new MultiRef(base, fileds);
                                propagateFact(m, srcStmt, ret, dataFact);
                            }
                        }
                    } else {
                        let tainted = false;
                        const uses = new Set([...rightOp.getUses(), rightOp]);
                        for (const use of uses) {
                            if (ValueEqual(use, dataFact.getValue())) {
                                tainted = true;
                                propagateFact(assigned, srcStmt, ret, dataFact);
                                if (assigned instanceof ArkArrayRef) {
                                    propagateFact(assigned.getBase(), srcStmt, ret, dataFact);
                                }

                                if (!checkerInstance.pointerAnalysis) {
                                    break;
                                }
                                try {
                                    const possibleRelatedNodes = getPossibleRelatedNodes(assigned, checkerInstance.pointerAnalysis);
                                    possibleRelatedNodes.forEach(v => {
                                        if (v instanceof Local && localDeclaredInCfg(v, srcStmt.getCfg())
                                            || (v instanceof ArkInstanceFieldRef || v instanceof ArkArrayRef || v instanceof MultiRef) && localDeclaredInCfg(v.getBase(), srcStmt.getCfg())
                                            || v instanceof ArkStaticFieldRef) {
                                            propagateFact(v, srcStmt, ret, dataFact);
                                        }
                                    });
                                } catch (err) {
                                    console.error(err);
                                }
                                break;
                            }
                        }
                        if (!tainted) {
                            if (checkerInstance.pointerAnalysis) {
                                for (const v of getPossibleRelatedNodes(assigned, checkerInstance.pointerAnalysis)) {
                                    if (ValueEqual(v, dataValue)) {
                                        return ret;
                                    }
                                }
                            } else if (ValueEqual(assigned, dataValue)) {
                                return ret;
                            }
                        }

                    }
                } else if (srcStmt.getInvokeExpr()) {
                    const invokeExpr = srcStmt.getInvokeExpr();
                    const source = callSource(invokeExpr!, checkerInstance.sources, checkerInstance.scene);
                    if (source && source.sourceType == 'ArgIn') {
                        propagateFact(invokeExpr!.getArgs()[source.sourceIndex], srcStmt, ret);
                    }
                    if (invokeExpr instanceof ArkInstanceInvokeExpr && invokeExpr.getMethodSignature().getMethodSubSignature().getMethodName() == 'constructor' &&
                        invokeExpr.getBase().getType().toString().includes('Error')) {
                        propagateFact(invokeExpr.getBase(), srcStmt, ret, dataFact);
                    }
                } else if (srcStmt instanceof ArkThrowStmt && ValueEqual(srcStmt.getOp(), dataFact.getValue())) {
                    propagateFact(tgtStmt.getDef()!, srcStmt, ret, dataFact);
                }
                // Map.set, Set.add, Array.push
                if (srcStmt instanceof ArkInvokeStmt && srcStmt.getInvokeExpr() instanceof ArkInstanceInvokeExpr) {
                    const expr = srcStmt.getInvokeExpr() as ArkInstanceInvokeExpr
                    const base = expr.getBase();
                    const baseType = base.getType();
                    if ((baseType.toString().includes('@internal/lib.es2015.collection.d.ts: Map') || baseType instanceof UnclearReferenceType && baseType.getName() == 'Map') && expr.getMethodSignature().getMethodSubSignature().getMethodName() == 'set' && ValueEqual(expr.getArgs()[1], dataValue)
                        || (baseType.toString().includes('@internal/lib.es2015.collection.d.ts: Set') || baseType instanceof UnclearReferenceType && baseType.getName() == 'Set') && expr.getMethodSignature().getMethodSubSignature().getMethodName() == 'add' && ValueEqual(expr.getArgs()[0], dataValue)
                        || baseType instanceof ArrayType && expr.getMethodSignature().getMethodSubSignature().getMethodName() == 'push' && ValueEqual(expr.getArgs()[0], dataValue)
                    ) {
                        const taint = new TaintFact(base);
                        taint.addPath(srcStmt);
                        ret.add(taint);
                    }
                }
                // sink为api函数进normal flow
                checkerInstance.data2Sink(srcStmt, dataFact);
                return ret;
            }
        }
    }

    getCallFlowFunction(srcStmt: Stmt, method: ArkMethod): FlowFunction<TaintFact> {
        let checkerInstance: TaintAnalysisChecker = this;
        return new class implements FlowFunction<TaintFact> {
            getDataFacts(dataFact: TaintFact): Set<TaintFact> {
                const dataValue = dataFact.getValue();
                const ret: Set<TaintFact> = new Set();
                if (checkerInstance.getZeroValue() == dataFact) {
                    ret.add(checkerInstance.getZeroValue());
                    checkerInstance.addTaintFromSourceCall(srcStmt, method, ret);

                } else if (dataValue instanceof GlobalRef) {
                    ret.add(dataFact);
                } else if (dataValue instanceof ArkStaticFieldRef) {
                    ret.add(dataFact);
                } else if (method.getDeclaringArkClass().getCategory() == ClassCategory.OBJECT && (method.getName() == INSTANCE_INIT_METHOD_NAME || method.getName() == "constructor") && !(dataValue instanceof ArkInstanceFieldRef && dataValue.getBase().getName() == 'this')) {
                    ret.add(dataFact);
                } else {
                    const callExpr = srcStmt.getInvokeExpr()!;
                    if (callExpr instanceof ArkInstanceInvokeExpr && (dataValue instanceof ArkInstanceFieldRef || dataValue instanceof MultiRef) && callExpr.getBase().getName() == dataValue.getBase().getName()) {
                        const _this = getThisAssignStmt(method).getDef();
                        let ref;
                        if (dataValue instanceof ArkInstanceFieldRef) {
                            ref = new ArkInstanceFieldRef(_this as Local, dataValue.getFieldSignature());
                        } else {
                            ref = new MultiRef(_this as Local, dataValue.getFieldSignatures())
                        }
                        propagateFact(ref, srcStmt, ret, dataFact);
                    } else if (callExpr instanceof ArkStaticInvokeExpr && dataValue instanceof ArkStaticFieldRef && callExpr.getMethodSignature().getDeclaringClassSignature() == dataValue.getFieldSignature().getDeclaringSignature()) {
                        ret.add(dataFact);
                    }
                    let closures = getClosures(method);
                    if (closures) {
                        for (const cl of closures) {
                            if (dataValue instanceof Local && ValueEqual(cl, dataValue)) {
                                for (const stmt of method.getCfg()!.getStartingBlock()!.getStmts()) {
                                    if (stmt instanceof ArkAssignStmt && stmt.getRightOp() instanceof ClosureFieldRef) {
                                        const cfr = (stmt.getRightOp() as ClosureFieldRef).getFieldName()
                                        if (dataValue.getName() == cfr) {
                                            propagateFact(stmt.getDef()!, stmt, ret, dataFact);
                                        }
                                        break;
                                    }
                                }
                                break;
                            } else if (dataValue instanceof ArkInstanceFieldRef && ValueEqual(cl, dataValue.getBase())) {
                                for (const stmt of method.getCfg()!.getStartingBlock()!.getStmts()) {
                                    if (stmt instanceof ArkAssignStmt && stmt.getRightOp() instanceof ClosureFieldRef) {
                                        const cfr = (stmt.getRightOp() as ClosureFieldRef).getFieldName()
                                        if (dataValue.getBase().getName() == cfr) {
                                            propagateFact(new ArkInstanceFieldRef(stmt.getDef() as Local, dataValue.getFieldSignature()), stmt, ret, dataFact);
                                        }
                                        break;
                                    }
                                }
                                break;
                            } else if (dataValue instanceof MultiRef && ValueEqual(cl, dataValue.getBase())) {
                                for (const stmt of method.getCfg()!.getStartingBlock()!.getStmts()) {
                                    if (stmt instanceof ArkAssignStmt && stmt.getRightOp() instanceof ClosureFieldRef) {
                                        const cfr = (stmt.getRightOp() as ClosureFieldRef).getFieldName()
                                        if (dataValue.getBase().getName() == cfr) {
                                            propagateFact(new MultiRef(stmt.getDef() as Local, dataValue.getFieldSignatures()), stmt, ret, dataFact);
                                        }
                                        break;
                                    }
                                }
                                break;
                            }
                        }
                    }

                    for (const sink of checkerInstance.sinks) {
                        if (callExpr.getMethodSignature() == sink) {
                            for (const param of callExpr.getArgs()) {
                                if (ValueEqual(param, dataFact.getValue())) {
                                    dataFact.addPath(srcStmt);
                                    checkerInstance.detectOutcome.push(dataFact);
                                    console.log("[HAPFLOW] source: " + dataFact);
                                    console.log("[HAPFLOW] sink: " + srcStmt.getOriginPositionInfo().toString() + ", " + srcStmt.toString());
                                }
                            }
                        }
                    }
                }
                const callStmt = srcStmt as ArkInvokeStmt;
                if (getRecallMethodInParam(callStmt).includes(method)) {
                    return ret;
                }
                const args = callStmt.getInvokeExpr().getArgs();
                const stmts = [...method.getCfg()!.getBlocks()][0].getStmts();
                for (let i = 0; i < args.length; i++) {
                    if (dataValue instanceof ArkInstanceFieldRef && dataValue.getBase().getName() == args[i].toString()) {
                        const realParameter = stmts[i].getDef();
                        if (realParameter) {
                            const retRef = new ArkInstanceFieldRef(realParameter as Local, dataValue.getFieldSignature());
                            propagateFact(retRef, srcStmt, ret, dataFact);
                        }
                    } else if (dataValue instanceof Local && dataValue.toString() == args[i].toString()) {
                        if (method.getParameters().length <= i) {
                            break;
                        }
                        propagateFact(method.getParameterInstances()[i + (method.getParameters()[0].getType() instanceof LexicalEnvType ? 1 : 0)], srcStmt, ret, dataFact);
                    }
                }
                checkerInstance.data2Sink(srcStmt, dataFact);
                return ret;
            }

        }
    }

    getExitToReturnFlowFunction(srcStmt: Stmt, tgtStmt: Stmt, callStmt: Stmt): FlowFunction<TaintFact> {
        let checkerInstance: TaintAnalysisChecker = this;
        return new class implements FlowFunction<TaintFact> {
            getDataFacts(dataFact: TaintFact): Set<TaintFact> {
                const dataValue = dataFact.getValue();
                let ret: Set<TaintFact> = new Set<TaintFact>();
                if (dataFact == checkerInstance.getZeroValue()) {
                    ret.add(checkerInstance.getZeroValue());
                } else {
                    if (dataValue instanceof Local && srcStmt.getCfg().getDeclaringMethod().getBody()?.getUsedGlobals()?.has(dataValue.getName())) {
                        const globalLocal = srcStmt.getCfg().getDeclaringMethod().getBody()?.getUsedGlobals()?.get(dataValue.getName());
                        if (globalLocal instanceof GlobalRef) {
                            propagateFact(globalLocal, srcStmt, ret, dataFact);
                        }
                    } else if (dataValue instanceof ArkInstanceFieldRef && srcStmt.getCfg().getDeclaringMethod().getBody()?.getUsedGlobals()?.has(dataValue.getBase().getName())) {
                        const globalLocal = srcStmt.getCfg().getDeclaringMethod().getBody()?.getUsedGlobals()?.get(dataValue.getBase().getName());
                        if (globalLocal instanceof GlobalRef && globalLocal.getRef() instanceof Local) {
                            const fieldRef = new ArkInstanceFieldRef(globalLocal.getRef() as Local, dataValue.getFieldSignature());
                            propagateFact(fieldRef, srcStmt, ret, dataFact);
                        }
                    } else if (dataValue instanceof ArkStaticFieldRef) {
                        ret.add(dataFact);
                    } else if (dataValue instanceof ArkInstanceFieldRef && dataValue.getBase().getName() == "this") {
                        const expr = callStmt.getInvokeExpr();
                        if (expr instanceof ArkInstanceInvokeExpr) {
                            const fieldRef = new ArkInstanceFieldRef(expr.getBase(), dataValue.getFieldSignature());
                            const newFact = propagateFact(fieldRef, srcStmt, ret, dataFact);
                            if (newFact && dataFact.getLast() && ValueEqual(fieldRef, dataFact.getLast()!.getValue())) {
                                newFact.setLast(dataFact.getLast()!.getLast());
                                newFact.getPath().pop();
                                newFact.getPath().pop();
                            }
                            if (checkerInstance.pointerAnalysis) {
                                getPossibleRelatedNodes(expr.getBase(), checkerInstance.pointerAnalysis).forEach(v => {
                                    if (v instanceof Local && localDeclaredInCfg(v, callStmt.getCfg())) {
                                        const field = new ArkInstanceFieldRef(v, dataValue.getFieldSignature());
                                        propagateFact(field, srcStmt, ret, dataFact);
                                    } else if (v instanceof ArkInstanceFieldRef && localDeclaredInCfg(v.getBase(), callStmt.getCfg())) {
                                        const fieldSignatures = [v.getFieldSignature(), dataValue.getFieldSignature()];
                                        const mRef = new MultiRef(v.getBase(), fieldSignatures);
                                        propagateFact(mRef, srcStmt, ret, dataFact);
                                    } else if (v instanceof MultiRef && localDeclaredInCfg(v.getBase(), callStmt.getCfg())) {
                                        const fieldSignatures = [...v.getFieldSignatures(), dataValue.getFieldSignature()];
                                        const mRef = new MultiRef(v.getBase(), fieldSignatures);
                                        propagateFact(mRef, srcStmt, ret, dataFact);
                                    }
                                });
                            }
                        } else if (expr instanceof ArkPtrInvokeExpr) {
                            const method = checkerInstance.scene.getMethod((expr.getFuncPtrLocal().getType() as FunctionType).getMethodSignature());
                            if (method?.getDeclaringArkClass() == callStmt.getCfg().getDeclaringMethod().getDeclaringArkClass()) {
                                ret.add(dataFact);
                            }
                        }
                    } else if (dataValue instanceof MultiRef && dataValue.getBase().getName() == "this") {
                        const expr = callStmt.getInvokeExpr();
                        if (expr instanceof ArkInstanceInvokeExpr) {
                            const mRef = new MultiRef(expr.getBase(), dataValue.getFieldSignatures());
                            propagateFact(mRef, srcStmt, ret, dataFact);
                        }
                    } else {
                        let closures = getClosures(srcStmt.getCfg().getDeclaringMethod());
                        if (closures) {
                            if (dataValue instanceof Local && isClosureLocal(dataValue)) {
                                for (const local of closures) {
                                    if (local.getName() == dataValue.getName()) {
                                        const newFact = propagateFact(local, srcStmt, ret, dataFact);
                                        if (newFact && dataFact.getLast() && ValueEqual(local, dataFact.getLast()!.getValue())) {
                                            newFact.setLast(dataFact.getLast()!.getLast());
                                            newFact.getPath().pop();
                                            newFact.getPath().pop();
                                        }
                                        break;
                                    }
                                }
                            } else if (dataValue instanceof ArkInstanceFieldRef && isClosureLocal(dataValue.getBase())) {
                                for (const local of closures) {
                                    if (local.getName() == dataValue.getBase().getName()) {
                                        const fieldRef = new ArkInstanceFieldRef(local, dataValue.getFieldSignature());
                                        const newFact = propagateFact(fieldRef, srcStmt, ret, dataFact);
                                        if (newFact && dataFact.getLast() && ValueEqual(fieldRef, dataFact.getLast()!.getValue())) {
                                            newFact.setLast(dataFact.getLast()!.getLast());
                                            newFact.getPath().pop();
                                            newFact.getPath().pop();
                                        }
                                        break;
                                    }
                                }
                            } else if (dataValue instanceof MultiRef && isClosureLocal(dataValue.getBase())) {
                                for (const local of closures) {
                                    if (local.getName() == dataValue.getBase().getName()) {
                                        propagateFact(local, srcStmt, ret, dataFact);
                                        break;
                                    }
                                }
                            }
                        }

                    }
                    if (checkerInstance.pointerAnalysis) {
                        try {
                            const possibleRelatedNodes = getPossibleRelatedNodes(dataValue, checkerInstance.pointerAnalysis);
                            possibleRelatedNodes.forEach(v => {
                                if (v instanceof Local && localDeclaredInCfg(v, callStmt.getCfg())
                                    || (v instanceof ArkInstanceFieldRef || v instanceof ArkArrayRef || v instanceof MultiRef) && localDeclaredInCfg(v.getBase(), callStmt.getCfg())
                                    || v instanceof ArkStaticFieldRef) {
                                    propagateFact(v, srcStmt, ret, dataFact);
                                }
                            });
                        } catch (err) {
                            console.error(err);
                        }
                    }
                }
                if (!(callStmt instanceof ArkAssignStmt)) {
                    return ret;
                }
                if (srcStmt instanceof ArkReturnStmt) {
                    let ass: ArkAssignStmt = callStmt as ArkAssignStmt;
                    let leftOp: Value = ass.getLeftOp();
                    let retVal: Value = (srcStmt as ArkReturnStmt).getOp();
                    if (dataFact == checkerInstance.getZeroValue()) {
                        ret.add(checkerInstance.getZeroValue());
                    } else if (retVal == dataValue) {
                        propagateFact(leftOp, srcStmt, ret, dataFact);
                    }
                }
                return ret;
            }
        }
    }

    getCallToReturnFlowFunction(srcStmt: Stmt, tgtStmt: Stmt): FlowFunction<TaintFact> {
        let checkerInstance: TaintAnalysisChecker = this;
        return new class implements FlowFunction<TaintFact> {
            getDataFacts(dataFact: TaintFact): Set<TaintFact> {
                const dataValue = dataFact.getValue();
                const ret: Set<TaintFact> = new Set();
                if (checkerInstance.getZeroValue() == dataFact) {
                    ret.add(checkerInstance.getZeroValue());
                }
                const defValue = srcStmt.getDef();
                if (defValue && checkerInstance.pointerAnalysis) {
                    for (const v of getPossibleRelatedNodes(defValue, checkerInstance.pointerAnalysis)) {
                        if (ValueEqual(v, dataValue) || dataValue instanceof ArkInstanceFieldRef && ValueEqual(v, dataValue.getBase())) {
                            return ret;
                        }
                    }
                }
                if (!(defValue && defValue == dataValue)) {
                    ret.add(dataFact);
                }
                return ret;
            }

        }
    }



    createZeroValue(): TaintFact {
        return this.zeroValue;
    }

    getZeroValue(): TaintFact {
        return this.zeroValue;
    }

    factEqual(d1: TaintFact, d2: TaintFact): boolean {
        let value1 = d1.getValue(), value2 = d2.getValue();
        return ValueEqual(value1, value2);
    }

    public addSinksFromJson(path: string) {
        const data = fs.readFileSync(path, 'utf-8');
        const objects = JSON.parse(data);
        for (const object of objects) {
            let methodSignatures: MethodSignature[] = [];
            methodSignatures = Json2ArkMethodSignature(object.module, object.namespace || '', object.class || '', object.api_name, this.scene, object.parameters);

            for (const ms of methodSignatures) {
                this.sinks.push(ms);
            }
        }
    }

    public addSourcesFromJson(path: string) {
        const data = fs.readFileSync(path, 'utf-8');
        const objects = JSON.parse(data)
        for (const object of objects) {
            let methodSignatures: MethodSignature[] = [];
            methodSignatures = Json2ArkMethodSignature(object.module, object.namespace || '', object.class || '', object.api_name, this.scene, object.parameters);

            const sourceType: string = object.source_type || 'return';
            let sourceIndex: number = -1;
            let callbackIndex: number = -1;
            if (sourceType === 'ArgIn') {
                sourceIndex = (object.tainted_param_index ?? 0) - 1;
            } else if (sourceType === 'callback') {
                callbackIndex = (object.tainted_param_index ?? 0) - 1;
                const param = object.parameters[callbackIndex].type.trim();
                const VALID_CALLBACK_PATTERN: RegExp = /^(?:.*?\.)?(?:Async)?Callback<.*>$/;
                const ASYNC_CALLBACK_PATTERN: RegExp = /^(?:.*?\.)?AsyncCallback<.*>$/;
                if (ASYNC_CALLBACK_PATTERN.test(param)) {
                    sourceIndex = 1;
                } else if (VALID_CALLBACK_PATTERN.test(param)) {
                    sourceIndex = 0;
                }
            }
            for (const ms of methodSignatures) {
                this.sources.set(ms.toString(), new Source(ms, sourceType, sourceIndex, callbackIndex));
            }
        }
    }

    public addSantizationsFromJson(path: string) {
        const data = fs.readFileSync(path, 'utf-8');
        const objects = JSON.parse(data)
        for (const object of objects) {
            const method = Json2ArkMethod(object.method, this.scene);
            if (method) {
                this.santizations.push(method);
            }
        }
    }

    getSinks(): MethodSignature[] {
        return this.sinks;
    }

    getSources(): Map<string, Source> {
        return this.sources;
    }

    getOutcome(): TaintFact[] {
        return this.detectOutcome;
    }

}
