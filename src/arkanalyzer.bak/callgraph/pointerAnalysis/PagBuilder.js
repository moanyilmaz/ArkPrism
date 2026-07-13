"use strict";
/*
 * Copyright (c) 2024-2025 Huawei Device Co., Ltd.
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
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.PagBuilder = exports.CSFuncID = void 0;
const CallGraph_1 = require("../model/CallGraph");
const Stmt_1 = require("../../core/base/Stmt");
const Expr_1 = require("../../core/base/Expr");
const Ref_1 = require("../../core/base/Ref");
const logger_1 = __importStar(require("../../utils/logger"));
const Local_1 = require("../../core/base/Local");
const Type_1 = require("../../core/base/Type");
const Constant_1 = require("../../core/base/Constant");
const Statistics_1 = require("../common/Statistics");
const Context_1 = require("./Context");
const Pag_1 = require("./Pag");
const TSConst_1 = require("../../core/common/TSConst");
const Const_1 = require("../../core/common/Const");
const PTAUtils_1 = require("./PTAUtils");
const PointerAnalysisConfig_1 = require("./PointerAnalysisConfig");
const logger = logger_1.default.getLogger(logger_1.LOG_MODULE_TYPE.ARKANALYZER, 'PTA');
class CSFuncID {
    constructor(cid, fid) {
        this.cid = cid;
        this.funcID = fid;
    }
}
exports.CSFuncID = CSFuncID;
class PagBuilder {
    constructor(p, cg, s, kLimit) {
        this.handledFunc = new Set();
        this.worklist = [];
        // TODO: change string to hash value
        this.staticField2UniqInstanceMap = new Map();
        this.instanceField2UniqInstanceMap = new Map();
        this.cid2ThisRefPtMap = new Map();
        this.cid2ThisRefMap = new Map();
        this.cid2ThisLocalMap = new Map();
        this.sdkMethodReturnValueMap = new Map();
        // record the SDK API param, and create fake Values
        this.sdkMethodParamValueMap = new Map();
        this.fakeSdkMethodParamDeclaringStmt = new Stmt_1.ArkAssignStmt(new Local_1.Local(""), new Local_1.Local(""));
        this.funcHandledThisRound = new Set();
        this.updatedNodesThisRound = new Map();
        this.singletonFuncMap = new Map();
        this.globalThisValue = new Local_1.Local(TSConst_1.GLOBAL_THIS_NAME);
        this.storagePropertyMap = new Map();
        this.externalScopeVariableMap = new Map();
        this.pag = p;
        this.cg = cg;
        this.funcPags = new Map;
        this.ctx = new Context_1.KLimitedContextSensitive(kLimit);
        this.scene = s;
        this.pagStat = new Statistics_1.PAGStat();
    }
    buildFuncPagAndAddToWorklist(cs) {
        if (this.worklist.includes(cs)) {
            return cs;
        }
        this.buildFuncPag(cs.funcID);
        if (this.isSingletonFunction(cs.funcID)) {
            cs.cid = Context_1.DUMMY_CID;
        }
        this.worklist.push(cs);
        return cs;
    }
    addToFuncHandledListThisRound(id) {
        if (this.funcHandledThisRound.has(id)) {
            return;
        }
        this.funcHandledThisRound.add(id);
    }
    buildForEntries(funcIDs) {
        this.worklist = [];
        funcIDs.forEach(funcID => {
            let cid = this.ctx.getNewContextID(funcID);
            let csFuncID = new CSFuncID(cid, funcID);
            this.buildFuncPagAndAddToWorklist(csFuncID);
        });
        this.handleReachable();
        this.globalThisPagNode = this.getOrNewGlobalThisNode(-1);
        this.pag.addPagEdge(this.globalThisPagNode, this.globalThisPagNode, Pag_1.PagEdgeKind.Copy);
    }
    handleReachable() {
        if (this.worklist.length === 0) {
            return false;
        }
        this.funcHandledThisRound.clear();
        while (this.worklist.length > 0) {
            let csFunc = this.worklist.shift();
            this.buildPagFromFuncPag(csFunc.funcID, csFunc.cid);
            this.addToFuncHandledListThisRound(csFunc.funcID);
        }
        return true;
    }
    build() {
        for (let funcID of this.cg.getEntries()) {
            let cid = this.ctx.getNewContextID(funcID);
            let csFuncID = new CSFuncID(cid, funcID);
            this.buildFuncPagAndAddToWorklist(csFuncID);
            this.handleReachable();
        }
    }
    buildFuncPag(funcID) {
        if (this.funcPags.has(funcID)) {
            return false;
        }
        let arkMethod = this.cg.getArkMethodByFuncID(funcID);
        if (arkMethod == null) {
            return false;
        }
        let cfg = arkMethod.getCfg();
        if (!cfg) {
            this.buildSDKFuncPag(funcID);
            return false;
        }
        logger.trace(`[build FuncPag] ${arkMethod.getSignature().toString()}`);
        let fpag = new Pag_1.FuncPag();
        for (let stmt of cfg.getStmts()) {
            if (stmt instanceof Stmt_1.ArkAssignStmt) {
                stmt.getRightOp().getUses().forEach((v) => {
                    this.handleValueFromExternalScope(v, funcID);
                });
                // Add non-call edges
                let kind = this.getEdgeKindForAssignStmt(stmt);
                if (kind !== Pag_1.PagEdgeKind.Unknown) {
                    fpag.addInternalEdge(stmt, kind);
                    continue;
                }
                // handle call
                let ivkExpr = stmt.getInvokeExpr();
                if (ivkExpr instanceof Expr_1.ArkStaticInvokeExpr) {
                    let cs = this.cg.getCallSiteByStmt(stmt);
                    if (cs) {
                        // direct call is already existing in CG
                        // TODO: API Invoke stmt has anonymous method param, how to add these param into callee
                        fpag.addNormalCallSite(cs);
                        if (ivkExpr.getMethodSignature().getDeclaringClassSignature()
                            .getDeclaringFileSignature().getFileName() === Const_1.UNKNOWN_FILE_NAME) {
                            fpag.addUnknownCallSite(cs);
                            continue;
                        }
                    }
                    else {
                        throw new Error('Can not find static callsite');
                    }
                }
                else if (ivkExpr instanceof Expr_1.ArkInstanceInvokeExpr || ivkExpr instanceof Expr_1.ArkPtrInvokeExpr) {
                    let ptcs = this.cg.getDynCallsiteByStmt(stmt);
                    if (ptcs) {
                        this.addToDynamicCallSite(fpag, ptcs);
                    }
                }
            }
            else if (stmt instanceof Stmt_1.ArkInvokeStmt) {
                // TODO: discuss if we need a invokeStmt
                let cs = this.cg.getCallSiteByStmt(stmt);
                if (cs) {
                    // direct call or constructor call is already existing in CG
                    // TODO: some ptr invoke stmt is recognized as Static invoke in tests/resources/callgraph/funPtrTest1/fnPtrTest4.ts
                    // TODO: instance invoke(ptr invoke)
                    if (this.cg.isUnknownMethod(cs.calleeFuncID)) {
                        fpag.addUnknownCallSite(cs);
                    }
                    else {
                        fpag.addNormalCallSite(cs);
                    }
                    continue;
                }
                let dycs = this.cg.getDynCallsiteByStmt(stmt);
                if (dycs) {
                    this.addToDynamicCallSite(fpag, dycs);
                }
                else {
                    throw new Error('Can not find callsite by stmt');
                }
            }
            else {
                // TODO: need handle other type of stmt?
            }
        }
        this.funcPags.set(funcID, fpag);
        this.pagStat.numTotalFunction++;
        return true;
    }
    /**
     * will not create real funcPag, only create param values
     */
    buildSDKFuncPag(funcID) {
        var _a;
        // check if SDK method
        let cgNode = this.cg.getNode(funcID);
        if (!cgNode.isSdkMethod()) {
            return;
        }
        let args = (_a = this.cg.getArkMethodByFuncID(funcID)) === null || _a === void 0 ? void 0 : _a.getParameters();
        if (!args) {
            return;
        }
        let paramArr = [];
        args.forEach((arg) => {
            let argInstance = new Local_1.Local(arg.getName(), arg.getType());
            argInstance.setDeclaringStmt(this.fakeSdkMethodParamDeclaringStmt);
            paramArr.push(argInstance);
        });
        this.sdkMethodParamValueMap.set(funcID, paramArr);
    }
    buildPagFromFuncPag(funcID, cid) {
        var _a;
        let funcPag = this.funcPags.get(funcID);
        if (funcPag === undefined) {
            return;
        }
        if (this.handledFunc.has(`${cid}-${funcID}`)) {
            return;
        }
        this.addEdgesFromFuncPag(funcPag, cid);
        let interFuncPag = (_a = this.interFuncPags) === null || _a === void 0 ? void 0 : _a.get(funcID);
        if (interFuncPag) {
            this.addEdgesFromInterFuncPag(interFuncPag, cid);
        }
        this.addCallsEdgesFromFuncPag(funcPag, cid);
        this.addDynamicCallSite(funcPag, funcID);
        this.addUnknownCallSite(funcPag, funcID);
        this.handledFunc.add(`${cid}-${funcID}`);
    }
    /// Add Pag Nodes and Edges in function
    addEdgesFromFuncPag(funcPag, cid) {
        let inEdges = funcPag.getInternalEdges();
        if (inEdges === undefined) {
            return false;
        }
        for (let e of inEdges) {
            let srcPagNode = this.getOrNewPagNode(cid, e.src, e.stmt);
            let dstPagNode = this.getOrNewPagNode(cid, e.dst, e.stmt);
            this.pag.addPagEdge(srcPagNode, dstPagNode, e.kind, e.stmt);
            // Take place of the real stmt for return
            if (dstPagNode.getStmt() instanceof Stmt_1.ArkReturnStmt) {
                dstPagNode.setStmt(e.stmt);
            }
        }
        return true;
    }
    /// add Copy edges interprocedural
    addCallsEdgesFromFuncPag(funcPag, cid) {
        for (let cs of funcPag.getNormalCallSites()) {
            let ivkExpr = cs.callStmt.getInvokeExpr();
            let calleeCid = this.ctx.getOrNewContext(cid, cs.calleeFuncID, true);
            let calleeCGNode = this.cg.getNode(cs.calleeFuncID);
            // process the Storage API(Static)
            if (!this.processStorage(cs, calleeCGNode, cid)) {
                // If not Storage API, process normal edge
                this.addStaticPagCallEdge(cs, cid, calleeCid);
            }
            // Add edge to thisRef for special calls
            if (calleeCGNode.getKind() === CallGraph_1.CallGraphNodeKind.constructor ||
                calleeCGNode.getKind() === CallGraph_1.CallGraphNodeKind.intrinsic) {
                let callee = this.scene.getMethod(this.cg.getMethodByFuncID(cs.calleeFuncID));
                if (ivkExpr instanceof Expr_1.ArkInstanceInvokeExpr) {
                    let baseNode = this.getOrNewPagNode(cid, ivkExpr.getBase());
                    let baseNodeID = baseNode.getID();
                    this.addThisRefCallEdge(baseNodeID, cid, ivkExpr, callee, calleeCid, cs.callerFuncID);
                }
                else {
                    logger.error(`constructor or intrinsic func is static ${ivkExpr.toString()}`);
                }
            }
        }
        return true;
    }
    /**
     * process Storage API
     * @returns boolean: check if the cs represent a Storage API, no matter the API will success or fail
     */
    processStorage(cs, calleeCGNode, cid) {
        let storageName = calleeCGNode.getMethod().getDeclaringClassSignature().getClassName();
        let storageType = this.getStorageType(storageName, cs, cid);
        // TODO: add other storages
        if (storageType === Pag_1.StorageType.APP_STORAGE) {
            let calleeName = calleeCGNode.getMethod().getMethodSubSignature().getMethodName();
            // TODO: complete AppStorage API
            if (calleeName === 'setOrCreate') {
                this.processStorageSetOrCreate(cs, cid);
            }
            else if (calleeName === 'link') {
                this.processStorageLink(cs, cid);
            }
            else if (calleeName === 'prop') {
                this.processStorageProp(cs, cid);
            }
            else if (calleeName === 'set') {
                this.processStorageSet(cs, cid);
            }
            else if (calleeName === 'get') {
                this.processStorageGet(cs, cid);
            }
            return true;
        }
        else if (storageType === Pag_1.StorageType.LOCAL_STORAGE) {
            // TODO: LocalStorage is not Static
        }
        return false;
    }
    processStorageSetOrCreate(cs, cid) {
        let propertyStr = this.getPropertyName(cs.args[0]);
        if (!propertyStr) {
            return;
        }
        let propertyName = propertyStr;
        let propertyNode = this.getOrNewPropertyNode(Pag_1.StorageType.APP_STORAGE, propertyName, cs.callStmt);
        let storageObj = cs.args[1];
        this.addPropertyLinkEdge(propertyNode, storageObj, cid, cs.callStmt, Pag_1.StorageLinkEdgeType.Local2Property);
    }
    processStorageLink(cs, cid) {
        let propertyStr = this.getPropertyName(cs.args[0]);
        if (!propertyStr) {
            return;
        }
        let propertyName = propertyStr;
        let propertyNode = this.getOrNewPropertyNode(Pag_1.StorageType.APP_STORAGE, propertyName, cs.callStmt);
        let leftOp = cs.callStmt.getLeftOp();
        let linkedOpNode = this.pag.getOrNewNode(cid, leftOp);
        if (linkedOpNode instanceof Pag_1.PagLocalNode) {
            linkedOpNode.setStorageLink(Pag_1.StorageType.APP_STORAGE, propertyName);
        }
        this.pag.addPagEdge(propertyNode, linkedOpNode, Pag_1.PagEdgeKind.Copy);
        this.pag.addPagEdge(linkedOpNode, propertyNode, Pag_1.PagEdgeKind.Copy);
    }
    processStorageProp(cs, cid) {
        let propertyStr = this.getPropertyName(cs.args[0]);
        if (!propertyStr) {
            return;
        }
        let propertyName = propertyStr;
        let propertyNode = this.getOrNewPropertyNode(Pag_1.StorageType.APP_STORAGE, propertyName, cs.callStmt);
        let leftOp = cs.callStmt.getLeftOp();
        let linkedOpNode = this.pag.getOrNewNode(cid, leftOp);
        if (linkedOpNode instanceof Pag_1.PagLocalNode) {
            linkedOpNode.setStorageLink(Pag_1.StorageType.APP_STORAGE, propertyName);
        }
        this.pag.addPagEdge(propertyNode, linkedOpNode, Pag_1.PagEdgeKind.Copy);
    }
    processStorageSet(cs, cid) {
        let ivkExpr = cs.callStmt.getInvokeExpr();
        if (ivkExpr instanceof Expr_1.ArkInstanceInvokeExpr) {
            let base = ivkExpr.getBase();
            let baseNode = this.pag.getOrNewNode(cid, base);
            if (baseNode.isStorageLinked()) {
                let argsNode = this.pag.getOrNewNode(cid, cs.args[0]);
                this.pag.addPagEdge(argsNode, baseNode, Pag_1.PagEdgeKind.Copy);
            }
        }
        else if (ivkExpr instanceof Expr_1.ArkStaticInvokeExpr) {
            // TODO: process AppStorage.set()
        }
    }
    processStorageGet(cs, cid) {
        if (!(cs.callStmt instanceof Stmt_1.ArkAssignStmt)) {
            return;
        }
        let leftOp = cs.callStmt.getLeftOp();
        let ivkExpr = cs.callStmt.getInvokeExpr();
        let propertyName;
        if (ivkExpr instanceof Expr_1.ArkStaticInvokeExpr) {
            let propertyStr = this.getPropertyName(cs.args[0]);
            if (propertyStr) {
                propertyName = propertyStr;
            }
        }
        else if (ivkExpr instanceof Expr_1.ArkInstanceInvokeExpr) {
            let baseNode = this.pag.getOrNewNode(cid, ivkExpr.getBase());
            if (baseNode.isStorageLinked()) {
                propertyName = baseNode.getStorage().PropertyName;
            }
        }
        let propertyNode = this.getPropertyNode(Pag_1.StorageType.APP_STORAGE, propertyName, cs.callStmt);
        if (!propertyNode) {
            return;
        }
        this.pag.addPagEdge(propertyNode, this.pag.getOrNewNode(cid, leftOp, cs.callStmt), Pag_1.PagEdgeKind.Copy, cs.callStmt);
    }
    getPropertyName(value) {
        if (value instanceof Local_1.Local) {
            let type = value.getType();
            if (type instanceof Type_1.StringType) {
                return type.getName();
            }
        }
        else if (value instanceof Constant_1.Constant) {
            return value.getValue();
        }
        return undefined;
    }
    addDynamicCallSite(funcPag, funcID) {
        // add dyn callsite in funcpag to base node
        for (let cs of funcPag.getDynamicCallSites()) {
            let invokeExpr = cs.callStmt.getInvokeExpr();
            let base;
            if (invokeExpr instanceof Expr_1.ArkInstanceInvokeExpr) {
                base = invokeExpr.getBase();
            }
            else if (invokeExpr instanceof Expr_1.ArkPtrInvokeExpr) {
                base = invokeExpr.getFuncPtrLocal();
            }
            // TODO: check base under different cid
            let baseNodeIDs = this.pag.getNodesByValue(base);
            if (!baseNodeIDs) {
                // bind the call site to export base
                let interProceduralLocal = this.getSourceValueFromExternalScope(base, funcID);
                if (interProceduralLocal) {
                    baseNodeIDs = this.pag.getNodesByValue(interProceduralLocal);
                }
            }
            if (!baseNodeIDs) {
                logger.warn(`[build dynamic call site] can not handle call site with base ${base.toString()}`);
                continue;
            }
            for (let nodeID of baseNodeIDs.values()) {
                let node = this.pag.getNode(nodeID);
                if (!(node instanceof Pag_1.PagLocalNode)) {
                    continue;
                }
                node.addRelatedDynCallSite(cs);
            }
        }
    }
    addUnknownCallSite(funcPag, funcID) {
        var _a;
        let method = this.cg.getArkMethodByFuncID(funcID);
        if (!method) {
            throw new Error(`can not find ArkMethod by FuncID ${funcID}`);
        }
        let locals = (_a = method.getBody()) === null || _a === void 0 ? void 0 : _a.getLocals();
        funcPag.getUnknownCallSites().forEach((unknownCallSite) => {
            var _a;
            let calleeName = (_a = unknownCallSite.callStmt.getInvokeExpr()) === null || _a === void 0 ? void 0 : _a.getMethodSignature().getMethodSubSignature().getMethodName();
            let base = locals.get(calleeName);
            if (base) {
                let baseNodeIDs = this.pag.getNodesByValue(base);
                if (!baseNodeIDs) {
                    logger.warn(`[build dynamic call site] can not handle call site with base ${base.toString()}`);
                    return;
                }
                for (let nodeID of baseNodeIDs.values()) {
                    let node = this.pag.getNode(nodeID);
                    if (!(node instanceof Pag_1.PagLocalNode)) {
                        continue;
                    }
                    node.addRelatedUnknownCallSite(unknownCallSite);
                }
            }
        });
    }
    addDynamicCallEdge(cs, baseClassPTNode, cid) {
        let srcNodes = [];
        let ivkExpr = cs.callStmt.getInvokeExpr();
        let ptNode = this.pag.getNode(baseClassPTNode);
        let value = ptNode.getValue();
        let callees = this.getDynamicCallee(ptNode, value, ivkExpr, cs);
        for (let callee of callees) {
            if (!callee) {
                continue;
            }
            // get caller and callee CG node, add param and return value PAG edge
            let dstCGNode = this.cg.getCallGraphNodeByMethod(callee.getSignature());
            let callerNode = this.cg.getNode(cs.callerFuncID);
            if (!callerNode) {
                throw new Error("Can not get caller method node");
            }
            // update call graph
            // TODO: movo to cgbuilder
            this.cg.addDynamicCallEdge(callerNode.getID(), dstCGNode.getID(), cs.callStmt);
            if (!this.cg.detectReachable(dstCGNode.getID(), callerNode.getID())) {
                let calleeCid = this.ctx.getOrNewContext(cid, dstCGNode.getID(), true);
                let staticCS = new CallGraph_1.CallSite(cs.callStmt, cs.args, dstCGNode.getID(), cs.callerFuncID);
                srcNodes.push(...this.processContainerPagCallEdge(staticCS, cid, baseClassPTNode));
                srcNodes.push(...this.addStaticPagCallEdge(staticCS, cid, calleeCid));
                // Pass base's pts to callee's this pointer
                if (!dstCGNode.isSdkMethod() && ivkExpr instanceof Expr_1.ArkInstanceInvokeExpr) {
                    let srcBaseNode = this.addThisRefCallEdge(baseClassPTNode, cid, ivkExpr, callee, calleeCid, cs.callerFuncID);
                    srcNodes.push(srcBaseNode);
                }
            }
        }
        return srcNodes;
    }
    getDynamicCallee(ptNode, value, ivkExpr, cs) {
        let callee = [];
        if (ptNode instanceof Pag_1.PagFuncNode) {
            // function ptr invoke
            let tempCallee = this.scene.getMethod(ptNode.getMethod());
            if (!callee) {
                return callee;
            }
            callee.push(tempCallee);
        }
        else {
            let calleeName = ivkExpr.getMethodSignature().getMethodSubSignature().getMethodName();
            // instance method invoke
            if (!(value instanceof Expr_1.ArkNewExpr || value instanceof Expr_1.ArkNewArrayExpr)) {
                return callee;
            }
            let tempCallee;
            // try to get callee by MethodSignature
            if (value instanceof Expr_1.ArkNewExpr) {
                // get class signature
                let clsSig = value.getType().getClassSignature();
                let cls;
                cls = this.scene.getClass(clsSig);
                while (!tempCallee && cls) {
                    tempCallee = cls.getMethodWithName(calleeName);
                    cls = cls.getSuperClass();
                }
                if (!tempCallee) {
                    tempCallee = this.scene.getMethod(ivkExpr.getMethodSignature());
                }
            }
            if (!tempCallee && cs.args) {
                // while pts has {o_1, o_2} and invoke expr represents a method that only {o_1} has
                // return empty node when {o_2} come in
                // try to get callee by anonymous method in param
                for (let arg of cs.args) {
                    // TODO: anonymous method param and return value pointer pass
                    let argType = arg.getType();
                    if (argType instanceof Type_1.FunctionType) {
                        callee.push(this.scene.getMethod(argType.getMethodSignature()));
                    }
                }
            }
            else if (tempCallee) {
                callee.push(tempCallee);
            }
        }
        return callee;
    }
    addUpdatedNode(nodeID, diffPT) {
        var _a;
        let ptaConfig = PointerAnalysisConfig_1.PointerAnalysisConfig.getInstance();
        let updatedNode = (_a = this.updatedNodesThisRound.get(nodeID)) !== null && _a !== void 0 ? _a : new ptaConfig.ptsCollectionCtor();
        updatedNode.union(diffPT);
        this.updatedNodesThisRound.set(nodeID, updatedNode);
    }
    getUpdatedNodes() {
        return this.updatedNodesThisRound;
    }
    resetUpdatedNodes() {
        this.updatedNodesThisRound.clear();
    }
    handleUnkownDynamicCall(cs, cid) {
        var _a;
        let srcNodes = [];
        let callerNode = this.cg.getNode(cs.callerFuncID);
        let ivkExpr = cs.callStmt.getInvokeExpr();
        logger.warn("Handling unknown dyn call site : \n  " + callerNode.getMethod().toString()
            + '\n  --> ' + ivkExpr.toString() + '\n  CID: ' + cid);
        let callees = [];
        let callee = null;
        callee = this.scene.getMethod(ivkExpr.getMethodSignature());
        if (!callee) {
            (_a = cs.args) === null || _a === void 0 ? void 0 : _a.forEach(arg => {
                if (arg.getType() instanceof Type_1.FunctionType) {
                    callee = this.scene.getMethod(arg.getType().getMethodSignature());
                    if (callee) {
                        callees.push(callee);
                    }
                }
            });
        }
        else {
            callees.push(callee);
        }
        if (callees.length === 0) {
            return srcNodes;
        }
        callees.forEach(callee => {
            let dstCGNode = this.cg.getCallGraphNodeByMethod(callee.getSignature());
            if (!callerNode) {
                throw new Error("Can not get caller method node");
            }
            if (this.processStorage(cs, dstCGNode, cid)) {
                if (ivkExpr.getArgs().length !== 0) {
                    // for AppStorage.set() instance invoke, add obj to reanalyze list
                    let argsNode = this.pag.getOrNewNode(cid, cs.args[0]);
                    srcNodes.push(argsNode.getID());
                }
            }
            logger.warn(`\tAdd call edge of unknown call ${callee.getSignature().toString()}`);
            this.cg.addDynamicCallEdge(callerNode.getID(), dstCGNode.getID(), cs.callStmt);
            if (!this.cg.detectReachable(dstCGNode.getID(), callerNode.getID())) {
                let calleeCid = this.ctx.getOrNewContext(cid, dstCGNode.getID(), true);
                let staticCS = new CallGraph_1.CallSite(cs.callStmt, cs.args, dstCGNode.getID(), cs.callerFuncID);
                let staticSrcNodes = this.addStaticPagCallEdge(staticCS, cid, calleeCid);
                srcNodes.push(...staticSrcNodes);
            }
        });
        return srcNodes;
    }
    handleUnprocessedCallSites(processedCallSites) {
        let reAnalyzeNodes = [];
        for (let funcID of this.funcHandledThisRound) {
            let funcPag = this.funcPags.get(funcID);
            if (!funcPag) {
                logger.error(`can not find funcPag of handled func ${funcID}`);
                continue;
            }
            let callSites = funcPag.getDynamicCallSites();
            const diffCallSites = new Set(Array.from(callSites).filter(item => !processedCallSites.has(item)));
            diffCallSites.forEach((cs) => {
                let ivkExpr = cs.callStmt.getInvokeExpr();
                if (!(ivkExpr instanceof Expr_1.ArkInstanceInvokeExpr)) {
                    return;
                }
                // Get local of base class
                let base = ivkExpr.getBase();
                // TODO: remove this after multiple this local fixed
                base = this.getRealThisLocal(base, cs.callerFuncID);
                // Get PAG nodes for this base's local
                let ctx2NdMap = this.pag.getNodesByValue(base);
                if (!ctx2NdMap) {
                    return;
                }
                for (let [cid] of ctx2NdMap.entries()) {
                    reAnalyzeNodes.push(...this.handleUnkownDynamicCall(cs, cid));
                }
            });
        }
        return reAnalyzeNodes;
    }
    addThisRefCallEdge(baseClassPTNode, cid, ivkExpr, callee, calleeCid, callerFunID) {
        var _a;
        if (!callee || !callee.getCfg()) {
            logger.error(`callee is null`);
            return -1;
        }
        let thisAssignStmt = (_a = callee.getCfg()) === null || _a === void 0 ? void 0 : _a.getStmts().filter(s => s instanceof Stmt_1.ArkAssignStmt && s.getRightOp() instanceof Ref_1.ArkThisRef);
        let thisPtr = (thisAssignStmt === null || thisAssignStmt === void 0 ? void 0 : thisAssignStmt.at(0)).getRightOp();
        if (!thisPtr) {
            throw new Error('Can not get this ptr');
        }
        // IMPORTANT: set cid 2 base Pt info firstly
        this.cid2ThisRefPtMap.set(calleeCid, baseClassPTNode);
        let thisRefNode = this.getOrNewThisRefNode(calleeCid, thisPtr);
        thisRefNode.addPTNode(baseClassPTNode);
        let srcBaseLocal = ivkExpr.getBase();
        srcBaseLocal = this.getRealThisLocal(srcBaseLocal, callerFunID);
        let srcNodeId = this.pag.hasCtxNode(cid, srcBaseLocal);
        if (!srcNodeId) {
            // this check is for export local and closure use
            // replace the invoke base, because its origin base has no pag node
            let interProceduralLocal = this.getSourceValueFromExternalScope(srcBaseLocal, callerFunID);
            if (interProceduralLocal) {
                srcNodeId = this.pag.hasCtxNode(cid, interProceduralLocal);
            }
        }
        if (!srcNodeId) {
            throw new Error('Can not get base node');
        }
        this.pag.addPagEdge(this.pag.getNode(srcNodeId), thisRefNode, Pag_1.PagEdgeKind.This);
        return srcNodeId;
    }
    /*
     * Add copy edges from arguments to parameters
     *     ret edges from return values to callsite
     * Return src node
     */
    addStaticPagCallEdge(cs, callerCid, calleeCid) {
        var _a, _b;
        if (!calleeCid) {
            calleeCid = this.ctx.getOrNewContext(callerCid, cs.calleeFuncID, true);
        }
        let srcNodes = [];
        // Add reachable
        let calleeNode = this.cg.getNode(cs.calleeFuncID);
        let calleeMethod = this.scene.getMethod(calleeNode.getMethod());
        if (!calleeMethod) {
            // TODO: check if nodes need to delete
            return srcNodes;
        }
        if (calleeNode.isSdkMethod()) {
            srcNodes.push(...this.addSDKMethodPagCallEdge(cs, callerCid, calleeCid));
            return srcNodes;
        }
        if (!calleeMethod.getCfg()) {
            // method have no cfg body
            return srcNodes;
        }
        let calleeCS = this.buildFuncPagAndAddToWorklist(new CSFuncID(calleeCid, cs.calleeFuncID));
        // callee cid will updated if callee is singleton
        calleeCid = calleeCS.cid;
        // TODO: getParameterInstances's performance is not good. Need to refactor 
        let params = calleeMethod.getCfg().getStmts()
            .filter(stmt => stmt instanceof Stmt_1.ArkAssignStmt && stmt.getRightOp() instanceof Ref_1.ArkParameterRef)
            .map(stmt => stmt.getRightOp());
        let argNum = (_a = cs.args) === null || _a === void 0 ? void 0 : _a.length;
        if (argNum) {
            // add args to parameters edges
            for (let i = 0; i < argNum; i++) {
                let arg = (_b = cs.args) === null || _b === void 0 ? void 0 : _b.at(i);
                let param = params.at(i);
                // TODO: param type should be ArkParameterRef?
                if (arg && param) {
                    if (arg instanceof Constant_1.Constant) {
                        continue;
                    }
                    if (arg instanceof Expr_1.AbstractExpr) {
                        // TODO: handle this
                        continue;
                    }
                    // Get or create new PAG node for argument and parameter
                    let srcPagNode = this.getOrNewPagNode(callerCid, arg, cs.callStmt);
                    let dstPagNode = this.getOrNewPagNode(calleeCid, param, cs.callStmt);
                    this.pag.addPagEdge(srcPagNode, dstPagNode, Pag_1.PagEdgeKind.Copy, cs.callStmt);
                    srcNodes.push(srcPagNode.getID());
                }
                // TODO: handle other types of parmeters
            }
        }
        // add ret to caller edges
        let retStmts = calleeMethod.getReturnStmt();
        // TODO: call statement must be a assignment state
        if (cs.callStmt instanceof Stmt_1.ArkAssignStmt) {
            let retDst = cs.callStmt.getLeftOp();
            for (let retStmt of retStmts) {
                let retValue = retStmt.getOp();
                if (retValue instanceof Local_1.Local) {
                    let srcPagNode = this.getOrNewPagNode(calleeCid, retValue, retStmt);
                    let dstPagNode = this.getOrNewPagNode(callerCid, retDst, cs.callStmt);
                    this.pag.addPagEdge(srcPagNode, dstPagNode, Pag_1.PagEdgeKind.Copy, retStmt);
                }
                else if (retValue instanceof Constant_1.Constant) {
                    continue;
                }
                else if (retValue instanceof Expr_1.AbstractExpr) {
                    logger.debug(retValue);
                    continue;
                }
                else {
                    throw new Error('return dst not a local or constant, but: ' + retValue.getType().toString());
                }
            }
        }
        return srcNodes;
    }
    addSDKMethodPagCallEdge(cs, callerCid, calleeCid) {
        let srcNodes = [];
        let calleeNode = this.cg.getNode(cs.calleeFuncID);
        let calleeMethod = this.scene.getMethod(calleeNode.getMethod());
        if (!calleeMethod) {
            return srcNodes;
        }
        // block the container SDK
        if ((0, PTAUtils_1.IsCollectionAPI)(calleeMethod.getSignature())) {
            return srcNodes;
        }
        if (!this.sdkMethodParamValueMap.has(calleeNode.getID())) {
            this.buildSDKFuncPag(calleeNode.getID());
        }
        this.addSDKMethodReturnPagEdge(cs, callerCid, calleeCid, calleeMethod);
        srcNodes.push(...this.addSDKMethodParamPagEdge(cs, callerCid, calleeCid, calleeNode.getID()));
        return srcNodes;
    }
    addSDKMethodReturnPagEdge(cs, callerCid, calleeCid, calleeMethod) {
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
        let srcPagNode = this.getOrNewPagNode(calleeCid, newExpr);
        let dstPagNode = this.getOrNewPagNode(callerCid, cs.callStmt.getLeftOp(), cs.callStmt);
        this.pag.addPagEdge(srcPagNode, dstPagNode, Pag_1.PagEdgeKind.Address, cs.callStmt);
    }
    addSDKMethodParamPagEdge(cs, callerCid, calleeCid, funcID) {
        var _a, _b;
        let argNum = (_a = cs.args) === null || _a === void 0 ? void 0 : _a.length;
        let srcNodes = [];
        if (argNum) {
            // add args to parameters edges
            for (let i = 0; i < argNum; i++) {
                let arg = (_b = cs.args) === null || _b === void 0 ? void 0 : _b.at(i);
                let paramValue;
                if (arg instanceof Local_1.Local && arg.getType() instanceof Type_1.FunctionType) {
                    // TODO: cannot find value
                    paramValue = this.sdkMethodParamValueMap.get(funcID)[i];
                }
                else {
                    continue;
                }
                if (arg && paramValue) {
                    // Get or create new PAG node for argument and parameter
                    let srcPagNode = this.getOrNewPagNode(callerCid, arg, cs.callStmt);
                    let dstPagNode = this.getOrNewPagNode(calleeCid, paramValue, cs.callStmt);
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
                        let sdkParamCallSite = new CallGraph_1.DynCallSite(funcID, sdkParamInvokeStmt, undefined, undefined);
                        dstPagNode.addRelatedDynCallSite(sdkParamCallSite);
                    }
                    this.pag.addPagEdge(srcPagNode, dstPagNode, Pag_1.PagEdgeKind.Copy, cs.callStmt);
                    srcNodes.push(srcPagNode.getID());
                }
            }
        }
        return srcNodes;
    }
    processContainerPagCallEdge(cs, cid, baseClassPTNode) {
        let srcNodes = [];
        let calleeNode = this.cg.getNode(cs.calleeFuncID);
        let calleeMethod = this.scene.getMethod(calleeNode.getMethod());
        let ptNode = this.pag.getNode(baseClassPTNode);
        if (!calleeMethod || !(ptNode instanceof Pag_1.PagNewContainerExprNode)) {
            return srcNodes;
        }
        let containerValue = cs.callStmt.getInvokeExpr().getBase();
        const containerValueProcess = (argIndex) => {
            let srcNode = this.pag.getOrNewNode(cid, cs.args[argIndex], cs.callStmt);
            let realContainerFieldPagNode = this.pag.getOrClonePagContainerFieldNode(baseClassPTNode, undefined, containerValue);
            if (realContainerFieldPagNode) {
                // In some cases, the value of a variable of array type may not be an explicit array object,
                // and the value of `realContainerFieldPagNode` will be undefined.
                this.pag.addPagEdge(srcNode, realContainerFieldPagNode, Pag_1.PagEdgeKind.Copy, cs.callStmt);
                srcNodes.push(srcNode.getID());
            }
        };
        if ((0, PTAUtils_1.IsCollectionSetAdd)(calleeMethod.getSignature())) {
            containerValueProcess(0);
        }
        else if ((0, PTAUtils_1.IsCollectionMapSet)(calleeMethod.getSignature())) {
            containerValueProcess(1);
        }
        return srcNodes;
    }
    getOrNewPagNode(cid, v, s) {
        if (v instanceof Ref_1.ArkThisRef) {
            return this.getOrNewThisRefNode(cid, v);
        }
        // this local is also not uniq!!!
        // remove below block once this issue fixed
        // globalThis process can not be removed while all `globalThis` ref is the same Value
        if (v instanceof Local_1.Local) {
            if (v.getName() === "this") {
                return this.getOrNewThisLoalNode(cid, v, s);
            }
            else if (v.getName() === TSConst_1.GLOBAL_THIS_NAME && v.getDeclaringStmt() == null) {
                // globalThis node has no cid
                return this.getOrNewGlobalThisNode(-1);
            }
        }
        if (v instanceof Ref_1.ArkInstanceFieldRef || v instanceof Ref_1.ArkStaticFieldRef) {
            v = this.getRealInstanceRef(v);
        }
        return this.pag.getOrNewNode(cid, v, s);
    }
    /**
     * return ThisRef PAG node according to cid, a cid has a unique ThisRef node
     * @param cid: current contextID
     */
    getOrNewThisRefNode(cid, v) {
        let thisRefNodeID = this.cid2ThisRefMap.get(cid);
        if (!thisRefNodeID) {
            thisRefNodeID = -1;
        }
        let thisRefNode = this.pag.getOrNewThisRefNode(thisRefNodeID, v);
        this.cid2ThisRefMap.set(cid, thisRefNode.getID());
        return thisRefNode;
    }
    // TODO: remove it once this local not uniq issue is fixed
    getOrNewThisLoalNode(cid, v, s) {
        let thisLocalNodeID = this.cid2ThisLocalMap.get(cid);
        if (thisLocalNodeID) {
            return this.pag.getNode(thisLocalNodeID);
        }
        let thisNode = this.pag.getOrNewNode(cid, v, s);
        this.cid2ThisLocalMap.set(cid, thisNode.getID());
        return thisNode;
    }
    getOrNewGlobalThisNode(cid) {
        return this.pag.getOrNewNode(cid, this.getGlobalThisValue());
    }
    getUniqThisLocalNode(cid) {
        return this.cid2ThisLocalMap.get(cid);
    }
    /**
     * search the storage map to get propertyNode with given storage and propertyFieldName
     * @param storage storage type: AppStorage, LocalStorage etc.
     * @param propertyName string property key
     * @returns propertyNode: PagLocalNode
     */
    getOrNewPropertyNode(storage, propertyName, stmt) {
        let propertyNode = this.getPropertyNode(storage, propertyName, stmt);
        if (propertyNode) {
            return propertyNode;
        }
        let storageMap = this.storagePropertyMap.get(storage);
        let propertyLocal = new Local_1.Local(propertyName);
        storageMap.set(propertyName, propertyLocal);
        this.storagePropertyMap.set(storage, storageMap);
        return this.getOrNewPagNode(-1, propertyLocal, stmt);
    }
    getPropertyNode(storage, propertyName, stmt) {
        let storageMap = this.storagePropertyMap.get(storage);
        let propertyLocal;
        if (!storageMap) {
            storageMap = new Map();
            this.storagePropertyMap.set(storage, storageMap);
        }
        if (storageMap.has(propertyName)) {
            propertyLocal = storageMap.get(propertyName);
        }
        if (propertyLocal) {
            return this.getOrNewPagNode(-1, propertyLocal, stmt);
        }
        return undefined;
    }
    /**
     * add PagEdge
     * @param edgeKind: edge kind differs from API
     * @param propertyNode: PAG node created by protpertyName
     * @param obj: heapObj stored with Storage API
     */
    addPropertyLinkEdge(propertyNode, storageObj, cid, stmt, edgeKind) {
        if (!(storageObj.getType() instanceof Type_1.ClassType)) {
            return false;
        }
        if (edgeKind === Pag_1.StorageLinkEdgeType.Property2Local) {
            // propertyNode --> objNode
            this.pag.addPagEdge(propertyNode, this.pag.getOrNewNode(cid, storageObj), Pag_1.PagEdgeKind.Copy, stmt);
        }
        else if (edgeKind === Pag_1.StorageLinkEdgeType.Local2Property) {
            // propertyNode <-- objNode
            this.pag.addPagEdge(this.pag.getOrNewNode(cid, storageObj), propertyNode, Pag_1.PagEdgeKind.Copy, stmt);
        }
        else if (edgeKind === Pag_1.StorageLinkEdgeType.TwoWay) {
            // propertyNode <-> objNode
            this.pag.addPagEdge(propertyNode, this.pag.getOrNewNode(cid, storageObj), Pag_1.PagEdgeKind.Copy, stmt);
            this.pag.addPagEdge(this.pag.getOrNewNode(cid, storageObj), propertyNode, Pag_1.PagEdgeKind.Copy, stmt);
        }
        return true;
    }
    /*
     * In ArkIR, ArkField has multiple instances for each stmt which use it
     * But the unique one is needed for pointer analysis
     * This is a temp solution to use a ArkField->(first instance)
     *  as the unique instance
     *
     * node merge condition:
     * instance field: value and ArkField
     * static field: ArkField
     */
    getRealInstanceRef(v) {
        if (!(v instanceof Ref_1.ArkInstanceFieldRef || v instanceof Ref_1.ArkStaticFieldRef)) {
            return v;
        }
        let sig = v.getFieldSignature();
        let sigStr = sig.toString();
        let base;
        let real;
        if (v instanceof Ref_1.ArkInstanceFieldRef) {
            base = v.getBase();
            if (base instanceof Local_1.Local && base.getName() === TSConst_1.GLOBAL_THIS_NAME && base.getDeclaringStmt() == null) {
                // replace the base in fieldRef
                base = this.getGlobalThisValue();
                v.setBase(base);
            }
            let key = `${base.getSignature()}-${sigStr}`;
            real = this.instanceField2UniqInstanceMap.get(key);
            if (!real) {
                this.instanceField2UniqInstanceMap.set(key, v);
                real = v;
            }
        }
        else {
            real = this.staticField2UniqInstanceMap.get(sigStr);
            if (!real) {
                this.staticField2UniqInstanceMap.set(sigStr, v);
                real = v;
            }
        }
        return real;
    }
    /**
     * check if a method is singleton function
     * rule: static method, assign heap obj to global var or static field, return the receiver
     */
    isSingletonFunction(funcID) {
        if (this.singletonFuncMap.has(funcID)) {
            return this.singletonFuncMap.get(funcID);
        }
        let arkMethod = this.cg.getArkMethodByFuncID(funcID);
        if (!arkMethod) {
            this.singletonFuncMap.set(funcID, false);
            return false;
        }
        if (!arkMethod.isStatic()) {
            this.singletonFuncMap.set(funcID, false);
            return false;
        }
        let funcPag = this.funcPags.get(funcID);
        let heapObjects = [...funcPag.getInternalEdges()]
            .filter(edge => edge.kind === Pag_1.PagEdgeKind.Address)
            .map(edge => edge.dst);
        let returnValues = arkMethod.getReturnValues();
        let result = this.isValueConnected([...funcPag.getInternalEdges()], heapObjects, returnValues);
        this.singletonFuncMap.set(funcID, result);
        if (result) {
            logger.info(`function ${funcID} is marked as singleton function`);
        }
        return result;
    }
    isValueConnected(edges, leftNodes, targetNodes) {
        // build funcPag graph
        const graph = new Map();
        let hasStaticFieldOrGlobalVar = false;
        for (const edge of edges) {
            let dst = this.getRealInstanceRef(edge.dst);
            let src = this.getRealInstanceRef(edge.src);
            if (!graph.has(dst)) {
                graph.set(dst, []);
            }
            if (!graph.has(src)) {
                graph.set(src, []);
            }
            if (dst instanceof Ref_1.ArkStaticFieldRef || src instanceof Ref_1.ArkStaticFieldRef) {
                hasStaticFieldOrGlobalVar = true;
            }
            graph.get(src).push(dst);
        }
        if (!hasStaticFieldOrGlobalVar) {
            return false;
        }
        for (const targetNode of targetNodes) {
            for (const leftNode of leftNodes) {
                const visited = new Set();
                let meetStaticField = false;
                if (this.funcPagDfs(graph, visited, leftNode, targetNode, meetStaticField)) {
                    return true; // a value pair that satisfy condition
                }
                if (!meetStaticField) {
                    break; // heap obj will not deal any more
                }
            }
        }
        return false;
    }
    funcPagDfs(graph, visited, currentNode, targetNode, staticFieldFound) {
        if (currentNode === targetNode) {
            return staticFieldFound;
        }
        visited.add(currentNode);
        for (const neighbor of graph.get(currentNode) || []) {
            // TODO: add global variable
            const isSpecialNode = neighbor instanceof Ref_1.ArkStaticFieldRef;
            if (!visited.has(neighbor)) {
                if (isSpecialNode) {
                    staticFieldFound = true;
                }
                if (this.funcPagDfs(graph, visited, neighbor, targetNode, staticFieldFound)) {
                    return true;
                }
            }
        }
        return false;
    }
    getGlobalThisValue() {
        return this.globalThisValue;
    }
    getEdgeKindForAssignStmt(stmt) {
        if (this.stmtIsCreateAddressObj(stmt)) {
            return Pag_1.PagEdgeKind.Address;
        }
        if (this.stmtIsCopyKind(stmt)) {
            return Pag_1.PagEdgeKind.Copy;
        }
        if (this.stmtIsReadKind(stmt)) {
            return Pag_1.PagEdgeKind.Load;
        }
        if (this.stmtIsWriteKind(stmt)) {
            return Pag_1.PagEdgeKind.Write;
        }
        return Pag_1.PagEdgeKind.Unknown;
    }
    /**
     * get storageType enum with method's Declaring ClassName
     *
     * @param storageName ClassName that method belongs to, currently support AppStorage and SubscribedAbstractProperty
     * SubscribedAbstractProperty: in following listing, `link1` is infered as ClassType `SubscribedAbstractProperty`,
     * it needs to get PAG node to check the StorageType
     * let link1: SubscribedAbstractProperty<A> = AppStorage.link('PropA');
     * link1.set(a);
     * @param cs: for search PAG node in SubscribedAbstractProperty
     * @param cid: for search PAG node in SubscribedAbstractProperty
     * @returns StorageType enum
     */
    getStorageType(storageName, cs, cid) {
        switch (storageName) {
            case 'AppStorage':
                return Pag_1.StorageType.APP_STORAGE;
            case 'SubscribedAbstractProperty': {
                let calleeBaseLocal = cs.callStmt.getInvokeExpr().getBase();
                let calleeBaseLocalNode = this.pag.getOrNewNode(cid, calleeBaseLocal);
                if (calleeBaseLocalNode.isStorageLinked()) {
                    let storage = calleeBaseLocalNode.getStorage();
                    return storage.StorageType;
                }
                return Pag_1.StorageType.Undefined;
            }
            default:
                return Pag_1.StorageType.Undefined;
        }
    }
    /**\
     * ArkNewExpr, ArkNewArrayExpr, function ptr, globalThis
     */
    stmtIsCreateAddressObj(stmt) {
        let lhOp = stmt.getLeftOp();
        let rhOp = stmt.getRightOp();
        if ((rhOp instanceof Expr_1.ArkNewExpr || rhOp instanceof Expr_1.ArkNewArrayExpr) ||
            (lhOp instanceof Local_1.Local && ((rhOp instanceof Local_1.Local && rhOp.getType() instanceof Type_1.FunctionType &&
                rhOp.getDeclaringStmt() === null) ||
                (rhOp instanceof Ref_1.AbstractFieldRef && rhOp.getType() instanceof Type_1.FunctionType))) ||
            (rhOp instanceof Local_1.Local && rhOp.getName() === TSConst_1.GLOBAL_THIS_NAME && rhOp.getDeclaringStmt() == null)) {
            return true;
        }
        // TODO: add other Address Obj creation
        // like static object
        return false;
    }
    stmtIsCopyKind(stmt) {
        let lhOp = stmt.getLeftOp();
        let rhOp = stmt.getRightOp();
        let condition = (lhOp instanceof Local_1.Local && (rhOp instanceof Local_1.Local || rhOp instanceof Ref_1.ArkParameterRef ||
            rhOp instanceof Ref_1.ArkThisRef || rhOp instanceof Ref_1.ArkStaticFieldRef)) ||
            (lhOp instanceof Ref_1.ArkStaticFieldRef && rhOp instanceof Local_1.Local);
        if (condition) {
            return true;
        }
        return false;
    }
    stmtIsWriteKind(stmt) {
        let lhOp = stmt.getLeftOp();
        let rhOp = stmt.getRightOp();
        if (rhOp instanceof Local_1.Local &&
            (lhOp instanceof Ref_1.ArkInstanceFieldRef || lhOp instanceof Ref_1.ArkArrayRef)) {
            return true;
        }
        return false;
    }
    stmtIsReadKind(stmt) {
        let lhOp = stmt.getLeftOp();
        let rhOp = stmt.getRightOp();
        if (lhOp instanceof Local_1.Local &&
            (rhOp instanceof Ref_1.ArkInstanceFieldRef || rhOp instanceof Ref_1.ArkArrayRef)) {
            return true;
        }
        return false;
    }
    addToDynamicCallSite(funcPag, cs) {
        var _a;
        funcPag.addDynamicCallSite(cs);
        this.pagStat.numDynamicCall++;
        logger.trace("[add dynamic callsite] " + cs.callStmt.toString() + ":  " + ((_a = cs.callStmt.getCfg()) === null || _a === void 0 ? void 0 : _a.getDeclaringMethod().getSignature().toString()));
    }
    setPtForNode(node, pts) {
        if (!pts) {
            return;
        }
        this.pag.getNode(node).setPointTo(pts);
    }
    getRealThisLocal(input, funcId) {
        var _a;
        if (input.getName() !== 'this')
            return input;
        let real = input;
        let f = this.cg.getArkMethodByFuncID(funcId);
        (_a = f === null || f === void 0 ? void 0 : f.getCfg()) === null || _a === void 0 ? void 0 : _a.getStmts().forEach(s => {
            if (s instanceof Stmt_1.ArkAssignStmt && s.getLeftOp() instanceof Local_1.Local) {
                if (s.getLeftOp().getName() === 'this') {
                    real = s.getLeftOp();
                    return;
                }
            }
        });
        return real;
    }
    doStat() {
        this.pagStat.numTotalNode = this.pag.getNodeNum();
    }
    printStat() {
        this.pagStat.printStat();
    }
    getStat() {
        return this.pagStat.getStat();
    }
    getUnhandledFuncs() {
        let handledFuncs = this.getHandledFuncs();
        let unhandleFuncs = Array.from(this.cg.getNodesIter())
            .filter(f => !handledFuncs.includes(f.getID()))
            .map(f => f.getID());
        return unhandleFuncs;
    }
    getHandledFuncs() {
        return Array.from(this.funcPags.keys());
    }
    /**
     * build export edge in internal func pag
     * @param value: Value that need to check if it is from import/export
     * @param originValue: if Value if InstanceFieldRef, the base will be passed to `value` recursively,
     *                      fieldRef will be passed to `originValue`
     */
    handleValueFromExternalScope(value, funcID, originValue) {
        if (value instanceof Local_1.Local) {
            if (value.getDeclaringStmt()) {
                // not from external scope
                return;
            }
            if (!value.getType()) {
                return;
            }
            let srcLocal = this.getSourceValueFromExternalScope(value, funcID);
            if (srcLocal) {
                // if `value` is from field base, use origin value(fieldRef) instead
                this.addInterFuncEdge(srcLocal, originValue !== null && originValue !== void 0 ? originValue : value, funcID);
            }
        }
        else if (value instanceof Ref_1.ArkInstanceFieldRef) {
            let base = value.getBase();
            if (base) {
                this.handleValueFromExternalScope(base, funcID, value);
            }
        }
    }
    addInterFuncEdge(src, dst, funcID) {
        var _a, _b, _c;
        this.interFuncPags = (_a = this.interFuncPags) !== null && _a !== void 0 ? _a : new Map();
        let interFuncPag = (_b = this.interFuncPags.get(funcID)) !== null && _b !== void 0 ? _b : new Pag_1.InterFuncPag();
        // Export a local
        // Add a InterProcedural edge
        if (dst instanceof Local_1.Local) {
            let e = { src: src, dst: dst, kind: Pag_1.PagEdgeKind.InterProceduralCopy };
            interFuncPag.addToInterProceduralEdgeSet(e);
            this.addExportVariableMap(src, dst);
        }
        else if (dst instanceof Ref_1.ArkInstanceFieldRef) {
            // record the export base use
            this.addExportVariableMap(src, dst.getBase());
        }
        this.interFuncPags.set(funcID, interFuncPag);
        // Put the function which the src belongs to to worklist
        let srcFunc = (_c = src.getDeclaringStmt()) === null || _c === void 0 ? void 0 : _c.getCfg().getDeclaringMethod();
        if (srcFunc) {
            let srcFuncID = this.cg.getCallGraphNodeByMethod(srcFunc.getSignature()).getID();
            let cid = this.ctx.getNewContextID(srcFuncID);
            let csFuncID = new CSFuncID(cid, srcFuncID);
            this.buildFuncPagAndAddToWorklist(csFuncID);
        }
        // Extend other types of src here
    }
    getSourceValueFromExternalScope(value, funcID) {
        let sourceValue;
        // TODO: first from default method
        sourceValue = this.getDefaultMethodSourceValue(value, funcID);
        if (!sourceValue) {
            sourceValue = this.getExportSourceValue(value, funcID);
        }
        return sourceValue;
    }
    getDefaultMethodSourceValue(value, funcID) {
        var _a, _b, _c, _d, _e, _f, _g;
        // namespace check
        let arkMethod = this.cg.getArkMethodByFuncID(funcID);
        if (!arkMethod) {
            return;
        }
        let declaringNameSpace = arkMethod.getDeclaringArkClass().getDeclaringArkNamespace();
        while (declaringNameSpace) {
            let nameSpaceLocals = (_c = (_b = (_a = declaringNameSpace.getDefaultClass()
                .getDefaultArkMethod()) === null || _a === void 0 ? void 0 : _a.getBody()) === null || _b === void 0 ? void 0 : _b.getLocals()) !== null && _c !== void 0 ? _c : new Map();
            if (nameSpaceLocals.has(value.getName())) {
                return nameSpaceLocals.get(value.getName());
            }
            declaringNameSpace = (_d = declaringNameSpace.getDeclaringArkNamespace()) !== null && _d !== void 0 ? _d : undefined;
        }
        // file check
        let declaringFile = arkMethod.getDeclaringArkFile();
        let fileLocals = (_g = (_f = (_e = declaringFile.getDefaultClass()
            .getDefaultArkMethod()) === null || _e === void 0 ? void 0 : _e.getBody()) === null || _f === void 0 ? void 0 : _f.getLocals()) !== null && _g !== void 0 ? _g : new Map();
        if (!fileLocals.has(value.getName())) {
            return;
        }
        return fileLocals.get(value.getName());
    }
    getExportSourceValue(value, funcID) {
        let curMethod = this.cg.getArkMethodByFuncID(funcID);
        if (!curMethod) {
            return;
        }
        let curFile = curMethod.getDeclaringArkFile();
        let impInfo = curFile.getImportInfoBy(value.getName());
        if (!impInfo) {
            return;
        }
        let exportSource = impInfo.getLazyExportInfo();
        if (!exportSource) {
            return;
        }
        let exportSouceValue = exportSource.getArkExport();
        if (exportSouceValue instanceof Local_1.Local) {
            return exportSouceValue;
        }
    }
    addExportVariableMap(src, dst) {
        var _a;
        let exportMap = (_a = this.externalScopeVariableMap.get(src)) !== null && _a !== void 0 ? _a : [];
        if (!exportMap.includes(dst)) {
            exportMap.push(dst);
            this.externalScopeVariableMap.set(src, exportMap);
        }
    }
    getExportVariableMap(src) {
        var _a;
        return (_a = this.externalScopeVariableMap.get(src)) !== null && _a !== void 0 ? _a : [];
    }
    /// Add inter-procedural Pag Nodes and Edges
    addEdgesFromInterFuncPag(interFuncPag, cid) {
        let edges = interFuncPag.getInterProceduralEdges();
        if (edges.size === 0) {
            return false;
        }
        for (let e of edges) {
            // Existing local exported nodes -> ExportNode
            let exportLocal = e.src;
            let dstPagNode = this.getOrNewPagNode(cid, e.dst);
            // get export local node in all cid
            let existingNodes = this.pag.getNodesByValue(exportLocal);
            existingNodes === null || existingNodes === void 0 ? void 0 : existingNodes.forEach(n => {
                this.pag.addPagEdge(this.pag.getNode(n), dstPagNode, e.kind);
            });
        }
        return true;
    }
}
exports.PagBuilder = PagBuilder;
