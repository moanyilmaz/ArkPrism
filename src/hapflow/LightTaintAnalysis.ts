import { PointerAnalysis } from "../arkanalyzer";
import { ArkAssignStmt, Stmt } from "../arkanalyzer";
import { ArkMethod } from "../arkanalyzer";
import { TaintAnalysisChecker } from "./TaintAnalysis";
import { TaintFact } from "./TaintFact";
import { PathEdgePoint } from "../arkanalyzer";
import { ClassHierarchyAnalysis, CallGraphBuilder } from "../arkanalyzer";
import { CallGraph } from "../arkanalyzer";
import { PointerAnalysisConfig } from "../arkanalyzer";
import { FunctionType, LexicalEnvType } from "../arkanalyzer";
import { Scene } from "../arkanalyzer";
import { Logger, LOG_MODULE_TYPE } from "../arkanalyzer";
import { Source } from "./Source";
import { LightTaintAnalysisSolver } from "./TaintAnalysisSolver";
import { Json2ArkMethod, Json2ArkMethod_LLM, classInheritsAbility, getThisAssignStmt } from "./Util";
import * as fs from 'fs';

// @ts-ignore - ClosureType/VoidType may need deep import
import { ClosureType, VoidType } from "../arkanalyzer/core/base/Type";

export class LightTaintAnalysisChecker extends TaintAnalysisChecker {
    constructor(stmt: Stmt, method: ArkMethod, pta?: PointerAnalysis) {
        super(stmt, method, pta);
    }

    protected addTaintFromSourceAssgin(dataFact: TaintFact, stmt: ArkAssignStmt, ret: Set<TaintFact>): void { }

    protected addTaintFromSourceCall(stmt: Stmt, method: ArkMethod, ret: Set<TaintFact>): void { }
}

export class LightTaintAnalysis {
    private scene: Scene;
    private outcome: TaintFact[] = [];
    constructor(scene: Scene) {
        this.scene = scene;
    }

    private getNextStmt(stmt: Stmt): Stmt[] {
        const ret: Stmt[] = []
        for (const block of stmt.getCfg().getBlocks()) {
            const stmts = block.getStmts();
            for (let i = 0; i < stmts.length; i++) {
                if (stmt == stmts[i]) {
                    if (i == stmts.length - 1) {
                        for (const successor of block.getSuccessors()) {
                            ret.push(successor.getStmts()[0]);
                        }
                    } else {
                        return [stmts[i + 1]];
                    }
                }
            }
        }
        return ret;
    }


    private taintStart(stmt: Stmt, scene: Scene, entry: TaintFact) {

        let ptaConfig = PointerAnalysisConfig.create(1, "./out");
        let pta: PointerAnalysis | undefined = PointerAnalysis.pointerAnalysisForWholeProject(scene, ptaConfig);

        const problem = new LightTaintAnalysisChecker(stmt, stmt.getCfg().getDeclaringMethod(), pta);
        problem.addSinksFromJson("tests/resources/sink_gpt4.jsonl");
        problem.addSourcesFromJson("tests/resources/source_gpt4.jsonl");
        problem.addSantizationsFromJson("tests/resources/santizationPath.json")
        const solver = new LightTaintAnalysisSolver(problem, scene, pta, entry);
        solver.solve();
        const o = problem.getOutcome()
        this.outcome.push(...o);
    }

    public begin() {
        let sources: Map<string, Source> = new Map();
        const data = fs.readFileSync("tests/resources/source_gpt4.jsonl", 'utf-8');
        const objects = JSON.parse(data)
        for (const object of objects) {
            const methodSignatures = Json2ArkMethod_LLM(object.module, object.api_name, this.scene);
            for (const ms of methodSignatures) {
                let sourceType = 'return', sourceIndex = -1, callbackIndex = -1;
                if (ms.getType() instanceof VoidType) {
                    for (let i = 0; i < ms.getParamLength(); i++) {
                        const paramType = ms.getMethodSubSignature().getParameterTypes()[i];
                        if (paramType.getTypeString().includes('Want')) {
                            sourceType = 'ArgIn';
                            sourceIndex = i + 1;
                            break;
                        }
                        if (paramType.getTypeString().includes('AsyncCallback<')) {
                            sourceType = 'callback';
                            sourceIndex = 2;
                            callbackIndex = i + 1;
                            break;
                        }
                    }
                }
            }
        }

        let callGraph = new CallGraph(this.scene)
        let cgBuilder = new CallGraphBuilder(callGraph, this.scene);
        let cha = new ClassHierarchyAnalysis(this.scene, callGraph, cgBuilder);
        cha.start(true);

        for (const source of sources.values()) {
            const m = source.methodSignature;
            // Workaround: getInvokeStmtByMethod not in this ArkAnalyzer version
            const stmts: Stmt[] = [];
            for (const method of this.scene.getMethods()) {
                const cfg = method.getCfg();
                if (!cfg) continue;
                for (const s of cfg.getStmts()) {
                    if (s.containsInvokeExpr()) {
                        const invokeExpr = s.getInvokeExpr();
                        if (invokeExpr && invokeExpr.getMethodSignature().toString() === m.toString()) {
                            stmts.push(s);
                        }
                    }
                }
            }
            for (const stmt of stmts) {
                let entry: TaintFact | undefined = undefined;
                if (source.sourceType == "return" && stmt instanceof ArkAssignStmt) {
                    entry = new TaintFact(stmt.getLeftOp(), [stmt]);
                    for (const nextStmt of this.getNextStmt(stmt)) {
                        this.taintStart(nextStmt, this.scene, entry);
                    }
                } else if (source.sourceType == "callback" && stmt.getInvokeExpr()) {
                    const arg = stmt.getInvokeExpr()!.getArgs()[source.callbackIndex];
                    const methodSignature = (arg.getType() as ClosureType).getMethodSignature();
                    const callbackMethod = stmt.getCfg()?.getDeclaringMethod().getDeclaringArkClass().getMethod(methodSignature);
                    if (callbackMethod) {
                        entry = new TaintFact(callbackMethod.getParameterInstances()[source.sourceIndex + (callbackMethod.getParameters()[0].getType() instanceof LexicalEnvType ? 1 : 0)], [stmt]);
                        this.taintStart(stmt, this.scene, entry);
                    }
                }
            }

            if (source.sourceType == "ArgIn") {
                for (const cls of this.scene.getClasses().filter((c) => classInheritsAbility(c))) {
                    for (const mtd of cls.getMethods()) {
                        if (source.methodSignature.getMethodSubSignature().toString() == mtd.getSignature().getMethodSubSignature().toString()) {
                            const param = mtd.getParameterInstances()[source.sourceIndex + (mtd.getParameters()[0].getType() instanceof LexicalEnvType ? 1 : 0)];
                            const stmt = getThisAssignStmt(mtd);
                            this.taintStart(stmt, this.scene, new TaintFact(param, [stmt]));
                        }
                    }
                }
            }
        }
    }

    public getOutcome(): TaintFact[] {
        return this.outcome;
    }
}
