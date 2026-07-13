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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.checkAndUpdateMethod = exports.isMethodImplementation = exports.addInitInConstructor = exports.buildInitMethod = exports.buildDefaultConstructor = exports.MethodParameter = exports.ArrayBindingPatternParameter = exports.ObjectBindingPatternParameter = exports.buildArkMethodFromArkClass = exports.buildDefaultArkMethodFromArkClass = void 0;
const Type_1 = require("../../base/Type");
const BodyBuilder_1 = require("./BodyBuilder");
const ViewTreeBuilder_1 = require("../../graph/builder/ViewTreeBuilder");
const ArkClass_1 = require("../ArkClass");
const ArkMethod_1 = require("../ArkMethod");
const ohos_typescript_1 = __importDefault(require("ohos-typescript"));
const builderUtils_1 = require("./builderUtils");
const logger_1 = __importStar(require("../../../utils/logger"));
const Ref_1 = require("../../base/Ref");
const ArkBody_1 = require("../ArkBody");
const Cfg_1 = require("../../graph/Cfg");
const Expr_1 = require("../../base/Expr");
const ArkSignature_1 = require("../ArkSignature");
const Stmt_1 = require("../../base/Stmt");
const BasicBlock_1 = require("../../graph/BasicBlock");
const Local_1 = require("../../base/Local");
const TSConst_1 = require("../../common/TSConst");
const Const_1 = require("../../common/Const");
const ArkSignatureBuilder_1 = require("./ArkSignatureBuilder");
const IRUtils_1 = require("../../common/IRUtils");
const ArkError_1 = require("../../common/ArkError");
const logger = logger_1.default.getLogger(logger_1.LOG_MODULE_TYPE.ARKANALYZER, 'ArkMethodBuilder');
function buildDefaultArkMethodFromArkClass(declaringClass, mtd, sourceFile, node) {
    mtd.setDeclaringArkClass(declaringClass);
    const methodSubSignature = ArkSignatureBuilder_1.ArkSignatureBuilder.buildMethodSubSignatureFromMethodName(Const_1.DEFAULT_ARK_METHOD_NAME, true);
    const methodSignature = new ArkSignature_1.MethodSignature(mtd.getDeclaringArkClass().getSignature(), methodSubSignature);
    mtd.setImplementationSignature(methodSignature);
    mtd.setLineCol(0);
    const defaultMethodNode = node ? node : sourceFile;
    let bodyBuilder = new BodyBuilder_1.BodyBuilder(mtd.getSignature(), defaultMethodNode, mtd, sourceFile);
    mtd.setBodyBuilder(bodyBuilder);
}
exports.buildDefaultArkMethodFromArkClass = buildDefaultArkMethodFromArkClass;
function buildArkMethodFromArkClass(methodNode, declaringClass, mtd, sourceFile, declaringMethod) {
    mtd.setDeclaringArkClass(declaringClass);
    if (declaringMethod !== undefined) {
        mtd.setOuterMethod(declaringMethod);
    }
    if (ohos_typescript_1.default.isFunctionDeclaration(methodNode)) {
        mtd.setAsteriskToken(methodNode.asteriskToken !== undefined);
    }
    mtd.setCode(methodNode.getText(sourceFile));
    mtd.setModifiers((0, builderUtils_1.buildModifiers)(methodNode));
    mtd.setDecorators((0, builderUtils_1.buildDecorators)(methodNode, sourceFile));
    if (methodNode.typeParameters) {
        mtd.setGenericTypes((0, builderUtils_1.buildTypeParameters)(methodNode.typeParameters, sourceFile, mtd));
    }
    // build methodDeclareSignatures and methodSignature as well as corresponding positions
    const methodName = buildMethodName(methodNode, declaringClass, sourceFile, declaringMethod);
    const methodParameters = [];
    (0, builderUtils_1.buildParameters)(methodNode.parameters, mtd, sourceFile).forEach((parameter) => {
        (0, builderUtils_1.buildGenericType)(parameter.getType(), mtd);
        methodParameters.push(parameter);
    });
    let returnType = Type_1.UnknownType.getInstance();
    if (methodNode.type) {
        returnType = (0, builderUtils_1.buildGenericType)((0, builderUtils_1.buildReturnType)(methodNode.type, sourceFile, mtd), mtd);
    }
    const methodSubSignature = new ArkSignature_1.MethodSubSignature(methodName, methodParameters, returnType, mtd.isStatic());
    const methodSignature = new ArkSignature_1.MethodSignature(mtd.getDeclaringArkClass().getSignature(), methodSubSignature);
    const { line, character } = ohos_typescript_1.default.getLineAndCharacterOfPosition(sourceFile, methodNode.getStart(sourceFile));
    if (isMethodImplementation(methodNode)) {
        mtd.setImplementationSignature(methodSignature);
        mtd.setLine(line + 1);
        mtd.setColumn(character + 1);
    }
    else {
        mtd.setDeclareSignatures(methodSignature);
        mtd.setDeclareLinesAndCols([line + 1], [character + 1]);
    }
    let bodyBuilder = new BodyBuilder_1.BodyBuilder(mtd.getSignature(), methodNode, mtd, sourceFile);
    mtd.setBodyBuilder(bodyBuilder);
    if (mtd.hasBuilderDecorator()) {
        mtd.setViewTree((0, ViewTreeBuilder_1.buildViewTree)(mtd));
    }
    else if (declaringClass.hasComponentDecorator() &&
        mtd.getSubSignature().toString() === 'build()' &&
        !mtd.isStatic()) {
        declaringClass.setViewTree((0, ViewTreeBuilder_1.buildViewTree)(mtd));
    }
    checkAndUpdateMethod(mtd, declaringClass);
    declaringClass.addMethod(mtd);
    IRUtils_1.IRUtils.setComments(mtd, methodNode, sourceFile, mtd.getDeclaringArkFile().getScene().getOptions());
}
exports.buildArkMethodFromArkClass = buildArkMethodFromArkClass;
function buildMethodName(node, declaringClass, sourceFile, declaringMethod) {
    let name = '';
    if (ohos_typescript_1.default.isFunctionDeclaration(node) || ohos_typescript_1.default.isFunctionExpression(node)) {
        name = node.name ? node.name.text : buildAnonymousMethodName(node, declaringClass);
    }
    else if (ohos_typescript_1.default.isFunctionTypeNode(node)) {
        //TODO: check name type
        name = node.name ? node.name.getText(sourceFile) : buildAnonymousMethodName(node, declaringClass);
    }
    else if (ohos_typescript_1.default.isMethodDeclaration(node) || ohos_typescript_1.default.isMethodSignature(node)) {
        if (ohos_typescript_1.default.isIdentifier(node.name)) {
            name = node.name.text;
        }
        else if (ohos_typescript_1.default.isComputedPropertyName(node.name)) {
            if (ohos_typescript_1.default.isIdentifier(node.name.expression)) {
                name = node.name.expression.text;
            }
            else if (ohos_typescript_1.default.isPropertyAccessExpression(node.name.expression)) {
                name = (0, builderUtils_1.handlePropertyAccessExpression)(node.name.expression);
            }
            else {
                logger.warn('Other method ComputedPropertyName found!');
            }
        }
        else {
            logger.warn('Other method declaration type found!');
        }
    }
    //TODO, hard code
    else if (ohos_typescript_1.default.isConstructorDeclaration(node)) {
        name = TSConst_1.CONSTRUCTOR_NAME;
    }
    else if (ohos_typescript_1.default.isConstructSignatureDeclaration(node)) {
        name = 'construct-signature';
    }
    else if (ohos_typescript_1.default.isCallSignatureDeclaration(node)) {
        name = Const_1.CALL_SIGNATURE_NAME;
    }
    else if (ohos_typescript_1.default.isGetAccessor(node) && ohos_typescript_1.default.isIdentifier(node.name)) {
        name = 'Get-' + node.name.text;
    }
    else if (ohos_typescript_1.default.isSetAccessor(node) && ohos_typescript_1.default.isIdentifier(node.name)) {
        name = 'Set-' + node.name.text;
    }
    else if (ohos_typescript_1.default.isArrowFunction(node)) {
        name = buildAnonymousMethodName(node, declaringClass);
    }
    if (declaringMethod !== undefined && !declaringMethod.isDefaultArkMethod()) {
        name = buildNestedMethodName(name, declaringMethod.getName());
    }
    return name;
}
function buildAnonymousMethodName(node, declaringClass) {
    return `${Const_1.ANONYMOUS_METHOD_PREFIX}${declaringClass.getAnonymousMethodNumber()}`;
}
function buildNestedMethodName(originName, declaringMethodName) {
    if (originName.startsWith(Const_1.NAME_PREFIX)) {
        return `${originName}${Const_1.NAME_DELIMITER}${declaringMethodName}`;
    }
    return `${Const_1.NAME_PREFIX}${originName}${Const_1.NAME_DELIMITER}${declaringMethodName}`;
}
class ObjectBindingPatternParameter {
    constructor() {
        this.propertyName = '';
        this.name = '';
        this.optional = false;
    }
    getName() {
        return this.name;
    }
    setName(name) {
        this.name = name;
    }
    getPropertyName() {
        return this.propertyName;
    }
    setPropertyName(propertyName) {
        this.propertyName = propertyName;
    }
    isOptional() {
        return this.optional;
    }
    setOptional(optional) {
        this.optional = optional;
    }
}
exports.ObjectBindingPatternParameter = ObjectBindingPatternParameter;
class ArrayBindingPatternParameter {
    constructor() {
        this.propertyName = '';
        this.name = '';
        this.optional = false;
    }
    getName() {
        return this.name;
    }
    setName(name) {
        this.name = name;
    }
    getPropertyName() {
        return this.propertyName;
    }
    setPropertyName(propertyName) {
        this.propertyName = propertyName;
    }
    isOptional() {
        return this.optional;
    }
    setOptional(optional) {
        this.optional = optional;
    }
}
exports.ArrayBindingPatternParameter = ArrayBindingPatternParameter;
class MethodParameter {
    constructor() {
        this.name = '';
        this.optional = false;
        this.dotDotDotToken = false;
        this.objElements = [];
        this.arrayElements = [];
    }
    getName() {
        return this.name;
    }
    setName(name) {
        this.name = name;
    }
    getType() {
        return this.type;
    }
    setType(type) {
        this.type = type;
    }
    isOptional() {
        return this.optional;
    }
    setOptional(optional) {
        this.optional = optional;
    }
    hasDotDotDotToken() {
        return this.dotDotDotToken;
    }
    setDotDotDotToken(dotDotDotToken) {
        this.dotDotDotToken = dotDotDotToken;
    }
    addObjElement(element) {
        this.objElements.push(element);
    }
    getObjElements() {
        return this.objElements;
    }
    setObjElements(objElements) {
        this.objElements = objElements;
    }
    addArrayElement(element) {
        this.arrayElements.push(element);
    }
    getArrayElements() {
        return this.arrayElements;
    }
    setArrayElements(arrayElements) {
        this.arrayElements = arrayElements;
    }
    getUses() {
        return [];
    }
}
exports.MethodParameter = MethodParameter;
function needDefaultConstructorInClass(arkClass) {
    const originClassType = arkClass.getCategory();
    return arkClass.getMethodWithName(TSConst_1.CONSTRUCTOR_NAME) == null &&
        (originClassType === ArkClass_1.ClassCategory.CLASS || originClassType === ArkClass_1.ClassCategory.OBJECT) &&
        arkClass.getName() !== Const_1.DEFAULT_ARK_CLASS_NAME &&
        !arkClass.isDeclare();
}
function buildDefaultConstructor(arkClass) {
    if (!needDefaultConstructorInClass(arkClass)) {
        return false;
    }
    let parentConstructor = null;
    let superClass = arkClass.getSuperClass() || null;
    while (superClass != null) {
        parentConstructor = superClass.getMethodWithName(TSConst_1.CONSTRUCTOR_NAME);
        if (parentConstructor != null) {
            break;
        }
        superClass = superClass.getSuperClass() || null;
    }
    const defaultConstructor = new ArkMethod_1.ArkMethod();
    defaultConstructor.setDeclaringArkClass(arkClass);
    defaultConstructor.setCode('');
    defaultConstructor.setIsGeneratedFlag(true);
    const thisLocal = new Local_1.Local(TSConst_1.THIS_NAME);
    const locals = new Set([thisLocal]);
    const basicBlock = new BasicBlock_1.BasicBlock();
    let startingStmt = new Stmt_1.ArkAssignStmt(thisLocal, new Ref_1.ArkThisRef(new Type_1.ClassType(arkClass.getSignature())));
    basicBlock.addStmt(startingStmt);
    if (parentConstructor != null) {
        const methodParameters = [];
        parentConstructor.getParameters().forEach(parameter => {
            methodParameters.push(parameter);
        });
        let returnType = parentConstructor.getReturnType();
        const methodSubSignature = new ArkSignature_1.MethodSubSignature(TSConst_1.CONSTRUCTOR_NAME, methodParameters, returnType, defaultConstructor.isStatic());
        const methodSignature = new ArkSignature_1.MethodSignature(defaultConstructor.getDeclaringArkClass().getSignature(), methodSubSignature);
        defaultConstructor.setImplementationSignature(methodSignature);
        defaultConstructor.setLineCol(0);
        const stmts = [];
        let index = 0;
        const parameterLocals = [];
        for (const methodParameter of defaultConstructor.getParameters()) {
            const parameterRef = new Ref_1.ArkParameterRef(index, methodParameter.getType());
            const parameterLocal = new Local_1.Local(methodParameter.getName(), parameterRef.getType());
            locals.add(parameterLocal);
            parameterLocals.push(parameterLocal);
            stmts.push(new Stmt_1.ArkAssignStmt(parameterLocal, parameterRef));
            index++;
        }
        const superMethodSubSignature = new ArkSignature_1.MethodSubSignature(TSConst_1.SUPER_NAME, parentConstructor.getParameters(), defaultConstructor.getReturnType());
        const superMethodSignature = new ArkSignature_1.MethodSignature(arkClass.getSignature(), superMethodSubSignature);
        const superInvokeExpr = new Expr_1.ArkStaticInvokeExpr(superMethodSignature, parameterLocals);
        const superInvokeStmt = new Stmt_1.ArkInvokeStmt(superInvokeExpr);
        basicBlock.addStmt(superInvokeStmt);
        const returnVoidStmt = new Stmt_1.ArkReturnVoidStmt();
        basicBlock.addStmt(returnVoidStmt);
    }
    else {
        const methodSubSignature = ArkSignatureBuilder_1.ArkSignatureBuilder.buildMethodSubSignatureFromMethodName(TSConst_1.CONSTRUCTOR_NAME);
        const methodSignature = new ArkSignature_1.MethodSignature(defaultConstructor.getDeclaringArkClass().getSignature(), methodSubSignature);
        defaultConstructor.setImplementationSignature(methodSignature);
        defaultConstructor.setLineCol(0);
        if (arkClass.getSuperClass()) {
            const superClass = arkClass.getSuperClass();
            const superMethodSubSignature = new ArkSignature_1.MethodSubSignature(TSConst_1.SUPER_NAME, [], Type_1.UnknownType.getInstance());
            const superMethodSignature = new ArkSignature_1.MethodSignature(superClass.getSignature(), superMethodSubSignature);
            const superInvokeExpr = new Expr_1.ArkStaticInvokeExpr(superMethodSignature, []);
            const superInvokeStmt = new Stmt_1.ArkInvokeStmt(superInvokeExpr);
            basicBlock.addStmt(superInvokeStmt);
            const returnVoidStmt = new Stmt_1.ArkReturnVoidStmt();
            basicBlock.addStmt(returnVoidStmt);
        }
        else {
            const returnVoidStmt = new Stmt_1.ArkReturnVoidStmt();
            basicBlock.addStmt(returnVoidStmt);
        }
    }
    const cfg = new Cfg_1.Cfg();
    cfg.addBlock(basicBlock);
    cfg.setStartingStmt(startingStmt);
    cfg.setDeclaringMethod(defaultConstructor);
    cfg.getStmts().forEach(s => s.setCfg(cfg));
    defaultConstructor.setBody(new ArkBody_1.ArkBody(locals, cfg));
    checkAndUpdateMethod(defaultConstructor, arkClass);
    arkClass.addMethod(defaultConstructor);
    return true;
}
exports.buildDefaultConstructor = buildDefaultConstructor;
function buildInitMethod(initMethod, fieldInitializerStmts, thisLocal) {
    const classType = new Type_1.ClassType(initMethod.getDeclaringArkClass().getSignature());
    const assignStmt = new Stmt_1.ArkAssignStmt(thisLocal, new Ref_1.ArkThisRef(classType));
    const block = new BasicBlock_1.BasicBlock();
    block.addStmt(assignStmt);
    const locals = new Set([thisLocal]);
    for (const stmt of fieldInitializerStmts) {
        block.addStmt(stmt);
        if (stmt.getDef() && stmt.getDef() instanceof Local_1.Local) {
            locals.add(stmt.getDef());
        }
    }
    block.addStmt(new Stmt_1.ArkReturnVoidStmt());
    const cfg = new Cfg_1.Cfg();
    cfg.addBlock(block);
    for (const stmt of block.getStmts()) {
        stmt.setCfg(cfg);
    }
    cfg.setStartingStmt(assignStmt);
    cfg.buildDefUseStmt(locals);
    cfg.setDeclaringMethod(initMethod);
    initMethod.setBody(new ArkBody_1.ArkBody(locals, cfg));
}
exports.buildInitMethod = buildInitMethod;
function addInitInConstructor(arkClass) {
    var _a, _b;
    for (const method of arkClass.getMethods(true)) {
        if (method.getName() === TSConst_1.CONSTRUCTOR_NAME) {
            const thisLocal = (_a = method.getBody()) === null || _a === void 0 ? void 0 : _a.getLocals().get(TSConst_1.THIS_NAME);
            if (!thisLocal) {
                continue;
            }
            const initInvokeStmt = new Stmt_1.ArkInvokeStmt(new Expr_1.ArkInstanceInvokeExpr(thisLocal, arkClass.getInstanceInitMethod().getSignature(), []));
            const blocks = (_b = method.getCfg()) === null || _b === void 0 ? void 0 : _b.getBlocks();
            if (!blocks) {
                continue;
            }
            const firstBlockStmts = [...blocks][0].getStmts();
            let index = 0;
            if (firstBlockStmts[0].getDef() instanceof Local_1.Local && firstBlockStmts[0].getDef().getName() === TSConst_1.THIS_NAME) {
                index = 1;
            }
            firstBlockStmts.splice(index, 0, initInvokeStmt);
        }
    }
}
exports.addInitInConstructor = addInitInConstructor;
function isMethodImplementation(node) {
    if (ohos_typescript_1.default.isFunctionDeclaration(node) ||
        ohos_typescript_1.default.isMethodDeclaration(node) ||
        ohos_typescript_1.default.isConstructorDeclaration(node) ||
        ohos_typescript_1.default.isGetAccessorDeclaration(node) ||
        ohos_typescript_1.default.isSetAccessorDeclaration(node) ||
        ohos_typescript_1.default.isFunctionExpression(node) ||
        ohos_typescript_1.default.isArrowFunction(node)) {
        if (node.body !== undefined) {
            return true;
        }
    }
    return false;
}
exports.isMethodImplementation = isMethodImplementation;
function checkAndUpdateMethod(method, cls) {
    let presentMethod;
    if (method.isStatic()) {
        presentMethod = cls.getStaticMethodWithName(method.getName());
    }
    else {
        presentMethod = cls.getMethodWithName(method.getName());
    }
    if (presentMethod === null) {
        return;
    }
    if (method.validate().errCode !== ArkError_1.ArkErrorCode.OK || presentMethod.validate().errCode !== ArkError_1.ArkErrorCode.OK) {
        return;
    }
    const presentDeclareSignatures = presentMethod.getDeclareSignatures();
    const presentDeclareLineCols = presentMethod.getDeclareLineCols();
    const presentImplSignature = presentMethod.getImplementationSignature();
    const newDeclareSignature = method.getDeclareSignatures();
    const newDeclareLineCols = method.getDeclareLineCols();
    const newImplSignature = method.getImplementationSignature();
    if (presentDeclareSignatures !== null && presentImplSignature === null) {
        if (newDeclareSignature === null || presentMethod.getDeclareSignatureIndex(newDeclareSignature[0]) >= 0) {
            method.setDeclareSignatures(presentDeclareSignatures);
            method.setDeclareLineCols(presentDeclareLineCols);
        }
        else {
            method.setDeclareSignatures(presentDeclareSignatures.concat(newDeclareSignature));
            method.setDeclareLineCols(presentDeclareLineCols.concat(newDeclareLineCols));
        }
        return;
    }
    if (presentDeclareSignatures === null && presentImplSignature !== null) {
        if (newImplSignature === null) {
            method.setImplementationSignature(presentImplSignature);
            method.setLineCol(presentMethod.getLineCol());
        }
        return;
    }
}
exports.checkAndUpdateMethod = checkAndUpdateMethod;
