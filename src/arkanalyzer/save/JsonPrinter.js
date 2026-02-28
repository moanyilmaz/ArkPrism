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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.JsonPrinter = void 0;
const Printer_1 = require("./Printer");
const Type_1 = require("../core/base/Type");
const Stmt_1 = require("../core/base/Stmt");
const Expr_1 = require("../core/base/Expr");
const Constant_1 = require("../core/base/Constant");
const ArkSignature_1 = require("../core/model/ArkSignature");
const Ref_1 = require("../core/base/Ref");
const Local_1 = require("../core/base/Local");
const util_1 = __importDefault(require("util"));
class JsonPrinter extends Printer_1.Printer {
    constructor(arkFile) {
        super();
        this.arkFile = arkFile;
    }
    dump() {
        const jsonObject = this.serializeArkFile(this.arkFile);
        return JSON.stringify(jsonObject, null, 2);
    }
    serializeArkFile(file) {
        return {
            signature: this.serializeFileSignature(file.getFileSignature()),
            namespaces: file.getNamespaces().map((ns) => this.serializeNamespace(ns)),
            classes: file.getClasses().map((cls) => this.serializeClass(cls)),
            importInfos: file.getImportInfos().map((info) => this.serializeImportInfo(info)),
            exportInfos: file.getExportInfos().map((info) => this.serializeExportInfo(info)),
        };
    }
    serializeNamespace(namespace) {
        return {
            signature: this.serializeNamespaceSignature(namespace.getSignature()),
            classes: namespace.getClasses().map((cls) => this.serializeClass(cls)),
            namespaces: namespace.getNamespaces().map((ns) => this.serializeNamespace(ns)),
        };
    }
    serializeClass(clazz) {
        var _a;
        return {
            signature: this.serializeClassSignature(clazz.getSignature()),
            modifiers: clazz.getModifiers(),
            decorators: clazz.getDecorators().map((decorator) => this.serializeDecorator(decorator)),
            typeParameters: (_a = clazz.getGenericsTypes()) === null || _a === void 0 ? void 0 : _a.map((type) => this.serializeType(type)),
            superClassName: clazz.getSuperClassName(),
            implementedInterfaceNames: clazz.getImplementedInterfaceNames(),
            fields: clazz.getFields().map((field) => this.serializeField(field)),
            methods: clazz.getMethods(true).map((method) => this.serializeMethod(method)),
        };
    }
    serializeField(field) {
        return {
            signature: this.serializeFieldSignature(field.getSignature()),
            modifiers: field.getModifiers(),
            decorators: field.getDecorators().map((decorator) => this.serializeDecorator(decorator)),
            questionToken: field.getQuestionToken(),
            exclamationToken: field.getExclamationToken(),
        };
    }
    serializeMethod(method) {
        var _a;
        let body = method.getBody();
        return {
            signature: this.serializeMethodSignature(method.getSignature()),
            modifiers: method.getModifiers(),
            decorators: method.getDecorators().map((decorator) => this.serializeDecorator(decorator)),
            typeParameters: (_a = method.getGenericTypes()) === null || _a === void 0 ? void 0 : _a.map(type => this.serializeType(type)),
            body: body && this.serializeMethodBody(body),
        };
    }
    serializeMethodBody(body) {
        return {
            locals: Array.from(body.getLocals().values()).map((local) => this.serializeLocal(local)),
            cfg: this.serializeCfg(body.getCfg()),
        };
    }
    serializeMethodParameter(parameter) {
        return {
            name: parameter.getName(),
            type: this.serializeType(parameter.getType()),
            isOptional: parameter.isOptional(),
        };
    }
    serializeImportInfo(importInfo) {
        return {
            importClauseName: importInfo.getImportClauseName(),
            importType: importInfo.getImportType(),
            importFrom: importInfo.getFrom(),
            nameBeforeAs: importInfo.getNameBeforeAs(),
            modifiers: importInfo.getModifiers(),
            originTsPosition: this.serializeLineColPosition(importInfo.getOriginTsPosition()),
        };
    }
    serializeExportInfo(exportInfo) {
        return {
            exportClauseName: exportInfo.getExportClauseName(),
            exportClauseType: exportInfo.getExportClauseType(),
            exportFrom: exportInfo.getFrom(),
            nameBeforeAs: exportInfo.getNameBeforeAs(),
            isDefault: exportInfo.isDefault(),
            modifiers: exportInfo.getModifiers(),
            originTsPosition: this.serializeLineColPosition(exportInfo.getOriginTsPosition()),
        };
    }
    serializeDecorator(decorator) {
        return {
            kind: decorator.getKind(),
        };
    }
    serializeLineColPosition(position) {
        return {
            line: position.getLineNo(),
            col: position.getColNo(),
        };
    }
    serializeType(type) {
        var _a, _b;
        if (type === undefined) {
            throw new Error('Type is undefined');
        }
        if (type instanceof Type_1.AnyType) {
            return {
                _: 'AnyType',
            };
        }
        else if (type instanceof Type_1.UnknownType) {
            return {
                _: 'UnknownType',
            };
        }
        else if (type instanceof Type_1.VoidType) {
            return {
                _: 'VoidType',
            };
        }
        else if (type instanceof Type_1.NeverType) {
            return {
                _: 'NeverType',
            };
        }
        else if (type instanceof Type_1.UnionType) {
            return {
                _: 'UnionType',
                types: type.getTypes().map((type) => this.serializeType(type)),
            };
        }
        else if (type instanceof Type_1.TupleType) {
            return {
                _: 'TupleType',
                types: type.getTypes().map((type) => this.serializeType(type)),
            };
        }
        else if (type instanceof Type_1.BooleanType) {
            return {
                _: 'BooleanType',
            };
        }
        else if (type instanceof Type_1.NumberType) {
            return {
                _: 'NumberType',
            };
        }
        else if (type instanceof Type_1.StringType) {
            return {
                _: 'StringType',
            };
        }
        else if (type instanceof Type_1.NullType) {
            return {
                _: 'NullType',
            };
        }
        else if (type instanceof Type_1.UndefinedType) {
            return {
                _: 'UndefinedType',
            };
        }
        else if (type instanceof Type_1.LiteralType) {
            return {
                _: 'LiteralType',
                literal: type.getLiteralName(),
            };
        }
        else if (type instanceof Type_1.PrimitiveType) {
            throw new Error('Unhandled PrimitiveType: ' + util_1.default.inspect(type, { showHidden: true, depth: null }));
        }
        else if (type instanceof Type_1.ClassType) {
            return {
                _: 'ClassType',
                signature: this.serializeClassSignature(type.getClassSignature()),
                typeParameters: (_a = type.getRealGenericTypes()) === null || _a === void 0 ? void 0 : _a.map((type) => this.serializeType(type)),
            };
        }
        else if (type instanceof Type_1.FunctionType) {
            return {
                _: 'FunctionType',
                signature: this.serializeMethodSignature(type.getMethodSignature()),
                typeParameters: (_b = type.getRealGenericTypes()) === null || _b === void 0 ? void 0 : _b.map((type) => this.serializeType(type)),
            };
        }
        else if (type instanceof Type_1.ArrayType) {
            return {
                _: 'ArrayType',
                elementType: this.serializeType(type.getBaseType()),
                dimensions: type.getDimension(),
            };
        }
        else if (type instanceof Type_1.UnclearReferenceType) {
            return {
                _: 'UnclearReferenceType',
                name: type.getName(),
                typeParameters: type.getGenericTypes().map((type) => this.serializeType(type)),
            };
        }
        else if (type instanceof Type_1.GenericType) {
            let defaultType = type.getDefaultType();
            let constraint = type.getConstraint();
            return {
                _: 'GenericType',
                name: type.getName(),
                defaultType: defaultType && this.serializeType(defaultType),
                constraint: constraint && this.serializeType(constraint),
            };
        }
        else if (type instanceof Type_1.AliasType) {
            return {
                _: 'AliasType',
                name: type.getName(),
                originalType: this.serializeType(type.getOriginalType()),
                signature: this.serializeAliasTypeSignature(type.getSignature()),
            };
        }
        else if (type instanceof Type_1.AnnotationNamespaceType) {
            return {
                _: 'AnnotationNamespaceType',
                originType: type.getOriginType(),
                namespaceSignature: this.serializeNamespaceSignature(type.getNamespaceSignature()),
            };
        }
        else if (type instanceof Type_1.AnnotationTypeQueryType) {
            return {
                _: 'AnnotationTypeQueryType',
                originType: type.getOriginType(),
            };
        }
        else if (type instanceof Type_1.AnnotationType) {
            throw new Error('Unhandled AnnotationType: ' + util_1.default.inspect(type, { showHidden: true, depth: null }));
        }
        else {
            throw new Error('Unhandled Type: ' + util_1.default.inspect(type, { showHidden: true, depth: null }));
        }
    }
    serializeFileSignature(file) {
        return {
            projectName: file.getProjectName(),
            fileName: file.getFileName(),
        };
    }
    serializeNamespaceSignature(namespace) {
        let dns = namespace.getDeclaringNamespaceSignature();
        return {
            name: namespace.getNamespaceName(),
            declaringFile: this.serializeFileSignature(namespace.getDeclaringFileSignature()),
            declaringNamespace: dns && this.serializeNamespaceSignature(dns),
        };
    }
    serializeClassSignature(clazz) {
        let dns = clazz.getDeclaringNamespaceSignature();
        return {
            name: clazz.getClassName(),
            declaringFile: this.serializeFileSignature(clazz.getDeclaringFileSignature()),
            declaringNamespace: dns && this.serializeNamespaceSignature(dns),
        };
    }
    serializeFieldSignature(field) {
        let declaringSignature = field.getDeclaringSignature();
        let declaringClass;
        if (declaringSignature instanceof ArkSignature_1.ClassSignature) {
            declaringClass = this.serializeClassSignature(declaringSignature);
        }
        else {
            declaringClass = this.serializeNamespaceSignature(declaringSignature);
        }
        return {
            declaringClass,
            name: field.getFieldName(),
            type: this.serializeType(field.getType()),
        };
    }
    serializeMethodSignature(method) {
        return {
            declaringClass: this.serializeClassSignature(method.getDeclaringClassSignature()),
            name: method.getMethodSubSignature().getMethodName(),
            parameters: method
                .getMethodSubSignature()
                .getParameters()
                .map((param) => this.serializeMethodParameter(param)),
            returnType: this.serializeType(method.getType()),
        };
    }
    serializeAliasTypeSignature(signature) {
        return {
            name: signature.getName(),
            method: this.serializeMethodSignature(signature.getDeclaringMethodSignature()),
        };
    }
    serializeCfg(cfg) {
        const visited = new Set();
        const stack = [];
        const startingBlock = cfg.getStartingBlock();
        if (startingBlock) {
            stack.push(startingBlock);
        }
        let id = 0;
        while (stack.length > 0) {
            const block = stack.pop();
            if (visited.has(block)) {
                continue;
            }
            visited.add(block);
            block.setId(id++);
            stack.push(...block.getSuccessors());
        }
        return {
            blocks: Array.from(visited).map((block) => this.serializeBasicBlock(block)),
        };
    }
    serializeBasicBlock(block) {
        const successors = block.getSuccessors().map((succ) => succ.getId());
        successors.sort((a, b) => a - b);
        const predecessors = block.getPredecessors().map((pred) => pred.getId());
        predecessors.sort((a, b) => a - b);
        return {
            id: block.getId(),
            successors,
            predecessors,
            stmts: block.getStmts().map((stmt) => this.serializeStmt(stmt)),
        };
    }
    serializeLocal(local) {
        return {
            name: local.getName(),
            type: this.serializeType(local.getType()),
        };
    }
    serializeValue(value) {
        if (value === undefined) {
            throw new Error('Value is undefined');
        }
        if (value instanceof Local_1.Local) {
            return Object.assign({ _: 'Local' }, this.serializeLocal(value));
        }
        else if (value instanceof Constant_1.Constant) {
            return {
                _: 'Constant',
                value: value.getValue(),
                type: this.serializeType(value.getType()),
            };
        }
        else if (value instanceof Expr_1.ArkNewExpr) {
            return {
                _: 'NewExpr',
                classType: this.serializeType(value.getClassType()),
            };
        }
        else if (value instanceof Expr_1.ArkNewArrayExpr) {
            return {
                _: 'NewArrayExpr',
                elementType: this.serializeType(value.getBaseType()),
                size: this.serializeValue(value.getSize()),
            };
        }
        else if (value instanceof Expr_1.ArkDeleteExpr) {
            return {
                _: 'DeleteExpr',
                arg: this.serializeValue(value.getField()),
            };
        }
        else if (value instanceof Expr_1.ArkAwaitExpr) {
            return {
                _: 'AwaitExpr',
                arg: this.serializeValue(value.getPromise()),
            };
        }
        else if (value instanceof Expr_1.ArkYieldExpr) {
            return {
                _: 'YieldExpr',
                arg: this.serializeValue(value.getYieldValue()),
            };
        }
        else if (value instanceof Expr_1.ArkTypeOfExpr) {
            return {
                _: 'TypeOfExpr',
                arg: this.serializeValue(value.getOp()),
            };
        }
        else if (value instanceof Expr_1.ArkInstanceOfExpr) {
            return {
                _: 'InstanceOfExpr',
                arg: this.serializeValue(value.getOp()),
                checkType: this.serializeType(value.getCheckType()),
            };
        }
        else if (value instanceof Expr_1.ArkCastExpr) {
            return {
                _: 'CastExpr',
                arg: this.serializeValue(value.getOp()),
                type: this.serializeType(value.getType()),
            };
        }
        else if (value instanceof Expr_1.ArkPhiExpr) {
            const args = value.getArgs();
            const argToBlock = value.getArgToBlock();
            return {
                _: 'PhiExpr',
                args: args.map((arg) => this.serializeValue(arg)),
                blocks: args.map((arg) => argToBlock.get(arg).getId()),
                type: this.serializeType(value.getType()),
            };
        }
        else if (value instanceof Expr_1.ArkConditionExpr) {
            return {
                _: 'ConditionExpr',
                op: value.getOperator(),
                left: this.serializeValue(value.getOp1()),
                right: this.serializeValue(value.getOp2()),
                type: this.serializeType(value.getType()),
            };
        }
        else if (value instanceof Expr_1.ArkNormalBinopExpr) {
            return {
                _: 'BinopExpr',
                op: value.getOperator(),
                left: this.serializeValue(value.getOp1()),
                right: this.serializeValue(value.getOp2()),
            };
        }
        else if (value instanceof Expr_1.AbstractBinopExpr) {
            return new Error('Unhandled BinopExpr: ' + util_1.default.inspect(value, { showHidden: true, depth: null }));
        }
        else if (value instanceof Expr_1.ArkUnopExpr) {
            return {
                _: 'UnopExpr',
                op: value.getOperator(),
                arg: this.serializeValue(value.getOp()),
            };
        }
        else if (value instanceof Expr_1.ArkInstanceInvokeExpr) {
            return {
                _: 'InstanceCallExpr',
                instance: this.serializeValue(value.getBase()),
                method: this.serializeMethodSignature(value.getMethodSignature()),
                args: value.getArgs().map((arg) => this.serializeValue(arg)),
            };
        }
        else if (value instanceof Expr_1.ArkStaticInvokeExpr) {
            return {
                _: 'StaticCallExpr',
                method: this.serializeMethodSignature(value.getMethodSignature()),
                args: value.getArgs().map((arg) => this.serializeValue(arg)),
            };
        }
        else if (value instanceof Expr_1.ArkPtrInvokeExpr) {
            return {
                _: 'PtrCallExpr',
                ptr: this.serializeValue(value.getFuncPtrLocal()),
                method: this.serializeMethodSignature(value.getMethodSignature()),
                args: value.getArgs().map((arg) => this.serializeValue(arg)),
            };
        }
        else if (value instanceof Expr_1.AbstractInvokeExpr) {
            throw new Error('Unhandled CallExpr: ' + util_1.default.inspect(value, { showHidden: true, depth: null }));
        }
        else if (value instanceof Ref_1.ArkThisRef) {
            return {
                _: 'ThisRef',
                type: this.serializeType(value.getType()),
            };
        }
        else if (value instanceof Ref_1.ArkParameterRef) {
            return {
                _: 'ParameterRef',
                index: value.getIndex(),
                type: this.serializeType(value.getType()),
            };
        }
        else if (value instanceof Ref_1.ArkArrayRef) {
            return {
                _: 'ArrayRef',
                array: this.serializeValue(value.getBase()),
                index: this.serializeValue(value.getIndex()),
                type: this.serializeType(value.getType()),
            };
        }
        else if (value instanceof Ref_1.ArkInstanceFieldRef) {
            return {
                _: 'InstanceFieldRef',
                instance: this.serializeValue(value.getBase()),
                field: this.serializeFieldSignature(value.getFieldSignature()),
            };
        }
        else if (value instanceof Ref_1.ArkStaticFieldRef) {
            return {
                _: 'StaticFieldRef',
                field: this.serializeFieldSignature(value.getFieldSignature()),
            };
        }
        else if (value instanceof Ref_1.AbstractFieldRef) {
            throw new Error('Unhandled FieldRef: ' + util_1.default.inspect(value, { showHidden: true, depth: null }));
        }
        else if (value instanceof Ref_1.AbstractRef) {
            throw new Error('Unhandled Ref: ' + util_1.default.inspect(value, { showHidden: true, depth: null }));
        }
        else if (value instanceof Expr_1.AbstractExpr) {
            throw new Error('Unhandled Expr: ' + util_1.default.inspect(value, { showHidden: true, depth: null }));
        }
        else {
            throw new Error('Unhandled Value: ' + util_1.default.inspect(value, { showHidden: true, depth: null }));
        }
    }
    serializeStmt(stmt) {
        if (stmt instanceof Stmt_1.ArkAssignStmt) {
            return {
                _: 'AssignStmt',
                left: this.serializeValue(stmt.getLeftOp()),
                right: this.serializeValue(stmt.getRightOp()),
            };
        }
        else if (stmt instanceof Stmt_1.ArkInvokeStmt) {
            return {
                _: 'CallStmt',
                expr: this.serializeValue(stmt.getInvokeExpr()),
            };
        }
        else if (stmt instanceof Stmt_1.ArkIfStmt) {
            return {
                _: 'IfStmt',
                condition: this.serializeValue(stmt.getConditionExpr()),
            };
        }
        else if (stmt instanceof Stmt_1.ArkReturnVoidStmt) {
            return {
                _: 'ReturnVoidStmt',
            };
        }
        else if (stmt instanceof Stmt_1.ArkReturnStmt) {
            return {
                _: 'ReturnStmt',
                arg: this.serializeValue(stmt.getOp()),
            };
        }
        else if (stmt instanceof Stmt_1.ArkThrowStmt) {
            return {
                _: 'ThrowStmt',
                arg: this.serializeValue(stmt.getOp()),
            };
        }
        else {
            throw new Error('Unhandled Stmt: ' + util_1.default.inspect(stmt, { showHidden: true, depth: null }));
        }
    }
}
exports.JsonPrinter = JsonPrinter;
