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
exports.ArkValueTransformer = void 0;
const ts = __importStar(require("ohos-typescript"));
const Local_1 = require("../base/Local");
const Position_1 = require("../base/Position");
const Stmt_1 = require("../base/Stmt");
const Expr_1 = require("../base/Expr");
const ArkClass_1 = require("../model/ArkClass");
const ArkClassBuilder_1 = require("../model/builder/ArkClassBuilder");
const Type_1 = require("../base/Type");
const ArkSignatureBuilder_1 = require("../model/builder/ArkSignatureBuilder");
const TSConst_1 = require("./TSConst");
const ArkSignature_1 = require("../model/ArkSignature");
const EtsConst_1 = require("./EtsConst");
const ValueUtil_1 = require("./ValueUtil");
const IRUtils_1 = require("./IRUtils");
const Ref_1 = require("../base/Ref");
const ModelUtils_1 = require("./ModelUtils");
const ArkMethod_1 = require("../model/ArkMethod");
const ArkMethodBuilder_1 = require("../model/builder/ArkMethodBuilder");
const Builtin_1 = require("./Builtin");
const Constant_1 = require("../base/Constant");
const Const_1 = require("./Const");
const ArkIRTransformer_1 = require("./ArkIRTransformer");
const logger_1 = __importStar(require("../../utils/logger"));
const TypeInference_1 = require("./TypeInference");
const TypeExpr_1 = require("../base/TypeExpr");
const logger = logger_1.default.getLogger(logger_1.LOG_MODULE_TYPE.ARKANALYZER, 'ArkValueTransformer');
class ArkValueTransformer {
    constructor(arkIRTransformer, sourceFile, declaringMethod) {
        this.conditionalOperatorNo = 0;
        this.tempLocalNo = 0;
        this.locals = new Map();
        this.aliasTypeMap = new Map();
        this.builderMethodContextFlag = false;
        this.arkIRTransformer = arkIRTransformer;
        this.sourceFile = sourceFile;
        this.thisLocal = new Local_1.Local(TSConst_1.THIS_NAME, declaringMethod.getDeclaringArkClass().getSignature().getType());
        this.locals.set(this.thisLocal.getName(), this.thisLocal);
        this.declaringMethod = declaringMethod;
    }
    getLocals() {
        return new Set(this.locals.values());
    }
    getThisLocal() {
        return this.thisLocal;
    }
    getAliasTypeMap() {
        return this.aliasTypeMap;
    }
    addNewLocal(localName, localType = Type_1.UnknownType.getInstance()) {
        let local = new Local_1.Local(localName, localType);
        this.locals.set(localName, local);
        return local;
    }
    getGlobals() {
        var _a;
        return (_a = this.globals) !== null && _a !== void 0 ? _a : null;
    }
    addNewGlobal(name, ref) {
        var _a;
        let globalRef = new Ref_1.GlobalRef(name, ref);
        this.globals = (_a = this.globals) !== null && _a !== void 0 ? _a : new Map();
        this.globals.set(name, globalRef);
        return globalRef;
    }
    tsNodeToValueAndStmts(node) {
        if (ts.isBinaryExpression(node)) {
            return this.binaryExpressionToValueAndStmts(node);
        }
        else if (ts.isCallExpression(node)) {
            return this.callExpressionToValueAndStmts(node);
        }
        else if (ts.isVariableDeclarationList(node)) {
            return this.variableDeclarationListToValueAndStmts(node);
        }
        else if (ts.isIdentifier(node)) {
            return this.identifierToValueAndStmts(node);
        }
        else if (ts.isPropertyAccessExpression(node)) {
            return this.propertyAccessExpressionToValue(node);
        }
        else if (ts.isPrefixUnaryExpression(node)) {
            return this.prefixUnaryExpressionToValueAndStmts(node);
        }
        else if (ts.isPostfixUnaryExpression(node)) {
            return this.postfixUnaryExpressionToValueAndStmts(node);
        }
        else if (ts.isTemplateExpression(node)) {
            return this.templateExpressionToValueAndStmts(node);
        }
        else if (ts.isTaggedTemplateExpression(node)) {
            return this.taggedTemplateExpressionToValueAndStmts(node);
        }
        else if (ts.isAwaitExpression(node)) {
            return this.awaitExpressionToValueAndStmts(node);
        }
        else if (ts.isYieldExpression(node)) {
            return this.yieldExpressionToValueAndStmts(node);
        }
        else if (ts.isDeleteExpression(node)) {
            return this.deleteExpressionToValueAndStmts(node);
        }
        else if (ts.isVoidExpression(node)) {
            return this.voidExpressionToValueAndStmts(node);
        }
        else if (ts.isElementAccessExpression(node)) {
            return this.elementAccessExpressionToValueAndStmts(node);
        }
        else if (ts.isNewExpression(node)) {
            return this.newExpressionToValueAndStmts(node);
        }
        else if (ts.isParenthesizedExpression(node)) {
            return this.parenthesizedExpressionToValueAndStmts(node);
        }
        else if (ts.isAsExpression(node)) {
            return this.asExpressionToValueAndStmts(node);
        }
        else if (ts.isNonNullExpression(node)) {
            return this.nonNullExpressionToValueAndStmts(node);
        }
        else if (ts.isTypeAssertionExpression(node)) {
            return this.typeAssertionToValueAndStmts(node);
        }
        else if (ts.isTypeOfExpression(node)) {
            return this.typeOfExpressionToValueAndStmts(node);
        }
        else if (ts.isArrayLiteralExpression(node)) {
            return this.arrayLiteralExpressionToValueAndStmts(node);
        }
        else if (this.isLiteralNode(node)) {
            return this.literalNodeToValueAndStmts(node);
        }
        else if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) {
            return this.callableNodeToValueAndStmts(node);
        }
        else if (ts.isClassExpression(node)) {
            return this.classExpressionToValueAndStmts(node);
        }
        else if (ts.isEtsComponentExpression(node)) {
            return this.etsComponentExpressionToValueAndStmts(node);
        }
        else if (ts.isObjectLiteralExpression(node)) {
            return this.objectLiteralExpresionToValueAndStmts(node);
        }
        else if (node.kind === ts.SyntaxKind.ThisKeyword) {
            return this.thisExpressionToValueAndStmts(node);
        }
        else if (ts.isConditionalExpression(node)) {
            return this.conditionalExpressionToValueAndStmts(node);
        }
        return {
            value: new Local_1.Local(node.getText(this.sourceFile)),
            valueOriginalPositions: [Position_1.FullPosition.buildFromNode(node, this.sourceFile)],
            stmts: [],
        };
    }
    tsNodeToSingleAddressValueAndStmts(node) {
        const allStmts = [];
        let { value, valueOriginalPositions, stmts } = this.tsNodeToValueAndStmts(node);
        stmts.forEach(stmt => allStmts.push(stmt));
        if (IRUtils_1.IRUtils.moreThanOneAddress(value)) {
            ({ value, valueOriginalPositions, stmts } =
                this.arkIRTransformer.generateAssignStmtForValue(value, valueOriginalPositions));
            stmts.forEach(stmt => allStmts.push(stmt));
        }
        return { value, valueOriginalPositions, stmts: allStmts };
    }
    thisExpressionToValueAndStmts(thisExpression) {
        return {
            value: this.getThisLocal(),
            valueOriginalPositions: [Position_1.FullPosition.buildFromNode(thisExpression, this.sourceFile)],
            stmts: [],
        };
    }
    conditionalExpressionToValueAndStmts(conditionalExpression) {
        const stmts = [];
        const currConditionalOperatorIndex = this.conditionalOperatorNo++;
        const { value: conditionValue, valueOriginalPositions: conditionPositions, stmts: conditionStmts, } = this.conditionToValueAndStmts(conditionalExpression.condition);
        conditionStmts.forEach(stmt => stmts.push(stmt));
        const ifStmt = new Stmt_1.ArkIfStmt(conditionValue);
        ifStmt.setOperandOriginalPositions(conditionPositions);
        stmts.push(ifStmt);
        stmts.push(new ArkIRTransformer_1.DummyStmt(ArkIRTransformer_1.ArkIRTransformer.DUMMY_CONDITIONAL_OPERATOR_IF_TRUE_STMT + currConditionalOperatorIndex));
        const { value: whenTrueValue, valueOriginalPositions: whenTruePositions, stmts: whenTrueStmts, } = this.tsNodeToValueAndStmts(conditionalExpression.whenTrue);
        whenTrueStmts.forEach(stmt => stmts.push(stmt));
        const resultLocal = this.generateTempLocal();
        const assignStmtWhenTrue = new Stmt_1.ArkAssignStmt(resultLocal, whenTrueValue);
        const resultLocalPosition = [whenTruePositions[0]];
        assignStmtWhenTrue.setOperandOriginalPositions([...resultLocalPosition, ...whenTruePositions]);
        stmts.push(assignStmtWhenTrue);
        stmts.push(new ArkIRTransformer_1.DummyStmt(ArkIRTransformer_1.ArkIRTransformer.DUMMY_CONDITIONAL_OPERATOR_IF_FALSE_STMT + currConditionalOperatorIndex));
        const { value: whenFalseValue, valueOriginalPositions: whenFalsePositions, stmts: whenFalseStmts, } = this.tsNodeToValueAndStmts(conditionalExpression.whenFalse);
        whenFalseStmts.forEach(stmt => stmts.push(stmt));
        const assignStmt = new Stmt_1.ArkAssignStmt(resultLocal, whenFalseValue);
        assignStmt.setOperandOriginalPositions([...resultLocalPosition, ...whenFalsePositions]);
        stmts.push(assignStmt);
        stmts.push(new ArkIRTransformer_1.DummyStmt(ArkIRTransformer_1.ArkIRTransformer.DUMMY_CONDITIONAL_OPERATOR_END_STMT + currConditionalOperatorIndex));
        return { value: resultLocal, valueOriginalPositions: resultLocalPosition, stmts: stmts };
    }
    objectLiteralExpresionToValueAndStmts(objectLiteralExpression) {
        const declaringArkClass = this.declaringMethod.getDeclaringArkClass();
        const declaringArkNamespace = declaringArkClass.getDeclaringArkNamespace();
        const anonymousClass = new ArkClass_1.ArkClass();
        if (declaringArkNamespace) {
            (0, ArkClassBuilder_1.buildNormalArkClassFromArkNamespace)(objectLiteralExpression, declaringArkNamespace, anonymousClass, this.sourceFile, this.declaringMethod);
            declaringArkNamespace.addArkClass(anonymousClass);
        }
        else {
            const declaringArkFile = declaringArkClass.getDeclaringArkFile();
            (0, ArkClassBuilder_1.buildNormalArkClassFromArkFile)(objectLiteralExpression, declaringArkFile, anonymousClass, this.sourceFile, this.declaringMethod);
            declaringArkFile.addArkClass(anonymousClass);
        }
        const objectLiteralExpressionPosition = Position_1.FullPosition.buildFromNode(objectLiteralExpression, this.sourceFile);
        const stmts = [];
        const anonymousClassSignature = anonymousClass.getSignature();
        const anonymousClassType = new Type_1.ClassType(anonymousClassSignature);
        const newExpr = new Expr_1.ArkNewExpr(anonymousClassType);
        const { value: newExprLocal, valueOriginalPositions: newExprLocalPositions, stmts: newExprStmts, } = this.arkIRTransformer.generateAssignStmtForValue(newExpr, [objectLiteralExpressionPosition]);
        newExprStmts.forEach(stmt => stmts.push(stmt));
        const constructorMethodSubSignature = ArkSignatureBuilder_1.ArkSignatureBuilder.buildMethodSubSignatureFromMethodName(TSConst_1.CONSTRUCTOR_NAME);
        const constructorMethodSignature = new ArkSignature_1.MethodSignature(anonymousClassSignature, constructorMethodSubSignature);
        const constructorInvokeExpr = new Expr_1.ArkInstanceInvokeExpr(newExprLocal, constructorMethodSignature, []);
        const constructorInvokeExprPositions = [objectLiteralExpressionPosition, ...newExprLocalPositions];
        const constructorInvokeStmt = new Stmt_1.ArkInvokeStmt(constructorInvokeExpr);
        constructorInvokeStmt.setOperandOriginalPositions(constructorInvokeExprPositions);
        stmts.push(constructorInvokeStmt);
        return { value: newExprLocal, valueOriginalPositions: newExprLocalPositions, stmts: stmts };
    }
    generateSystemComponentStmt(componentName, args, argPositionsAllFlat, componentExpression, currStmts) {
        const stmts = [...currStmts];
        const componentExpressionPosition = Position_1.FullPosition.buildFromNode(componentExpression, this.sourceFile);
        const { value: componentValue, valueOriginalPositions: componentPositions, stmts: componentStmts, } = this.generateComponentCreationStmts(componentName, args, componentExpressionPosition, argPositionsAllFlat);
        componentStmts.forEach(stmt => stmts.push(stmt));
        if (ts.isEtsComponentExpression(componentExpression) && componentExpression.body) {
            for (const statement of componentExpression.body.statements) {
                this.arkIRTransformer.tsNodeToStmts(statement).forEach(stmt => stmts.push(stmt));
            }
        }
        stmts.push(this.generateComponentPopStmts(componentName, componentExpressionPosition));
        return { value: componentValue, valueOriginalPositions: componentPositions, stmts: stmts };
    }
    generateCustomViewStmt(componentName, args, argPositionsAllFlat, componentExpression, currStmts) {
        const stmts = [...currStmts];
        const componentExpressionPosition = Position_1.FullPosition.buildFromNode(componentExpression, this.sourceFile);
        const classSignature = ArkSignatureBuilder_1.ArkSignatureBuilder.buildClassSignatureFromClassName(componentName);
        const classType = new Type_1.ClassType(classSignature);
        const newExpr = new Expr_1.ArkNewExpr(classType);
        const { value: newExprLocal, valueOriginalPositions: newExprPositions, stmts: newExprStmts, } = this.arkIRTransformer.generateAssignStmtForValue(newExpr, [componentExpressionPosition]);
        newExprStmts.forEach(stmt => stmts.push(stmt));
        const constructorMethodSubSignature = ArkSignatureBuilder_1.ArkSignatureBuilder.buildMethodSubSignatureFromMethodName(TSConst_1.CONSTRUCTOR_NAME);
        const constructorMethodSignature = new ArkSignature_1.MethodSignature(classSignature, constructorMethodSubSignature);
        const instanceInvokeExpr = new Expr_1.ArkInstanceInvokeExpr(newExprLocal, constructorMethodSignature, args);
        const instanceInvokeExprPositions = [componentExpressionPosition, ...newExprPositions, ...argPositionsAllFlat];
        const instanceInvokeStmt = new Stmt_1.ArkInvokeStmt(instanceInvokeExpr);
        instanceInvokeStmt.setOperandOriginalPositions(instanceInvokeExprPositions);
        stmts.push(instanceInvokeStmt);
        const createViewArgs = [newExprLocal];
        const createViewArgPositionsAll = [newExprPositions];
        if (ts.isEtsComponentExpression(componentExpression) && componentExpression.body) {
            const anonymous = ts.factory.createArrowFunction([], [], [], undefined, undefined, componentExpression.body);
            // @ts-expect-error: add pos info for the created ArrowFunction
            anonymous.pos = componentExpression.body.pos;
            // @ts-expect-error: add end info for the created ArrowFunction
            anonymous.end = componentExpression.body.end;
            const { value: builderMethod, valueOriginalPositions: builderMethodPositions, } = this.callableNodeToValueAndStmts(anonymous);
            createViewArgs.push(builderMethod);
            createViewArgPositionsAll.push(builderMethodPositions);
        }
        const { value: componentValue, valueOriginalPositions: componentPositions, stmts: componentStmts, } = this.generateComponentCreationStmts(EtsConst_1.COMPONENT_CUSTOMVIEW, createViewArgs, componentExpressionPosition, createViewArgPositionsAll.flat());
        componentStmts.forEach(stmt => stmts.push(stmt));
        stmts.push(this.generateComponentPopStmts(EtsConst_1.COMPONENT_CUSTOMVIEW, componentExpressionPosition));
        return { value: componentValue, valueOriginalPositions: componentPositions, stmts: stmts };
    }
    generateComponentCreationStmts(componentName, createArgs, componentExpressionPosition, createArgsPositionsAllFlat) {
        const createMethodSignature = ArkSignatureBuilder_1.ArkSignatureBuilder.buildMethodSignatureFromClassNameAndMethodName(componentName, EtsConst_1.COMPONENT_CREATE_FUNCTION);
        const createInvokeExpr = new Expr_1.ArkStaticInvokeExpr(createMethodSignature, createArgs);
        const createInvokeExprPositions = [componentExpressionPosition, ...createArgsPositionsAllFlat];
        const { value: componentValue, valueOriginalPositions: componentPositions, stmts: componentStmts, } = this.arkIRTransformer.generateAssignStmtForValue(createInvokeExpr, createInvokeExprPositions);
        return { value: componentValue, valueOriginalPositions: componentPositions, stmts: componentStmts };
    }
    generateComponentPopStmts(componentName, componentExpressionPosition) {
        const popMethodSignature = ArkSignatureBuilder_1.ArkSignatureBuilder.buildMethodSignatureFromClassNameAndMethodName(componentName, EtsConst_1.COMPONENT_POP_FUNCTION);
        const popInvokeExpr = new Expr_1.ArkStaticInvokeExpr(popMethodSignature, []);
        const popInvokeExprPositions = [componentExpressionPosition];
        const popInvokeStmt = new Stmt_1.ArkInvokeStmt(popInvokeExpr);
        popInvokeStmt.setOperandOriginalPositions(popInvokeExprPositions);
        return popInvokeStmt;
    }
    etsComponentExpressionToValueAndStmts(etsComponentExpression) {
        const stmts = [];
        const componentName = etsComponentExpression.expression.text;
        const { args: args, argPositions: argPositions } = this.parseArguments(stmts, etsComponentExpression.arguments);
        if ((0, EtsConst_1.isEtsSystemComponent)(componentName)) {
            return this.generateSystemComponentStmt(componentName, args, argPositions, etsComponentExpression, stmts);
        }
        return this.generateCustomViewStmt(componentName, args, argPositions, etsComponentExpression, stmts);
    }
    classExpressionToValueAndStmts(classExpression) {
        const declaringArkClass = this.declaringMethod.getDeclaringArkClass();
        const declaringArkNamespace = declaringArkClass.getDeclaringArkNamespace();
        const newClass = new ArkClass_1.ArkClass();
        if (declaringArkNamespace) {
            (0, ArkClassBuilder_1.buildNormalArkClassFromArkNamespace)(classExpression, declaringArkNamespace, newClass, this.sourceFile, this.declaringMethod);
            declaringArkNamespace.addArkClass(newClass);
        }
        else {
            const declaringArkFile = declaringArkClass.getDeclaringArkFile();
            (0, ArkClassBuilder_1.buildNormalArkClassFromArkFile)(classExpression, declaringArkFile, newClass, this.sourceFile, this.declaringMethod);
            declaringArkFile.addArkClass(newClass);
        }
        const classValue = this.addNewLocal(newClass.getName(), new Type_1.ClassType(newClass.getSignature()));
        return {
            value: classValue,
            valueOriginalPositions: [Position_1.FullPosition.buildFromNode(classExpression, this.sourceFile)],
            stmts: [],
        };
    }
    templateExpressionToValueAndStmts(templateExpression) {
        const { stmts, stringTextValues, placeholderValues, stringTextPositions, placeholderPositions } = this.collectTemplateValues(templateExpression);
        const { placeholderStringLocals, placeholderStringLocalPositions, newStmts } = this.processTemplatePlaceholders(placeholderValues, placeholderPositions, stmts);
        return this.combineTemplateParts(stringTextValues, stringTextPositions, placeholderStringLocals, placeholderStringLocalPositions, newStmts);
    }
    processTemplatePlaceholders(placeholderValues, placeholderPositions, currStmts) {
        const placeholderStringLocals = [];
        const placeholderStringLocalPositions = [];
        const newStmts = [...currStmts];
        for (let i = 0; i < placeholderValues.length; i++) {
            let placeholderValue = placeholderValues[i];
            let placeholderPosition = [placeholderPositions[i]];
            let placeholderStmts = [];
            if (!(placeholderValue instanceof Local_1.Local)) {
                ({ value: placeholderValue, valueOriginalPositions: placeholderPosition, stmts: placeholderStmts } =
                    this.arkIRTransformer.generateAssignStmtForValue(placeholderValue, placeholderPosition));
            }
            placeholderStmts.forEach(stmt => newStmts.push(stmt));
            const toStringExpr = new Expr_1.ArkInstanceInvokeExpr(placeholderValue, Builtin_1.Builtin.TO_STRING_METHOD_SIGNATURE, []);
            const toStringExprPosition = [placeholderPosition[0], placeholderPosition[0]];
            const { value: placeholderStringLocal, valueOriginalPositions: placeholderStringPositions, stmts: toStringStmts, } = this.arkIRTransformer.generateAssignStmtForValue(toStringExpr, toStringExprPosition);
            placeholderStringLocals.push(placeholderStringLocal);
            placeholderStringLocalPositions.push(placeholderStringPositions[0]);
            toStringStmts.forEach(stmt => newStmts.push(stmt));
        }
        return { placeholderStringLocals, placeholderStringLocalPositions, newStmts };
    }
    combineTemplateParts(stringTextValues, stringTextPositions, placeholderStringLocals, placeholderStringLocalPositions, currStmts) {
        const templateParts = [];
        const templatePartPositions = [];
        for (let i = 0; i < placeholderStringLocals.length; i++) {
            if (stringTextValues[i] !== ValueUtil_1.ValueUtil.EMPTY_STRING_CONSTANT) {
                templateParts.push(stringTextValues[i]);
                templatePartPositions.push(stringTextPositions[i]);
            }
            templateParts.push(placeholderStringLocals[i]);
            templatePartPositions.push(placeholderStringLocalPositions[i]);
        }
        if (stringTextValues[stringTextValues.length - 1] !== ValueUtil_1.ValueUtil.EMPTY_STRING_CONSTANT) {
            templateParts.push(stringTextValues[stringTextValues.length - 1]);
            templatePartPositions.push(stringTextPositions[stringTextPositions.length - 1]);
        }
        let currTemplateResult = templateParts[0];
        let currTemplateResultPosition = templatePartPositions[0];
        const finalStmts = [...currStmts];
        for (let i = 1; i < templateParts.length; i++) {
            const nextTemplatePartPosition = templatePartPositions[i];
            const normalBinopExpr = new Expr_1.ArkNormalBinopExpr(currTemplateResult, templateParts[i], Expr_1.NormalBinaryOperator.Addition);
            const normalBinopExprPositions = [Position_1.FullPosition.merge(currTemplateResultPosition, nextTemplatePartPosition),
                currTemplateResultPosition, nextTemplatePartPosition];
            const { value: combinationValue, valueOriginalPositions: combinationValuePositions, stmts: combinationStmts, } = this.arkIRTransformer.generateAssignStmtForValue(normalBinopExpr, normalBinopExprPositions);
            combinationStmts.forEach(stmt => finalStmts.push(stmt));
            currTemplateResult = combinationValue;
            currTemplateResultPosition = combinationValuePositions[0];
        }
        return { value: currTemplateResult, valueOriginalPositions: [currTemplateResultPosition], stmts: finalStmts };
    }
    taggedTemplateExpressionToValueAndStmts(taggedTemplateExpression) {
        const { stmts, stringTextValues, placeholderValues, stringTextPositions, placeholderPositions, } = this.collectTemplateValues(taggedTemplateExpression.template);
        const stringTextBaseType = Type_1.StringType.getInstance();
        const stringTextArrayLen = stringTextValues.length;
        const stringTextArrayLenValue = ValueUtil_1.ValueUtil.getOrCreateNumberConst(stringTextArrayLen);
        const stringTextArrayLenPosition = Position_1.FullPosition.DEFAULT;
        const { value: templateObjectLocal, valueOriginalPositions: templateObjectLocalPositions, stmts: templateObjectStmts, } = this.generateArrayExprAndStmts(stringTextBaseType, stringTextArrayLenValue, stringTextArrayLenPosition, stringTextArrayLen, stringTextValues, stringTextPositions, stmts, Position_1.FullPosition.DEFAULT, true);
        const placeholderBaseType = Type_1.AnyType.getInstance();
        const placeholdersArrayLen = placeholderValues.length;
        const placeholdersArrayLenValue = ValueUtil_1.ValueUtil.getOrCreateNumberConst(placeholdersArrayLen);
        const placeholdersArrayLenPosition = Position_1.FullPosition.DEFAULT;
        const { value: placeholdersLocal, valueOriginalPositions: placeholdersLocalPositions, stmts: placeholdersStmts, } = this.generateArrayExprAndStmts(placeholderBaseType, placeholdersArrayLenValue, placeholdersArrayLenPosition, placeholdersArrayLen, placeholderValues, placeholderPositions, templateObjectStmts, Position_1.FullPosition.DEFAULT, true);
        const taggedFuncArgus = {
            realGenericTypes: undefined, args: [templateObjectLocal, placeholdersLocal],
            argPositions: [templateObjectLocalPositions[0], placeholdersLocalPositions[0]],
        };
        return this.generateInvokeValueAndStmts(taggedTemplateExpression.tag, taggedFuncArgus, placeholdersStmts, taggedTemplateExpression);
    }
    collectTemplateValues(templateLiteral) {
        const stmts = [];
        if (ts.isNoSubstitutionTemplateLiteral(templateLiteral)) {
            const templateLiteralString = templateLiteral.getText(this.sourceFile);
            return {
                stmts: [], stringTextValues: [ValueUtil_1.ValueUtil.createStringConst(templateLiteralString)],
                placeholderValues: [],
                stringTextPositions: [Position_1.FullPosition.buildFromNode(templateLiteral, this.sourceFile)],
                placeholderPositions: [],
            };
        }
        const head = templateLiteral.head;
        const stringTextValues = [ValueUtil_1.ValueUtil.createStringConst(head.rawText || '')];
        const placeholderValues = [];
        const stringTextPositions = [Position_1.FullPosition.buildFromNode(head, this.sourceFile)];
        const placeholderPositions = [];
        for (const templateSpan of templateLiteral.templateSpans) {
            let { value: exprValue, valueOriginalPositions: exprPositions, stmts: exprStmts, } = this.tsNodeToValueAndStmts(templateSpan.expression);
            exprStmts.forEach(stmt => stmts.push(stmt));
            if (IRUtils_1.IRUtils.moreThanOneAddress(exprValue)) {
                ({ value: exprValue, valueOriginalPositions: exprPositions, stmts: exprStmts } =
                    this.arkIRTransformer.generateAssignStmtForValue(exprValue, exprPositions));
                exprStmts.forEach(stmt => stmts.push(stmt));
            }
            placeholderValues.push(exprValue);
            placeholderPositions.push(exprPositions[0]);
            stringTextPositions.push(Position_1.FullPosition.buildFromNode(templateSpan.literal, this.sourceFile));
            stringTextValues.push(ValueUtil_1.ValueUtil.createStringConst(templateSpan.literal.rawText || ''));
        }
        return { stmts, stringTextValues, placeholderValues, stringTextPositions, placeholderPositions };
    }
    identifierToValueAndStmts(identifier, variableDefFlag = false) {
        let identifierValue;
        let identifierPositions = [Position_1.FullPosition.buildFromNode(identifier, this.sourceFile)];
        if (identifier.text === Type_1.UndefinedType.getInstance().getName()) {
            identifierValue = ValueUtil_1.ValueUtil.getUndefinedConst();
        }
        else {
            if (variableDefFlag) {
                identifierValue = this.addNewLocal(identifier.text);
            }
            else {
                identifierValue = this.getOrCreateLocal(identifier.text);
            }
        }
        return { value: identifierValue, valueOriginalPositions: identifierPositions, stmts: [] };
    }
    propertyAccessExpressionToValue(propertyAccessExpression) {
        const stmts = [];
        let { value: baseValue, valueOriginalPositions: basePositions, stmts: baseStmts, } = this.tsNodeToValueAndStmts(propertyAccessExpression.expression);
        baseStmts.forEach(stmt => stmts.push(stmt));
        if (IRUtils_1.IRUtils.moreThanOneAddress(baseValue)) {
            ({ value: baseValue, valueOriginalPositions: basePositions, stmts: baseStmts } =
                this.arkIRTransformer.generateAssignStmtForValue(baseValue, basePositions));
            baseStmts.forEach(stmt => stmts.push(stmt));
        }
        if (!(baseValue instanceof Local_1.Local)) {
            ({ value: baseValue, valueOriginalPositions: basePositions, stmts: baseStmts } =
                this.arkIRTransformer.generateAssignStmtForValue(baseValue, basePositions));
            baseStmts.forEach(stmt => stmts.push(stmt));
        }
        const fieldSignature = ArkSignatureBuilder_1.ArkSignatureBuilder.buildFieldSignatureFromFieldName(propertyAccessExpression.name.getText(this.sourceFile));
        const fieldRef = new Ref_1.ArkInstanceFieldRef(baseValue, fieldSignature);
        const fieldRefPositions = [Position_1.FullPosition.buildFromNode(propertyAccessExpression, this.sourceFile), ...basePositions];
        return { value: fieldRef, valueOriginalPositions: fieldRefPositions, stmts: stmts };
    }
    elementAccessExpressionToValueAndStmts(elementAccessExpression) {
        const stmts = [];
        let { value: baseValue, valueOriginalPositions: basePositions, stmts: baseStmts } = this.tsNodeToValueAndStmts(elementAccessExpression.expression);
        baseStmts.forEach(stmt => stmts.push(stmt));
        if (!(baseValue instanceof Local_1.Local)) {
            ({ value: baseValue, valueOriginalPositions: basePositions, stmts: baseStmts } =
                this.arkIRTransformer.generateAssignStmtForValue(baseValue, basePositions));
            baseStmts.forEach(stmt => stmts.push(stmt));
        }
        let { value: argumentValue, valueOriginalPositions: arguPositions, stmts: argumentStmts, } = this.tsNodeToValueAndStmts(elementAccessExpression.argumentExpression);
        argumentStmts.forEach(stmt => stmts.push(stmt));
        if (IRUtils_1.IRUtils.moreThanOneAddress(argumentValue)) {
            ({ value: argumentValue, valueOriginalPositions: arguPositions, stmts: argumentStmts } =
                this.arkIRTransformer.generateAssignStmtForValue(argumentValue, arguPositions));
            argumentStmts.forEach(stmt => stmts.push(stmt));
        }
        let elementAccessExpr;
        if (baseValue.getType() instanceof Type_1.ArrayType) {
            elementAccessExpr = new Ref_1.ArkArrayRef(baseValue, argumentValue);
        }
        else {
            // TODO: deal with ArkStaticFieldRef
            const fieldSignature = ArkSignatureBuilder_1.ArkSignatureBuilder.buildFieldSignatureFromFieldName(argumentValue.toString());
            elementAccessExpr = new Ref_1.ArkInstanceFieldRef(baseValue, fieldSignature);
        }
        // reserve positions for field name
        const exprPositions = [Position_1.FullPosition.buildFromNode(elementAccessExpression, this.sourceFile), ...basePositions,
            ...arguPositions];
        return { value: elementAccessExpr, valueOriginalPositions: exprPositions, stmts: stmts };
    }
    callExpressionToValueAndStmts(callExpression) {
        const stmts = [];
        const argus = this.parseArgumentsOfCallExpression(stmts, callExpression);
        return this.generateInvokeValueAndStmts(callExpression.expression, argus, stmts, callExpression);
    }
    generateInvokeValueAndStmts(functionNameNode, argus, currStmts, callExpression) {
        const stmts = [...currStmts];
        let { value: callerValue, valueOriginalPositions: callerPositions, stmts: callerStmts, } = this.tsNodeToValueAndStmts(functionNameNode);
        callerStmts.forEach(stmt => stmts.push(stmt));
        let invokeValue;
        let invokeValuePositions = [Position_1.FullPosition.buildFromNode(callExpression, this.sourceFile)];
        const { args, argPositions, realGenericTypes } = argus;
        if (callerValue instanceof Ref_1.ArkInstanceFieldRef) {
            const methodSignature = ArkSignatureBuilder_1.ArkSignatureBuilder.buildMethodSignatureFromMethodName(callerValue.getFieldName());
            invokeValue = new Expr_1.ArkInstanceInvokeExpr(callerValue.getBase(), methodSignature, args, realGenericTypes);
            invokeValuePositions.push(...callerPositions.slice(1), ...argPositions);
        }
        else if (callerValue instanceof Ref_1.ArkStaticFieldRef) {
            const methodSignature = ArkSignatureBuilder_1.ArkSignatureBuilder.buildMethodSignatureFromMethodName(callerValue.getFieldName());
            invokeValue = new Expr_1.ArkStaticInvokeExpr(methodSignature, args, realGenericTypes);
            invokeValuePositions.push(...argPositions);
        }
        else if (callerValue instanceof Local_1.Local) {
            const callerName = callerValue.getName();
            let classSignature = ArkSignatureBuilder_1.ArkSignatureBuilder.buildClassSignatureFromClassName(callerName);
            let cls = ModelUtils_1.ModelUtils.getClass(this.declaringMethod, classSignature);
            if ((cls === null || cls === void 0 ? void 0 : cls.hasComponentDecorator()) && ts.isCallExpression(callExpression)) {
                return this.generateCustomViewStmt(callerName, args, argPositions, callExpression, stmts);
            }
            else if ((callerName === EtsConst_1.COMPONENT_FOR_EACH || callerName === EtsConst_1.COMPONENT_LAZY_FOR_EACH) &&
                ts.isCallExpression(callExpression)) { // foreach/lazyforeach will be parsed as ts.callExpression
                return this.generateSystemComponentStmt(callerName, args, argPositions, callExpression, stmts);
            }
            const methodSignature = ArkSignatureBuilder_1.ArkSignatureBuilder.buildMethodSignatureFromMethodName(callerName);
            if (callerValue.getType() instanceof Type_1.FunctionType) {
                invokeValue = new Expr_1.ArkPtrInvokeExpr(methodSignature, callerValue, args, realGenericTypes);
            }
            else {
                invokeValue = new Expr_1.ArkStaticInvokeExpr(methodSignature, args, realGenericTypes);
            }
            invokeValuePositions.push(...argPositions);
        }
        else {
            ({ value: callerValue, valueOriginalPositions: callerPositions, stmts: callerStmts } =
                this.arkIRTransformer.generateAssignStmtForValue(callerValue, callerPositions));
            callerStmts.forEach(stmt => stmts.push(stmt));
            const methodSignature = ArkSignatureBuilder_1.ArkSignatureBuilder.buildMethodSignatureFromMethodName(callerValue.getName());
            invokeValue = new Expr_1.ArkStaticInvokeExpr(methodSignature, args, realGenericTypes);
            invokeValuePositions.push(...argPositions);
        }
        return { value: invokeValue, valueOriginalPositions: invokeValuePositions, stmts: stmts };
    }
    parseArgumentsOfCallExpression(currStmts, callExpression) {
        let realGenericTypes;
        if (callExpression.typeArguments) {
            realGenericTypes = [];
            callExpression.typeArguments.forEach(typeArgument => {
                realGenericTypes.push(this.resolveTypeNode(typeArgument));
            });
        }
        let builderMethodIndexes;
        if (ts.isIdentifier(callExpression.expression)) {
            const callerName = callExpression.expression.text;
            if (callerName === EtsConst_1.COMPONENT_FOR_EACH || callerName === EtsConst_1.COMPONENT_LAZY_FOR_EACH) {
                builderMethodIndexes = new Set([1]);
            }
        }
        const { args: args, argPositions: argPositions } = this.parseArguments(currStmts, callExpression.arguments, builderMethodIndexes);
        return { realGenericTypes: realGenericTypes, args: args, argPositions: argPositions };
    }
    parseArguments(currStmts, argumentNodes, builderMethodIndexes) {
        const args = [];
        const argPositions = [];
        if (argumentNodes) {
            for (let i = 0; i < argumentNodes.length; i++) {
                const argument = argumentNodes[i];
                const prevBuilderMethodContextFlag = this.builderMethodContextFlag;
                if (builderMethodIndexes === null || builderMethodIndexes === void 0 ? void 0 : builderMethodIndexes.has(i)) {
                    this.builderMethodContextFlag = true;
                    this.arkIRTransformer.setBuilderMethodContextFlag(true);
                }
                let { value: argValue, valueOriginalPositions: argPositionsSingle, stmts: argStmts, } = this.tsNodeToValueAndStmts(argument);
                this.builderMethodContextFlag = prevBuilderMethodContextFlag;
                this.arkIRTransformer.setBuilderMethodContextFlag(prevBuilderMethodContextFlag);
                argStmts.forEach(s => currStmts.push(s));
                if (IRUtils_1.IRUtils.moreThanOneAddress(argValue)) {
                    ({ value: argValue, valueOriginalPositions: argPositionsSingle, stmts: argStmts } =
                        this.arkIRTransformer.generateAssignStmtForValue(argValue, argPositionsSingle));
                    argStmts.forEach(s => currStmts.push(s));
                }
                args.push(argValue);
                argPositions.push(argPositionsSingle[0]);
            }
        }
        return { args: args, argPositions: argPositions };
    }
    callableNodeToValueAndStmts(callableNode) {
        const declaringClass = this.declaringMethod.getDeclaringArkClass();
        const arrowArkMethod = new ArkMethod_1.ArkMethod();
        if (this.builderMethodContextFlag) {
            ModelUtils_1.ModelUtils.implicitArkUIBuilderMethods.add(arrowArkMethod);
        }
        (0, ArkMethodBuilder_1.buildArkMethodFromArkClass)(callableNode, declaringClass, arrowArkMethod, this.sourceFile, this.declaringMethod);
        const callableType = new Type_1.FunctionType(arrowArkMethod.getSignature());
        const callableValue = this.addNewLocal(arrowArkMethod.getName(), callableType);
        return {
            value: callableValue,
            valueOriginalPositions: [Position_1.FullPosition.buildFromNode(callableNode, this.sourceFile)],
            stmts: [],
        };
    }
    newExpressionToValueAndStmts(newExpression) {
        let className = '';
        if (ts.isClassExpression(newExpression.expression) && newExpression.expression.name) {
            className = newExpression.expression.name.text;
        }
        else {
            className = newExpression.expression.getText(this.sourceFile);
        }
        if (className === Builtin_1.Builtin.ARRAY) {
            return this.newArrayExpressionToValueAndStmts(newExpression);
        }
        const stmts = [];
        let realGenericTypes;
        if (newExpression.typeArguments) {
            realGenericTypes = [];
            newExpression.typeArguments.forEach(typeArgument => {
                realGenericTypes.push(this.resolveTypeNode(typeArgument));
            });
        }
        const classSignature = ArkSignatureBuilder_1.ArkSignatureBuilder.buildClassSignatureFromClassName(className);
        const classType = new Type_1.ClassType(classSignature, realGenericTypes);
        const newExpr = new Expr_1.ArkNewExpr(classType);
        const { value: newLocal, valueOriginalPositions: newLocalPositions, stmts: newExprStmts, } = this.arkIRTransformer.generateAssignStmtForValue(newExpr, [Position_1.FullPosition.buildFromNode(newExpression, this.sourceFile)]);
        newExprStmts.forEach(stmt => stmts.push(stmt));
        const constructorMethodSubSignature = ArkSignatureBuilder_1.ArkSignatureBuilder.buildMethodSubSignatureFromMethodName(TSConst_1.CONSTRUCTOR_NAME);
        const constructorMethodSignature = new ArkSignature_1.MethodSignature(classSignature, constructorMethodSubSignature);
        const { args: argValues, argPositions: argPositions } = this.parseArguments(stmts, newExpression.arguments);
        const instanceInvokeExpr = new Expr_1.ArkInstanceInvokeExpr(newLocal, constructorMethodSignature, argValues);
        const instanceInvokeExprPositions = [newLocalPositions[0], ...newLocalPositions, ...argPositions];
        const invokeStmt = new Stmt_1.ArkInvokeStmt(instanceInvokeExpr);
        invokeStmt.setOperandOriginalPositions(instanceInvokeExprPositions);
        stmts.push(invokeStmt);
        return { value: newLocal, valueOriginalPositions: newLocalPositions, stmts: stmts };
    }
    newArrayExpressionToValueAndStmts(newArrayExpression) {
        let baseType = Type_1.UnknownType.getInstance();
        if (newArrayExpression.typeArguments && newArrayExpression.typeArguments.length > 0) {
            const argumentType = this.resolveTypeNode(newArrayExpression.typeArguments[0]);
            if (!(argumentType instanceof Type_1.AnyType || argumentType instanceof Type_1.UnknownType)) {
                baseType = argumentType;
            }
        }
        const stmts = [];
        const { args: argumentValues, argPositions: argPositions } = this.parseArguments(stmts, newArrayExpression.arguments);
        let argumentsLength = newArrayExpression.arguments ? newArrayExpression.arguments.length : 0;
        let arrayLengthValue;
        let arrayLength = -1;
        let arrayLengthPosition = Position_1.FullPosition.DEFAULT;
        if ((argumentsLength === 1) &&
            ((argumentValues[0].getType() instanceof Type_1.NumberType) || argumentValues[0].getType() instanceof
                Type_1.UnknownType)) {
            arrayLengthValue = argumentValues[0];
            arrayLengthPosition = argPositions[0];
        }
        else {
            arrayLengthValue = ValueUtil_1.ValueUtil.getOrCreateNumberConst(argumentsLength);
            arrayLength = argumentsLength;
        }
        if (baseType instanceof Type_1.UnknownType) {
            if ((argumentsLength > 1) && !(argumentValues[0].getType() instanceof Type_1.UnknownType)) {
                baseType = argumentValues[0].getType();
            }
            else {
                baseType = Type_1.AnyType.getInstance();
            }
        }
        const newArrayExprPosition = Position_1.FullPosition.buildFromNode(newArrayExpression, this.sourceFile);
        return this.generateArrayExprAndStmts(baseType, arrayLengthValue, arrayLengthPosition, arrayLength, argumentValues, argPositions, stmts, newArrayExprPosition, false);
    }
    arrayLiteralExpressionToValueAndStmts(arrayLiteralExpression) {
        const stmts = [];
        const elementTypes = new Set();
        const elementValues = [];
        const elementPositions = [];
        const arrayLength = arrayLiteralExpression.elements.length;
        for (const element of arrayLiteralExpression.elements) {
            let { value: elementValue, valueOriginalPositions: elementPosition, stmts: elementStmts, } = this.tsNodeToValueAndStmts(element);
            elementStmts.forEach(stmt => stmts.push(stmt));
            if (IRUtils_1.IRUtils.moreThanOneAddress(elementValue)) {
                ({ value: elementValue, valueOriginalPositions: elementPosition, stmts: elementStmts } =
                    this.arkIRTransformer.generateAssignStmtForValue(elementValue, elementPosition));
                elementStmts.forEach(stmt => stmts.push(stmt));
            }
            elementValues.push(elementValue);
            elementTypes.add(elementValue.getType());
            elementPositions.push(elementPosition[0]);
        }
        let baseType = Type_1.AnyType.getInstance();
        if (elementTypes.size === 1) {
            baseType = elementTypes.keys().next().value;
        }
        else if (elementTypes.size > 1) {
            baseType = new Type_1.UnionType(Array.from(elementTypes));
        }
        const newArrayExprPosition = Position_1.FullPosition.buildFromNode(arrayLiteralExpression, this.sourceFile);
        return this.generateArrayExprAndStmts(baseType, ValueUtil_1.ValueUtil.getOrCreateNumberConst(arrayLength), Position_1.FullPosition.DEFAULT, arrayLength, elementValues, elementPositions, stmts, newArrayExprPosition, true);
    }
    generateArrayExprAndStmts(baseType, arrayLengthValue, arrayLengthPosition, arrayLength, initializerValues, initializerPositions, currStmts, newArrayExprPosition, fromLiteral) {
        const stmts = [...currStmts];
        const newArrayExpr = new Expr_1.ArkNewArrayExpr(baseType, arrayLengthValue, fromLiteral);
        const newArrayExprPositions = [newArrayExprPosition, arrayLengthPosition];
        const { value: arrayLocal, valueOriginalPositions: arrayLocalPositions, stmts: arrayStmts, } = this.arkIRTransformer.generateAssignStmtForValue(newArrayExpr, newArrayExprPositions);
        arrayStmts.forEach(stmt => stmts.push(stmt));
        for (let i = 0; i < arrayLength; i++) {
            const indexValue = ValueUtil_1.ValueUtil.getOrCreateNumberConst(i);
            const arrayRef = new Ref_1.ArkArrayRef(arrayLocal, indexValue);
            const arrayRefPositions = [arrayLocalPositions[0], ...arrayLocalPositions, Position_1.FullPosition.DEFAULT];
            const assignStmt = new Stmt_1.ArkAssignStmt(arrayRef, initializerValues[i]);
            assignStmt.setOperandOriginalPositions([...arrayRefPositions, initializerPositions[i]]);
            stmts.push(assignStmt);
        }
        return { value: arrayLocal, valueOriginalPositions: arrayLocalPositions, stmts: stmts };
    }
    prefixUnaryExpressionToValueAndStmts(prefixUnaryExpression) {
        const stmts = [];
        let { value: operandValue, valueOriginalPositions: operandPositions, stmts: operandStmts, } = this.tsNodeToValueAndStmts(prefixUnaryExpression.operand);
        operandStmts.forEach(stmt => stmts.push(stmt));
        if (IRUtils_1.IRUtils.moreThanOneAddress(operandValue)) {
            ({ value: operandValue, valueOriginalPositions: operandPositions, stmts: operandStmts } =
                this.arkIRTransformer.generateAssignStmtForValue(operandValue, operandPositions));
            operandStmts.forEach(stmt => stmts.push(stmt));
        }
        const operatorToken = prefixUnaryExpression.operator;
        let exprPositions = [Position_1.FullPosition.buildFromNode(prefixUnaryExpression, this.sourceFile)];
        if (operatorToken === ts.SyntaxKind.PlusPlusToken || operatorToken === ts.SyntaxKind.MinusMinusToken) {
            const binaryOperator = operatorToken === ts.SyntaxKind.PlusPlusToken ? Expr_1.NormalBinaryOperator.Addition : Expr_1.NormalBinaryOperator.Subtraction;
            const binopExpr = new Expr_1.ArkNormalBinopExpr(operandValue, ValueUtil_1.ValueUtil.getOrCreateNumberConst(1), binaryOperator);
            exprPositions.push(...operandPositions, Position_1.FullPosition.DEFAULT);
            const assignStmt = new Stmt_1.ArkAssignStmt(operandValue, binopExpr);
            assignStmt.setOperandOriginalPositions([...operandPositions, ...exprPositions]);
            stmts.push(assignStmt);
            return { value: operandValue, valueOriginalPositions: operandPositions, stmts: stmts };
        }
        else if (operatorToken === ts.SyntaxKind.PlusToken) {
            return { value: operandValue, valueOriginalPositions: operandPositions, stmts: stmts };
        }
        else {
            let unopExpr;
            const operator = ArkIRTransformer_1.ArkIRTransformer.tokenToUnaryOperator(operatorToken);
            if (operator) {
                unopExpr = new Expr_1.ArkUnopExpr(operandValue, operator);
                exprPositions.push(...operandPositions);
            }
            else {
                unopExpr = ValueUtil_1.ValueUtil.getUndefinedConst();
                exprPositions = [Position_1.FullPosition.DEFAULT];
            }
            return { value: unopExpr, valueOriginalPositions: exprPositions, stmts: stmts };
        }
    }
    postfixUnaryExpressionToValueAndStmts(postfixUnaryExpression) {
        const stmts = [];
        let { value: operandValue, valueOriginalPositions: operandPositions, stmts: exprStmts, } = this.tsNodeToValueAndStmts(postfixUnaryExpression.operand);
        exprStmts.forEach(stmt => stmts.push(stmt));
        if (IRUtils_1.IRUtils.moreThanOneAddress(operandValue)) {
            ({ value: operandValue, valueOriginalPositions: operandPositions, stmts: exprStmts } =
                this.arkIRTransformer.generateAssignStmtForValue(operandValue, operandPositions));
            exprStmts.forEach(stmt => stmts.push(stmt));
        }
        let value;
        let exprPositions = [Position_1.FullPosition.buildFromNode(postfixUnaryExpression, this.sourceFile)];
        const operatorToken = postfixUnaryExpression.operator;
        if (operatorToken === ts.SyntaxKind.PlusPlusToken || operatorToken === ts.SyntaxKind.MinusMinusToken) {
            const binaryOperator = operatorToken === ts.SyntaxKind.PlusPlusToken ? Expr_1.NormalBinaryOperator.Addition : Expr_1.NormalBinaryOperator.Subtraction;
            const binopExpr = new Expr_1.ArkNormalBinopExpr(operandValue, ValueUtil_1.ValueUtil.getOrCreateNumberConst(1), binaryOperator);
            exprPositions.push(...operandPositions, Position_1.FullPosition.DEFAULT);
            const assignStmt = new Stmt_1.ArkAssignStmt(operandValue, binopExpr);
            assignStmt.setOperandOriginalPositions([...operandPositions, ...exprPositions]);
            stmts.push(assignStmt);
            value = operandValue;
        }
        else {
            value = ValueUtil_1.ValueUtil.getUndefinedConst();
            exprPositions = [Position_1.FullPosition.DEFAULT];
        }
        return { value: value, valueOriginalPositions: exprPositions, stmts: stmts };
    }
    awaitExpressionToValueAndStmts(awaitExpression) {
        const stmts = [];
        let { value: promiseValue, valueOriginalPositions: promisePositions, stmts: promiseStmts, } = this.tsNodeToValueAndStmts(awaitExpression.expression);
        promiseStmts.forEach(stmt => stmts.push(stmt));
        if (IRUtils_1.IRUtils.moreThanOneAddress(promiseValue)) {
            ({ value: promiseValue, valueOriginalPositions: promisePositions, stmts: promiseStmts } =
                this.arkIRTransformer.generateAssignStmtForValue(promiseValue, promisePositions));
            promiseStmts.forEach(stmt => stmts.push(stmt));
        }
        const awaitExpr = new Expr_1.ArkAwaitExpr(promiseValue);
        const awaitExprPositions = [Position_1.FullPosition.buildFromNode(awaitExpression, this.sourceFile), ...promisePositions];
        return { value: awaitExpr, valueOriginalPositions: awaitExprPositions, stmts: stmts };
    }
    yieldExpressionToValueAndStmts(yieldExpression) {
        let yieldValue = ValueUtil_1.ValueUtil.getUndefinedConst();
        let yieldPositions = [Position_1.FullPosition.DEFAULT];
        let stmts = [];
        if (yieldExpression.expression) {
            ({ value: yieldValue, valueOriginalPositions: yieldPositions, stmts: stmts } =
                this.tsNodeToValueAndStmts(yieldExpression.expression));
        }
        const yieldExpr = new Expr_1.ArkYieldExpr(yieldValue);
        const yieldExprPositions = [Position_1.FullPosition.buildFromNode(yieldExpression, this.sourceFile), ...yieldPositions];
        return { value: yieldExpr, valueOriginalPositions: yieldExprPositions, stmts: stmts };
    }
    deleteExpressionToValueAndStmts(deleteExpression) {
        const { value: exprValue, valueOriginalPositions: exprPositions, stmts: stmts } = this.tsNodeToValueAndStmts(deleteExpression.expression);
        const deleteExpr = new Expr_1.ArkDeleteExpr(exprValue);
        const deleteExprPositions = [Position_1.FullPosition.buildFromNode(deleteExpression, this.sourceFile),
            ...exprPositions];
        return { value: deleteExpr, valueOriginalPositions: deleteExprPositions, stmts: stmts };
    }
    voidExpressionToValueAndStmts(voidExpression) {
        const { value: exprValue, valueOriginalPositions: exprPositions, stmts: stmts } = this.tsNodeToValueAndStmts(voidExpression.expression);
        const { stmts: exprStmts } = this.arkIRTransformer.generateAssignStmtForValue(exprValue, exprPositions);
        exprStmts.forEach(stmt => stmts.push(stmt));
        return { value: ValueUtil_1.ValueUtil.getUndefinedConst(), valueOriginalPositions: [Position_1.FullPosition.DEFAULT], stmts: stmts };
    }
    nonNullExpressionToValueAndStmts(nonNullExpression) {
        return this.tsNodeToValueAndStmts(nonNullExpression.expression);
    }
    parenthesizedExpressionToValueAndStmts(parenthesizedExpression) {
        return this.tsNodeToValueAndStmts(parenthesizedExpression.expression);
    }
    typeOfExpressionToValueAndStmts(typeOfExpression) {
        const { value: exprValue, valueOriginalPositions: exprPositions, stmts: exprStmts, } = this.tsNodeToValueAndStmts(typeOfExpression.expression);
        const typeOfExpr = new Expr_1.ArkTypeOfExpr(exprValue);
        const typeOfExprPositions = [Position_1.FullPosition.buildFromNode(typeOfExpression, this.sourceFile), ...exprPositions];
        return { value: typeOfExpr, valueOriginalPositions: typeOfExprPositions, stmts: exprStmts };
    }
    asExpressionToValueAndStmts(asExpression) {
        const stmts = [];
        let { value: exprValue, valueOriginalPositions: exprPositions, stmts: exprStmts } = this.tsNodeToValueAndStmts(asExpression.expression);
        exprStmts.forEach(stmt => stmts.push(stmt));
        if (IRUtils_1.IRUtils.moreThanOneAddress(exprValue)) {
            ({ value: exprValue, valueOriginalPositions: exprPositions, stmts: exprStmts } =
                this.arkIRTransformer.generateAssignStmtForValue(exprValue, exprPositions));
            exprStmts.forEach(stmt => stmts.push(stmt));
        }
        const castExpr = new Expr_1.ArkCastExpr(exprValue, this.resolveTypeNode(asExpression.type));
        const castExprPositions = [Position_1.FullPosition.buildFromNode(asExpression, this.sourceFile), ...exprPositions];
        return { value: castExpr, valueOriginalPositions: castExprPositions, stmts: stmts };
    }
    typeAssertionToValueAndStmts(typeAssertion) {
        const { value: exprValue, valueOriginalPositions: exprPositions, stmts: exprStmts, } = this.tsNodeToValueAndStmts(typeAssertion.expression);
        const castExpr = new Expr_1.ArkCastExpr(exprValue, this.resolveTypeNode(typeAssertion.type));
        const castExprPositions = [Position_1.FullPosition.buildFromNode(typeAssertion, this.sourceFile), ...exprPositions];
        return { value: castExpr, valueOriginalPositions: castExprPositions, stmts: exprStmts };
    }
    variableDeclarationListToValueAndStmts(variableDeclarationList) {
        const stmts = [];
        const isConst = (variableDeclarationList.flags & ts.NodeFlags.Const) !== 0;
        for (const declaration of variableDeclarationList.declarations) {
            const { stmts: declaredStmts } = this.variableDeclarationToValueAndStmts(declaration, isConst);
            declaredStmts.forEach(s => stmts.push(s));
        }
        return { value: ValueUtil_1.ValueUtil.getUndefinedConst(), valueOriginalPositions: [Position_1.FullPosition.DEFAULT], stmts: stmts };
    }
    variableDeclarationToValueAndStmts(variableDeclaration, isConst, needRightOp = true) {
        const leftOpNode = variableDeclaration.name;
        const rightOpNode = variableDeclaration.initializer;
        const declarationType = variableDeclaration.type ? this.resolveTypeNode(variableDeclaration.type) : Type_1.UnknownType.getInstance();
        return this.assignmentToValueAndStmts(leftOpNode, rightOpNode, true, isConst, declarationType, needRightOp);
    }
    assignmentToValueAndStmts(leftOpNode, rightOpNode, variableDefFlag, isConst, declarationType, needRightOp = true) {
        let leftValueAndStmts;
        if (ts.isIdentifier(leftOpNode)) {
            leftValueAndStmts = this.identifierToValueAndStmts(leftOpNode, variableDefFlag);
        }
        else if (ts.isArrayBindingPattern(leftOpNode) || ts.isArrayLiteralExpression(leftOpNode)) {
            leftValueAndStmts = this.arrayDestructuringToValueAndStmts(leftOpNode, isConst);
        }
        else if (ts.isObjectBindingPattern(leftOpNode) || ts.isObjectLiteralExpression(leftOpNode)) {
            leftValueAndStmts = this.objectDestructuringToValueAndStmts(leftOpNode, isConst);
        }
        else {
            leftValueAndStmts = this.tsNodeToValueAndStmts(leftOpNode);
        }
        const { value: leftValue, valueOriginalPositions: leftPositions, stmts: leftStmts } = leftValueAndStmts;
        let stmts = [];
        if (needRightOp) {
            const { value: rightValue, valueOriginalPositions: rightPositions, stmts: rightStmts, } = this.assignmentRightOpToValueAndStmts(rightOpNode, leftValue);
            if (leftValue instanceof Local_1.Local) {
                if (variableDefFlag) {
                    leftValue.setConstFlag(isConst);
                    leftValue.setType(declarationType);
                }
                if (leftValue.getType() instanceof Type_1.UnknownType && !(rightValue.getType() instanceof Type_1.UnknownType) &&
                    !(rightValue.getType() instanceof Type_1.UndefinedType)) {
                    leftValue.setType(rightValue.getType());
                }
            }
            const assignStmt = new Stmt_1.ArkAssignStmt(leftValue, rightValue);
            assignStmt.setOperandOriginalPositions([...leftPositions, ...rightPositions]);
            if (ts.isArrayBindingPattern(leftOpNode) || ts.isArrayLiteralExpression(leftOpNode) ||
                ts.isObjectBindingPattern(leftOpNode) || ts.isObjectLiteralExpression(leftOpNode)) {
                rightStmts.forEach(stmt => stmts.push(stmt));
                stmts.push(assignStmt);
                leftStmts.forEach(stmt => stmts.push(stmt));
            }
            else {
                rightStmts.forEach(stmt => stmts.push(stmt));
                leftStmts.forEach(stmt => stmts.push(stmt));
                stmts.push(assignStmt);
            }
        }
        else {
            stmts = leftStmts;
        }
        return { value: leftValue, valueOriginalPositions: leftPositions, stmts: stmts };
    }
    assignmentRightOpToValueAndStmts(rightOpNode, leftValue) {
        let rightValue;
        let rightPositions;
        let tempRightStmts = [];
        const rightStmts = [];
        if (rightOpNode) {
            ({ value: rightValue, valueOriginalPositions: rightPositions, stmts: tempRightStmts } =
                this.tsNodeToValueAndStmts(rightOpNode));
            tempRightStmts.forEach(stmt => rightStmts.push(stmt));
        }
        else {
            rightValue = ValueUtil_1.ValueUtil.getUndefinedConst();
            rightPositions = [Position_1.FullPosition.DEFAULT];
        }
        if (IRUtils_1.IRUtils.moreThanOneAddress(leftValue) && IRUtils_1.IRUtils.moreThanOneAddress(rightValue)) {
            ({ value: rightValue, valueOriginalPositions: rightPositions, stmts: tempRightStmts } =
                this.arkIRTransformer.generateAssignStmtForValue(rightValue, rightPositions));
            tempRightStmts.forEach(stmt => rightStmts.push(stmt));
        }
        return { value: rightValue, valueOriginalPositions: rightPositions, stmts: rightStmts };
    }
    // In assignment patterns, the left operand will be an array literal expression
    arrayDestructuringToValueAndStmts(arrayDestructuring, isConst = false) {
        const stmts = [];
        const arrayTempLocal = this.generateTempLocal();
        const leftOriginalPosition = Position_1.FullPosition.buildFromNode(arrayDestructuring, this.sourceFile);
        const elements = arrayDestructuring.elements;
        const isArrayBindingPattern = ts.isArrayBindingPattern(arrayDestructuring);
        let index = 0;
        for (const element of elements) {
            const arrayRef = new Ref_1.ArkArrayRef(arrayTempLocal, ValueUtil_1.ValueUtil.getOrCreateNumberConst(index));
            const arrayRefPositions = [leftOriginalPosition, leftOriginalPosition, Position_1.FullPosition.DEFAULT];
            const itemName = element.getText(this.sourceFile);
            const targetLocal = isArrayBindingPattern ? this.addNewLocal(itemName) : this.getOrCreateLocal(itemName);
            const targetLocalPosition = Position_1.FullPosition.buildFromNode(element, this.sourceFile);
            isArrayBindingPattern && targetLocal.setConstFlag(isConst);
            const assignStmt = new Stmt_1.ArkAssignStmt(targetLocal, arrayRef);
            assignStmt.setOperandOriginalPositions([targetLocalPosition, ...arrayRefPositions]);
            stmts.push(assignStmt);
            index++;
        }
        return { value: arrayTempLocal, valueOriginalPositions: [leftOriginalPosition], stmts: stmts };
    }
    // In assignment patterns, the left operand will be an object literal expression
    objectDestructuringToValueAndStmts(objectDestructuring, isConst = false) {
        const stmts = [];
        const objectTempLocal = this.generateTempLocal();
        const leftOriginalPosition = Position_1.FullPosition.buildFromNode(objectDestructuring, this.sourceFile);
        const isObjectBindingPattern = ts.isObjectBindingPattern(objectDestructuring);
        const elements = isObjectBindingPattern ? objectDestructuring.elements : objectDestructuring.properties;
        for (const element of elements) {
            let fieldName = '';
            let targetName = '';
            if (ts.isBindingElement(element)) {
                fieldName = element.propertyName ? element.propertyName.getText(this.sourceFile) : element.name.getText(this.sourceFile);
                targetName = element.name.getText(this.sourceFile);
            }
            else if (ts.isPropertyAssignment(element)) {
                fieldName = element.name.getText(this.sourceFile);
                targetName = element.initializer.getText(this.sourceFile);
            }
            else if (ts.isShorthandPropertyAssignment(element)) {
                fieldName = element.name.getText(this.sourceFile);
                targetName = fieldName;
            }
            else {
                continue;
            }
            const fieldSignature = ArkSignatureBuilder_1.ArkSignatureBuilder.buildFieldSignatureFromFieldName(fieldName);
            const fieldRef = new Ref_1.ArkInstanceFieldRef(objectTempLocal, fieldSignature);
            const fieldRefPositions = [leftOriginalPosition, leftOriginalPosition];
            const targetLocal = isObjectBindingPattern ? this.addNewLocal(targetName) : this.getOrCreateLocal(targetName);
            isObjectBindingPattern && targetLocal.setConstFlag(isConst);
            const targetLocalPosition = Position_1.FullPosition.buildFromNode(element, this.sourceFile);
            const assignStmt = new Stmt_1.ArkAssignStmt(targetLocal, fieldRef);
            assignStmt.setOperandOriginalPositions([targetLocalPosition, ...fieldRefPositions]);
            stmts.push(assignStmt);
        }
        return { value: objectTempLocal, valueOriginalPositions: [leftOriginalPosition], stmts: stmts };
    }
    binaryExpressionToValueAndStmts(binaryExpression) {
        const operatorToken = binaryExpression.operatorToken;
        if (operatorToken.kind === ts.SyntaxKind.FirstAssignment) {
            const leftOpNode = binaryExpression.left;
            const rightOpNode = binaryExpression.right;
            const declarationType = Type_1.UnknownType.getInstance();
            return this.assignmentToValueAndStmts(leftOpNode, rightOpNode, false, false, declarationType, true);
        }
        else if (ArkValueTransformer.isCompoundAssignmentOperator(operatorToken.kind)) {
            return this.compoundAssignmentToValueAndStmts(binaryExpression);
        }
        const stmts = [];
        const binaryExpressionPosition = Position_1.FullPosition.buildFromNode(binaryExpression, this.sourceFile);
        const { value: opValue1, valueOriginalPositions: opPositions1, stmts: opStmts1, } = this.tsNodeToSingleAddressValueAndStmts(binaryExpression.left);
        opStmts1.forEach(stmt => stmts.push(stmt));
        if (operatorToken.kind === ts.SyntaxKind.InstanceOfKeyword) {
            const instanceOfExpr = new Expr_1.ArkInstanceOfExpr(opValue1, new Type_1.UnclearReferenceType(binaryExpression.right.getText(this.sourceFile)));
            const instanceOfExprPositions = [binaryExpressionPosition, ...opPositions1];
            return { value: instanceOfExpr, valueOriginalPositions: instanceOfExprPositions, stmts: stmts };
        }
        const { value: opValue2, valueOriginalPositions: opPositions2, stmts: opStmts2, } = this.tsNodeToSingleAddressValueAndStmts(binaryExpression.right);
        opStmts2.forEach(stmt => stmts.push(stmt));
        let exprValue;
        let exprValuePositions = [binaryExpressionPosition];
        if (operatorToken.kind === ts.SyntaxKind.CommaToken) {
            exprValue = opValue2;
        }
        else {
            const operator = ArkIRTransformer_1.ArkIRTransformer.tokenToBinaryOperator(operatorToken.kind);
            if (operator) {
                if (this.isRelationalOperator(operator)) {
                    exprValue = new Expr_1.ArkConditionExpr(opValue1, opValue2, operator);
                }
                else {
                    exprValue = new Expr_1.ArkNormalBinopExpr(opValue1, opValue2, operator);
                }
                exprValuePositions.push(...opPositions1, ...opPositions2);
            }
            else {
                exprValue = ValueUtil_1.ValueUtil.getUndefinedConst();
                exprValuePositions.push(binaryExpressionPosition);
            }
        }
        return { value: exprValue, valueOriginalPositions: exprValuePositions, stmts: stmts };
    }
    compoundAssignmentToValueAndStmts(binaryExpression) {
        const stmts = [];
        let { value: leftValue, valueOriginalPositions: leftPositions, stmts: leftStmts, } = this.tsNodeToValueAndStmts(binaryExpression.left);
        leftStmts.forEach(stmt => stmts.push(stmt));
        let { value: rightValue, valueOriginalPositions: rightPositions, stmts: rightStmts, } = this.tsNodeToValueAndStmts(binaryExpression.right);
        rightStmts.forEach(stmt => stmts.push(stmt));
        if (IRUtils_1.IRUtils.moreThanOneAddress(leftValue) && IRUtils_1.IRUtils.moreThanOneAddress(rightValue)) {
            const { value: newRightValue, valueOriginalPositions: newRightPositions, stmts: rightStmts, } = this.arkIRTransformer.generateAssignStmtForValue(rightValue, rightPositions);
            rightValue = newRightValue;
            rightPositions = newRightPositions;
            rightStmts.forEach(stmt => stmts.push(stmt));
        }
        let leftOpValue;
        let leftOpPositions;
        const operator = this.compoundAssignmentTokenToBinaryOperator(binaryExpression.operatorToken.kind);
        if (operator) {
            const exprValue = new Expr_1.ArkNormalBinopExpr(leftValue, rightValue, operator);
            const exprValuePosition = Position_1.FullPosition.buildFromNode(binaryExpression, this.sourceFile);
            const assignStmt = new Stmt_1.ArkAssignStmt(leftValue, exprValue);
            assignStmt.setOperandOriginalPositions([...leftPositions, exprValuePosition, ...leftPositions, ...rightPositions]);
            stmts.push(assignStmt);
            leftOpValue = leftValue;
            leftOpPositions = leftPositions;
        }
        else {
            leftOpValue = ValueUtil_1.ValueUtil.getUndefinedConst();
            leftOpPositions = [leftPositions[0]];
        }
        return { value: leftOpValue, valueOriginalPositions: leftOpPositions, stmts: stmts };
    }
    compoundAssignmentTokenToBinaryOperator(token) {
        switch (token) {
            case ts.SyntaxKind.QuestionQuestionEqualsToken:
                return Expr_1.NormalBinaryOperator.NullishCoalescing;
            case ts.SyntaxKind.AsteriskAsteriskEqualsToken:
                return Expr_1.NormalBinaryOperator.Exponentiation;
            case ts.SyntaxKind.SlashEqualsToken:
                return Expr_1.NormalBinaryOperator.Division;
            case ts.SyntaxKind.PlusEqualsToken:
                return Expr_1.NormalBinaryOperator.Addition;
            case ts.SyntaxKind.MinusEqualsToken:
                return Expr_1.NormalBinaryOperator.Subtraction;
            case ts.SyntaxKind.AsteriskEqualsToken:
                return Expr_1.NormalBinaryOperator.Multiplication;
            case ts.SyntaxKind.PercentEqualsToken:
                return Expr_1.NormalBinaryOperator.Remainder;
            case ts.SyntaxKind.LessThanLessThanEqualsToken:
                return Expr_1.NormalBinaryOperator.LeftShift;
            case ts.SyntaxKind.GreaterThanGreaterThanEqualsToken:
                return Expr_1.NormalBinaryOperator.RightShift;
            case ts.SyntaxKind.GreaterThanGreaterThanGreaterThanEqualsToken:
                return Expr_1.NormalBinaryOperator.UnsignedRightShift;
            case ts.SyntaxKind.AmpersandEqualsToken:
                return Expr_1.NormalBinaryOperator.BitwiseAnd;
            case ts.SyntaxKind.BarEqualsToken:
                return Expr_1.NormalBinaryOperator.BitwiseOr;
            case ts.SyntaxKind.CaretEqualsToken:
                return Expr_1.NormalBinaryOperator.BitwiseXor;
            case ts.SyntaxKind.AmpersandAmpersandEqualsToken:
                return Expr_1.NormalBinaryOperator.LogicalAnd;
            case ts.SyntaxKind.BarBarEqualsToken:
                return Expr_1.NormalBinaryOperator.LogicalOr;
            default:
                ;
        }
        return null;
    }
    conditionToValueAndStmts(condition) {
        const stmts = [];
        let { value: conditionValue, valueOriginalPositions: conditionPositions, stmts: conditionStmts, } = this.tsNodeToValueAndStmts(condition);
        conditionStmts.forEach(stmt => stmts.push(stmt));
        let conditionExpr;
        if ((conditionValue instanceof Expr_1.AbstractBinopExpr) && this.isRelationalOperator(conditionValue.getOperator())) {
            const operator = conditionValue.getOperator();
            conditionExpr = new Expr_1.ArkConditionExpr(conditionValue.getOp1(), conditionValue.getOp2(), operator);
        }
        else {
            if (IRUtils_1.IRUtils.moreThanOneAddress(conditionValue)) {
                ({
                    value: conditionValue,
                    valueOriginalPositions: conditionPositions,
                    stmts: conditionStmts,
                } = this.arkIRTransformer.generateAssignStmtForValue(conditionValue, conditionPositions));
                conditionStmts.forEach(stmt => stmts.push(stmt));
            }
            conditionExpr = new Expr_1.ArkConditionExpr(conditionValue, ValueUtil_1.ValueUtil.getOrCreateNumberConst(0), Expr_1.RelationalBinaryOperator.InEquality);
            conditionPositions = [conditionPositions[0], ...conditionPositions, Position_1.FullPosition.DEFAULT];
        }
        return { value: conditionExpr, valueOriginalPositions: conditionPositions, stmts: stmts };
    }
    literalNodeToValueAndStmts(literalNode) {
        const syntaxKind = literalNode.kind;
        let constant = null;
        switch (syntaxKind) {
            case ts.SyntaxKind.NumericLiteral:
                constant = ValueUtil_1.ValueUtil.getOrCreateNumberConst(parseFloat(literalNode.text));
                break;
            case ts.SyntaxKind.BigIntLiteral:
                constant = ValueUtil_1.ValueUtil.getOrCreateNumberConst(parseInt(literalNode.text));
                break;
            case ts.SyntaxKind.StringLiteral:
                constant = ValueUtil_1.ValueUtil.createStringConst(literalNode.text);
                break;
            case ts.SyntaxKind.RegularExpressionLiteral:
                constant = new Constant_1.Constant(literalNode.text, Builtin_1.Builtin.REGEXP_CLASS_TYPE);
                break;
            case ts.SyntaxKind.NoSubstitutionTemplateLiteral:
                constant = ValueUtil_1.ValueUtil.createStringConst(literalNode.text);
                break;
            case ts.SyntaxKind.NullKeyword:
                constant = ValueUtil_1.ValueUtil.getNullConstant();
                break;
            case ts.SyntaxKind.UndefinedKeyword:
                constant = ValueUtil_1.ValueUtil.getUndefinedConst();
                break;
            case ts.SyntaxKind.TrueKeyword:
                constant = ValueUtil_1.ValueUtil.getBooleanConstant(true);
                break;
            case ts.SyntaxKind.FalseKeyword:
                constant = ValueUtil_1.ValueUtil.getBooleanConstant(false);
                break;
            default:
                logger.warn(`ast node's syntaxKind is ${ts.SyntaxKind[literalNode.kind]}, not literalNode`);
        }
        if (constant === null) {
            return null;
        }
        return {
            value: constant,
            valueOriginalPositions: [Position_1.FullPosition.buildFromNode(literalNode, this.sourceFile)],
            stmts: [],
        };
    }
    getOrCreateLocal(localName, localType = Type_1.UnknownType.getInstance()) {
        let local = this.locals.get(localName);
        if (local !== undefined) {
            return local;
        }
        local = this.addNewLocal(localName, localType);
        this.addNewGlobal(localName);
        return local;
    }
    generateTempLocal(localType = Type_1.UnknownType.getInstance()) {
        const tempLocalName = Const_1.TEMP_LOCAL_PREFIX + this.tempLocalNo;
        this.tempLocalNo++;
        const tempLocal = new Local_1.Local(tempLocalName, localType);
        this.locals.set(tempLocalName, tempLocal);
        return tempLocal;
    }
    isRelationalOperator(operator) {
        return operator === Expr_1.RelationalBinaryOperator.LessThan ||
            operator === Expr_1.RelationalBinaryOperator.LessThanOrEqual ||
            operator === Expr_1.RelationalBinaryOperator.GreaterThan ||
            operator === Expr_1.RelationalBinaryOperator.GreaterThanOrEqual ||
            operator === Expr_1.RelationalBinaryOperator.Equality ||
            operator === Expr_1.RelationalBinaryOperator.InEquality ||
            operator === Expr_1.RelationalBinaryOperator.StrictEquality ||
            operator === Expr_1.RelationalBinaryOperator.StrictInequality;
    }
    isLiteralNode(node) {
        if (ts.isStringLiteral(node) ||
            ts.isNumericLiteral(node) ||
            ts.isBigIntLiteral(node) ||
            ts.isRegularExpressionLiteral(node) ||
            ts.isNoSubstitutionTemplateLiteral(node) ||
            node.kind === ts.SyntaxKind.NullKeyword ||
            node.kind === ts.SyntaxKind.TrueKeyword ||
            node.kind === ts.SyntaxKind.FalseKeyword ||
            node.kind === ts.SyntaxKind.UndefinedKeyword) {
            return true;
        }
        return false;
    }
    resolveTypeNode(type) {
        const kind = type.kind;
        switch (kind) {
            case ts.SyntaxKind.BooleanKeyword:
                return Type_1.BooleanType.getInstance();
            case ts.SyntaxKind.NumberKeyword:
                return Type_1.NumberType.getInstance();
            case ts.SyntaxKind.StringKeyword:
                return Type_1.StringType.getInstance();
            case ts.SyntaxKind.UndefinedKeyword:
                return Type_1.UndefinedType.getInstance();
            case ts.SyntaxKind.AnyKeyword:
                return Type_1.AnyType.getInstance();
            case ts.SyntaxKind.VoidKeyword:
                return Type_1.VoidType.getInstance();
            case ts.SyntaxKind.NeverKeyword:
                return Type_1.NeverType.getInstance();
            case ts.SyntaxKind.TypeReference:
                return this.resolveTypeReferenceNode(type);
            case ts.SyntaxKind.ArrayType:
                return new Type_1.ArrayType(this.resolveTypeNode(type.elementType), 1);
            case ts.SyntaxKind.UnionType: {
                const mayTypes = [];
                type.types.forEach(t => mayTypes.push(this.resolveTypeNode(t)));
                return new Type_1.UnionType(mayTypes);
            }
            case ts.SyntaxKind.IntersectionType: {
                const intersectionTypes = [];
                type.types.forEach(t => intersectionTypes.push(this.resolveTypeNode(t)));
                return new Type_1.IntersectionType(intersectionTypes);
            }
            case ts.SyntaxKind.TupleType: {
                const types = [];
                type.elements.forEach(element => {
                    types.push(this.resolveTypeNode(element));
                });
                return new Type_1.TupleType(types);
            }
            case ts.SyntaxKind.NamedTupleMember:
                return this.resolveTypeNode(type.type);
            case ts.SyntaxKind.LiteralType:
                return ArkValueTransformer.resolveLiteralTypeNode(type, this.sourceFile);
            case ts.SyntaxKind.TemplateLiteralType:
                return this.resolveTemplateLiteralTypeNode(type);
            case ts.SyntaxKind.TypeLiteral:
                return this.resolveTypeLiteralNode(type);
            case ts.SyntaxKind.FunctionType:
                return this.resolveFunctionTypeNode(type);
            case ts.SyntaxKind.ImportType:
                return Type_1.UnknownType.getInstance();
            case ts.SyntaxKind.TypeQuery:
                return this.resolveTypeQueryNode(type);
            case ts.SyntaxKind.ParenthesizedType:
                return this.resolveTypeNode(type.type);
            case ts.SyntaxKind.TypeOperator:
                return this.resolveTypeOperatorNode(type);
            default:
                return Type_1.UnknownType.getInstance();
        }
    }
    resolveTypeQueryNode(typeQueryNode) {
        var _a, _b, _c, _d, _e, _f;
        const genericTypes = [];
        if (typeQueryNode.typeArguments) {
            for (const typeArgument of typeQueryNode.typeArguments) {
                genericTypes.push(this.resolveTypeNode(typeArgument));
            }
        }
        const exprNameNode = typeQueryNode.exprName;
        let opValue;
        if (ts.isQualifiedName(exprNameNode)) {
            if (exprNameNode.left.getText(this.sourceFile) === TSConst_1.THIS_NAME) {
                const fieldName = exprNameNode.right.getText(this.sourceFile);
                const fieldSignature = (_b = (_a = this.declaringMethod.getDeclaringArkClass().getFieldWithName(fieldName)) === null || _a === void 0 ? void 0 : _a.getSignature()) !== null && _b !== void 0 ? _b : ArkSignatureBuilder_1.ArkSignatureBuilder.buildFieldSignatureFromFieldName(fieldName);
                const baseLocal = (_c = this.locals.get(TSConst_1.THIS_NAME)) !== null && _c !== void 0 ? _c : new Local_1.Local(TSConst_1.THIS_NAME, new Type_1.ClassType(this.declaringMethod.getDeclaringArkClass().getSignature(), genericTypes));
                opValue = new Ref_1.ArkInstanceFieldRef(baseLocal, fieldSignature);
            }
            else {
                const exprName = exprNameNode.getText(this.sourceFile);
                opValue = new Local_1.Local(exprName, Type_1.UnknownType.getInstance());
            }
        }
        else {
            const exprName = exprNameNode.escapedText.toString();
            opValue = (_f = (_d = this.locals.get(exprName)) !== null && _d !== void 0 ? _d : (_e = this.globals) === null || _e === void 0 ? void 0 : _e.get(exprName)) !== null && _f !== void 0 ? _f : new Local_1.Local(exprName, Type_1.UnknownType.getInstance());
        }
        return new TypeExpr_1.TypeQueryExpr(opValue, genericTypes);
    }
    resolveTypeOperatorNode(typeOperatorNode) {
        let type = this.resolveTypeNode(typeOperatorNode.type);
        switch (typeOperatorNode.operator) {
            case ts.SyntaxKind.ReadonlyKeyword: {
                if (type instanceof Type_1.ArrayType || type instanceof Type_1.TupleType) {
                    type.setReadonlyFlag(true);
                }
                return type;
            }
            case ts.SyntaxKind.KeyOfKeyword: {
                return new TypeExpr_1.KeyofTypeExpr(type);
            }
            case ts.SyntaxKind.UniqueKeyword: {
                return Type_1.UnknownType.getInstance();
            }
            default:
                return Type_1.UnknownType.getInstance();
        }
    }
    static resolveLiteralTypeNode(literalTypeNode, sourceFile) {
        const literal = literalTypeNode.literal;
        const kind = literal.kind;
        switch (kind) {
            case ts.SyntaxKind.NullKeyword:
                return Type_1.NullType.getInstance();
            case ts.SyntaxKind.TrueKeyword:
                return Type_1.LiteralType.TRUE;
            case ts.SyntaxKind.FalseKeyword:
                return Type_1.LiteralType.FALSE;
            case ts.SyntaxKind.NumericLiteral:
                return new Type_1.LiteralType(parseFloat(literal.text));
            case ts.SyntaxKind.PrefixUnaryExpression:
                return new Type_1.LiteralType(parseFloat(literal.getText(sourceFile)));
            default:
                ;
        }
        return new Type_1.LiteralType(literal.getText(sourceFile));
    }
    resolveTemplateLiteralTypeNode(templateLiteralTypeNode) {
        let stringLiterals = [''];
        const headString = templateLiteralTypeNode.head.rawText || '';
        let newStringLiterals = [];
        for (const stringLiteral of stringLiterals) {
            newStringLiterals.push(stringLiteral + headString);
        }
        stringLiterals = newStringLiterals;
        newStringLiterals = [];
        for (const templateSpan of templateLiteralTypeNode.templateSpans) {
            const templateType = this.resolveTypeNode(templateSpan.type);
            const unfoldTemplateTypes = [];
            if (templateType instanceof Type_1.UnionType) {
                unfoldTemplateTypes.push(...templateType.getTypes());
            }
            else {
                unfoldTemplateTypes.push(templateType);
            }
            const unfoldTemplateTypeStrs = [];
            for (const unfoldTemplateType of unfoldTemplateTypes) {
                unfoldTemplateTypeStrs.push(unfoldTemplateType instanceof Type_1.AliasType ? unfoldTemplateType.getOriginalType()
                    .toString() : unfoldTemplateType.toString());
            }
            const templateSpanString = templateSpan.literal.rawText || '';
            for (const stringLiteral of stringLiterals) {
                for (const unfoldTemplateTypeStr of unfoldTemplateTypeStrs) {
                    newStringLiterals.push(stringLiteral + unfoldTemplateTypeStr + templateSpanString);
                }
            }
            stringLiterals = newStringLiterals;
            newStringLiterals = [];
        }
        const templateTypes = [];
        for (const stringLiteral of stringLiterals) {
            templateTypes.push(new Type_1.LiteralType(stringLiteral));
        }
        if (templateTypes.length > 0) {
            return new Type_1.UnionType(templateTypes);
        }
        return templateTypes[0];
    }
    resolveTypeReferenceNode(typeReferenceNode) {
        const typeReferenceFullName = typeReferenceNode.typeName.getText(this.sourceFile);
        const aliasTypeAndStmt = this.aliasTypeMap.get(typeReferenceFullName);
        const genericTypes = [];
        if (typeReferenceNode.typeArguments) {
            for (const typeArgument of typeReferenceNode.typeArguments) {
                genericTypes.push(this.resolveTypeNode(typeArgument));
            }
        }
        if (!aliasTypeAndStmt) {
            const typeName = typeReferenceNode.typeName.getText(this.sourceFile);
            const local = this.locals.get(typeName);
            if (local !== undefined) {
                return local.getType();
            }
            return new Type_1.UnclearReferenceType(typeName, genericTypes);
        }
        else {
            if (genericTypes.length > 0) {
                const oldAlias = aliasTypeAndStmt[0];
                let alias = new Type_1.AliasType(oldAlias.getName(), TypeInference_1.TypeInference.replaceTypeWithReal(oldAlias.getOriginalType(), genericTypes), oldAlias.getSignature(), oldAlias.getGenericTypes());
                alias.setRealGenericTypes(genericTypes);
                return alias;
            }
            return aliasTypeAndStmt[0];
        }
    }
    resolveTypeLiteralNode(typeLiteralNode) {
        const anonymousClass = new ArkClass_1.ArkClass();
        const declaringClass = this.declaringMethod.getDeclaringArkClass();
        const declaringNamespace = declaringClass.getDeclaringArkNamespace();
        if (declaringNamespace) {
            (0, ArkClassBuilder_1.buildNormalArkClassFromArkNamespace)(typeLiteralNode, declaringNamespace, anonymousClass, this.sourceFile);
        }
        else {
            (0, ArkClassBuilder_1.buildNormalArkClassFromArkFile)(typeLiteralNode, declaringClass.getDeclaringArkFile(), anonymousClass, this.sourceFile);
        }
        return new Type_1.ClassType(anonymousClass.getSignature());
    }
    resolveFunctionTypeNode(functionTypeNode) {
        const anonymousMethod = new ArkMethod_1.ArkMethod();
        const declaringClass = this.declaringMethod.getDeclaringArkClass();
        (0, ArkMethodBuilder_1.buildArkMethodFromArkClass)(functionTypeNode, declaringClass, anonymousMethod, this.sourceFile);
        return new Type_1.FunctionType(anonymousMethod.getSignature());
    }
    static isCompoundAssignmentOperator(operator) {
        const compoundAssignmentOperators = [
            ts.SyntaxKind.PlusEqualsToken,
            ts.SyntaxKind.MinusEqualsToken,
            ts.SyntaxKind.AsteriskAsteriskEqualsToken,
            ts.SyntaxKind.AsteriskEqualsToken,
            ts.SyntaxKind.SlashEqualsToken,
            ts.SyntaxKind.PercentEqualsToken,
            ts.SyntaxKind.AmpersandEqualsToken,
            ts.SyntaxKind.BarEqualsToken,
            ts.SyntaxKind.CaretEqualsToken,
            ts.SyntaxKind.LessThanLessThanEqualsToken,
            ts.SyntaxKind.GreaterThanGreaterThanGreaterThanEqualsToken,
            ts.SyntaxKind.GreaterThanGreaterThanEqualsToken,
            ts.SyntaxKind.BarBarEqualsToken,
            ts.SyntaxKind.AmpersandAmpersandEqualsToken,
            ts.SyntaxKind.QuestionQuestionEqualsToken,
        ];
        return compoundAssignmentOperators.includes(operator);
    }
}
exports.ArkValueTransformer = ArkValueTransformer;
