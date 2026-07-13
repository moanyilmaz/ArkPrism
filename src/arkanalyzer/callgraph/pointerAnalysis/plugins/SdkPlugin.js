"use strict";
/*
 * Copyright (c) 2025 Huawei Device Co., Ltd.
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
exports.SdkPlugin = void 0;
const Expr_1 = require("../../../core/base/Expr");
const Local_1 = require("../../../core/base/Local");
const Stmt_1 = require("../../../core/base/Stmt");
const Type_1 = require("../../../core/base/Type");
const Pag_1 = require("../Pag");
const PTAUtils_1 = require("../PTAUtils");
/**
 * SdkPlugin processes OpenHarmony and built-in SDK APIs.
 * creates fake PAG nodes for SDK method return values and parameters.
 */
class SdkPlugin {
    constructor(pag, pagBuilder, cg) {
        this.pag = pag;
        this.pagBuilder = pagBuilder;
        this.cg = cg;
        this.sdkMethodReturnValueMap = new Map();
        this.methodParamValueMap = new Map();
        this.fakeSdkMethodParamDeclaringStmt = new Stmt_1.ArkAssignStmt(new Local_1.Local(''), new Local_1.Local(''));
    }
    getName() {
        return 'SdkPlugin';
    }
    canHandle(cs, cgNode) {
        let methodType = (0, PTAUtils_1.getBuiltInApiType)(cgNode.getMethod());
        return cgNode.isSdkMethod() && (methodType === PTAUtils_1.BuiltApiType.NotBuiltIn);
    }
    processCallSite(cs, cid, basePTNode) {
        let srcNodes = [];
        this.addSDKMethodPagCallEdge(cs, cid, 0, srcNodes);
        return srcNodes;
    }
    addSDKMethodPagCallEdge(cs, callerCid, calleeCid, srcNodes) {
        let calleeFuncID = cs.getCalleeFuncID();
        let calleeNode = this.cg.getNode(calleeFuncID);
        let calleeMethod = this.cg.getArkMethodByFuncID(calleeFuncID);
        if (!calleeMethod) {
            return;
        }
        if (!this.methodParamValueMap.has(calleeNode.getID())) {
            this.buildSDKFuncPag(calleeNode.getID(), calleeMethod);
        }
        this.addSDKMethodReturnPagEdge(cs, callerCid, calleeCid, calleeMethod, srcNodes);
        this.addSDKMethodParamPagEdge(cs, callerCid, calleeCid, calleeNode.getID(), srcNodes);
        return;
    }
    /**
     * will not create real funcPag, only create param values
     */
    buildSDKFuncPag(funcID, sdkMethod) {
        let paramArr = this.createDummyParamValue(sdkMethod);
        this.methodParamValueMap.set(funcID, paramArr);
    }
    createDummyParamValue(sdkMethod) {
        let args = sdkMethod.getParameters();
        let paramArr = [];
        if (!args) {
            return paramArr;
        }
        // Local
        args.forEach((arg) => {
            let argInstance = new Local_1.Local(arg.getName(), arg.getType());
            argInstance.setDeclaringStmt(this.fakeSdkMethodParamDeclaringStmt);
            paramArr.push(argInstance);
        });
        return paramArr;
    }
    addSDKMethodReturnPagEdge(cs, callerCid, calleeCid, calleeMethod, srcNodes) {
        let returnType = calleeMethod.getReturnType();
        if (!(returnType instanceof Type_1.ClassType) || !(cs.callStmt instanceof Stmt_1.ArkAssignStmt)) {
            return;
        }
        // check fake heap object exists or not
        let cidMap = this.sdkMethodReturnValueMap.get(calleeMethod);
        if (!cidMap) {
            cidMap = new Map();
        }
        let newExpr = cidMap.get(calleeCid);
        if (!newExpr) {
            if (returnType instanceof Type_1.ClassType) {
                newExpr = new Expr_1.ArkNewExpr(returnType);
            }
        }
        cidMap.set(calleeCid, newExpr);
        this.sdkMethodReturnValueMap.set(calleeMethod, cidMap);
        let srcPagNode = this.pagBuilder.getOrNewPagNode(calleeCid, newExpr);
        let dstPagNode = this.pagBuilder.getOrNewPagNode(callerCid, cs.callStmt.getLeftOp(), cs.callStmt);
        this.pag.addPagEdge(srcPagNode, dstPagNode, Pag_1.PagEdgeKind.Address, cs.callStmt);
        srcNodes.push(srcPagNode.getID());
        return;
    }
    /**
     * process the anonymous method param, create a new CallSite for it and invoke it.
     */
    addSDKMethodParamPagEdge(cs, callerCid, calleeCid, funcID, srcNodes) {
        var _a, _b;
        let argNum = (_a = cs.args) === null || _a === void 0 ? void 0 : _a.length;
        if (!argNum) {
            return;
        }
        // add args to parameters edges
        for (let i = 0; i < argNum; i++) {
            let arg = (_b = cs.args) === null || _b === void 0 ? void 0 : _b[i];
            let paramValue;
            if (arg instanceof Local_1.Local && arg.getType() instanceof Type_1.FunctionType) {
                paramValue = this.methodParamValueMap.get(funcID)[i];
            }
            else {
                continue;
            }
            if (!(arg && paramValue)) {
                continue;
            }
            // Get or create new PAG node for argument and parameter
            let srcPagNode = this.pagBuilder.getOrNewPagNode(callerCid, arg, cs.callStmt);
            let dstPagNode = this.pagBuilder.getOrNewPagNode(calleeCid, paramValue, cs.callStmt);
            if (dstPagNode instanceof Pag_1.PagLocalNode) {
                // set the fake param Value in PagLocalNode
                /**
                 * TODO: !!!
                 * some API param is in the form of anonymous method:
                 *  component/common.d.ts
                 *  declare function animateTo(value: AnimateParam, event: () => void): void;
                 *
                 * this param fake Value will create PagFuncNode rather than PagLocalNode
                 * when this API is called, the anonymous method pointer will not be able to pass into the fake Value PagNode
                 */
                dstPagNode.setSdkParam();
                let sdkParamInvokeStmt = new Stmt_1.ArkInvokeStmt(new Expr_1.ArkPtrInvokeExpr(arg.getType().getMethodSignature(), paramValue, []));
                // create new DynCallSite
                let sdkParamCallSite = this.cg.getCallSiteManager().newDynCallSite(sdkParamInvokeStmt, undefined, undefined, funcID);
                dstPagNode.addRelatedDynCallSite(sdkParamCallSite);
            }
            this.pag.addPagEdge(srcPagNode, dstPagNode, Pag_1.PagEdgeKind.Copy, cs.callStmt);
            srcNodes.push(srcPagNode.getID());
        }
        return;
    }
    getParamValues(method) {
        const funcID = this.cg.getCallGraphNodeByMethod(method.getSignature()).getID();
        return this.methodParamValueMap.get(funcID);
    }
}
exports.SdkPlugin = SdkPlugin;
