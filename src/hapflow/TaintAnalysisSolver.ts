import { ArkInvokeStmt, Stmt } from "../arkanalyzer";
import { DataflowProblem, FlowFunction } from "../arkanalyzer";
import { PathEdge, PathEdgePoint } from "../arkanalyzer";
import { Scene } from "../arkanalyzer";
import { ClassHierarchyAnalysis, RapidTypeAnalysis } from "../arkanalyzer";
import { DataflowSolver } from "./DataflowSolver";
import { TaintAnalysisChecker } from "./TaintAnalysis";
import { TaintFact } from "./TaintFact";
import { Local } from "../arkanalyzer";
import { ArkArrayRef, ArkInstanceFieldRef } from "../arkanalyzer";
import { FunctionType } from "../arkanalyzer";
import { PointerAnalysis } from "../arkanalyzer";
import { LightTaintAnalysisChecker } from "./LightTaintAnalysis";

export class TaintAnalysisSolver extends DataflowSolver<TaintFact> {
    protected problem!: TaintAnalysisChecker;
    constructor(problem: TaintAnalysisChecker | LightTaintAnalysisChecker, scene: Scene, pta?: PointerAnalysis, entryFact?: TaintFact, externalCG?: ClassHierarchyAnalysis | RapidTypeAnalysis) {
        super(problem, scene, pta, entryFact, externalCG);
    }
}

export class LightTaintAnalysisSolver extends TaintAnalysisSolver {
    constructor(problem: TaintAnalysisChecker | LightTaintAnalysisChecker, scene: Scene, pta?: PointerAnalysis, entryFact?: TaintFact, externalCG?: ClassHierarchyAnalysis | RapidTypeAnalysis) {
        super(problem, scene, pta, entryFact, externalCG);
    }


    protected getCallEdgePoints(edge: PathEdge<TaintFact>): Set<PathEdgePoint<TaintFact>> {
        let startEdgePoint = edge.edgeStart;
        let exitEdgePoint = edge.edgeEnd;
        let callEdgePoints = this.inComing.get(startEdgePoint);
        if (callEdgePoints == undefined) {
            const mtd = exitEdgePoint.node.getCfg().getDeclaringMethod();
            callEdgePoints = new Set();
            // Workaround: getInvokeStmtByMethod not available in this ArkAnalyzer version
            // Scan all methods for invoke statements targeting this method
            for (const m of this.scene.getMethods()) {
                const cfg = m.getCfg();
                if (!cfg) continue;
                for (const stmt of cfg.getStmts()) {
                    if (stmt.containsInvokeExpr()) {
                        const invokeExpr = stmt.getInvokeExpr();
                        if (invokeExpr && invokeExpr.getMethodSignature().toString() === mtd.getSignature().toString()) {
                            let edgePoint = new PathEdgePoint<TaintFact>(stmt, this.zeroFact);
                            callEdgePoints.add(edgePoint);
                        }
                    }
                }
            }
        }
        return callEdgePoints;
    }

    protected propagateIfExitCalled(callEdgePoint: PathEdgePoint<TaintFact>, returnSitePoint: PathEdgePoint<TaintFact>): void {
        let propagated = false;
        let startOfCaller: Stmt = this.getStartStmt(callEdgePoint.node);
        for (let pathEdge of this.pathEdgeSet) {
            if (pathEdge.edgeStart.node == startOfCaller && pathEdge.edgeEnd == callEdgePoint) {
                this.propagate(new PathEdge<TaintFact>(pathEdge.edgeStart, returnSitePoint));
                propagated = true;
            }
        }
        if (!propagated) {
            this.propagate(new PathEdge<TaintFact>(callEdgePoint, returnSitePoint));
        }
    }
}
