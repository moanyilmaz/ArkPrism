"use strict";
/*
 * Copyright (c) 2024 Huawei Device Co., Ltd.
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.ClassHierarchyAnalysis = void 0;
const Expr_1 = require("../../core/base/Expr");
const CallGraph_1 = require("../model/CallGraph");
const AbstractAnalysis_1 = require("./AbstractAnalysis");
class ClassHierarchyAnalysis extends AbstractAnalysis_1.AbstractAnalysis {
    constructor(scene, cg) {
        super(scene);
        this.cg = cg;
    }
    resolveCall(callerMethod, invokeStmt) {
        let invokeExpr = invokeStmt.getInvokeExpr();
        let resolveResult = [];
        if (!invokeExpr) {
            return [];
        }
        // process anonymous method call
        this.getParamAnonymousMethod(invokeExpr).forEach(method => {
            resolveResult.push(new CallGraph_1.CallSite(invokeStmt, undefined, this.cg.getCallGraphNodeByMethod(method).getID(), callerMethod));
        });
        let calleeMethod = this.resolveInvokeExpr(invokeExpr);
        if (!calleeMethod) {
            return resolveResult;
        }
        if (invokeExpr instanceof Expr_1.ArkStaticInvokeExpr) {
            // get specific method
            resolveResult.push(new CallGraph_1.CallSite(invokeStmt, undefined, this.cg.getCallGraphNodeByMethod(calleeMethod.getSignature()).getID(), callerMethod));
        }
        else {
            let declareClass = calleeMethod.getDeclaringArkClass();
            // TODO: super class method should be placed at the end
            this.getClassHierarchy(declareClass).forEach((arkClass) => {
                if (arkClass.isAbstract()) {
                    return;
                }
                let possibleCalleeMethod = arkClass.getMethodWithName(calleeMethod.getName());
                if (possibleCalleeMethod && possibleCalleeMethod.isGenerated() &&
                    arkClass.getSignature().toString() !== declareClass.getSignature().toString()) {
                    // remove the generated method in extended classes
                    return;
                }
                if (possibleCalleeMethod && !possibleCalleeMethod.isAbstract()) {
                    resolveResult.push(new CallGraph_1.CallSite(invokeStmt, undefined, this.cg.getCallGraphNodeByMethod(possibleCalleeMethod.getSignature()).getID(), callerMethod));
                }
            });
        }
        return resolveResult;
    }
    preProcessMethod() {
        // do nothing
        return [];
    }
}
exports.ClassHierarchyAnalysis = ClassHierarchyAnalysis;
