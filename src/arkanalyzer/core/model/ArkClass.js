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
Object.defineProperty(exports, "__esModule", { value: true });
exports.ArkClass = exports.ClassCategory = void 0;
const Type_1 = require("../base/Type");
const ArkMethod_1 = require("./ArkMethod");
const ArkExport_1 = require("./ArkExport");
const TypeInference_1 = require("../common/TypeInference");
const Const_1 = require("../common/Const");
const Position_1 = require("../base/Position");
const ArkBaseModel_1 = require("./ArkBaseModel");
var ClassCategory;
(function (ClassCategory) {
    ClassCategory[ClassCategory["CLASS"] = 0] = "CLASS";
    ClassCategory[ClassCategory["STRUCT"] = 1] = "STRUCT";
    ClassCategory[ClassCategory["INTERFACE"] = 2] = "INTERFACE";
    ClassCategory[ClassCategory["ENUM"] = 3] = "ENUM";
    ClassCategory[ClassCategory["TYPE_LITERAL"] = 4] = "TYPE_LITERAL";
    ClassCategory[ClassCategory["OBJECT"] = 5] = "OBJECT";
})(ClassCategory = exports.ClassCategory || (exports.ClassCategory = {}));
/**
 * @category core/model
 */
class ArkClass extends ArkBaseModel_1.ArkBaseModel {
    constructor() {
        super();
        this.lineCol = 0;
        /**
         * The keys of the `heritageClasses` map represent the names of superclass and interfaces.
         * The superclass name is placed first; if it does not exist, an empty string `''` will occupy this position.
         * The values of the `heritageClasses` map will be replaced with `ArkClass` or `null` during type inference.
         */
        this.heritageClasses = new Map();
        this.defaultMethod = null;
        // name to model
        this.methods = new Map();
        this.fields = new Map();
        this.extendedClasses = new Map();
        this.staticMethods = new Map();
        this.staticFields = new Map();
        this.instanceInitMethod = new ArkMethod_1.ArkMethod();
        this.staticInitMethod = new ArkMethod_1.ArkMethod();
        this.anonymousMethodNumber = 0;
        this.indexSignatureNumber = 0;
    }
    /**
     * Returns the **string**name of this class.
     * @returns The name of this class.
     */
    getName() {
        return this.classSignature.getClassName();
    }
    /**
     * Returns the codes of class as a **string.**
     * @returns the codes of class.
     */
    getCode() {
        return this.code;
    }
    setCode(code) {
        this.code = code;
    }
    /**
     * Returns the line position of this class.
     * @returns The line position of this class.
     */
    getLine() {
        return (0, Position_1.getLineNo)(this.lineCol);
    }
    setLine(line) {
        this.lineCol = (0, Position_1.setLine)(this.lineCol, line);
    }
    /**
     * Returns the column position of this class.
     * @returns The column position of this class.
     */
    getColumn() {
        return (0, Position_1.getColNo)(this.lineCol);
    }
    setColumn(column) {
        this.lineCol = (0, Position_1.setCol)(this.lineCol, column);
    }
    getCategory() {
        return this.category;
    }
    setCategory(category) {
        this.category = category;
    }
    /**
     * Returns the declaring file.
     * @returns A file defined by ArkAnalyzer.
     * @example
     * 1. Get the {@link ArkFile} which the ArkClass is in.

     ```typescript
     const arkFile = arkClass.getDeclaringArkFile();
     ```
     */
    getDeclaringArkFile() {
        return this.declaringArkFile;
    }
    setDeclaringArkFile(declaringArkFile) {
        this.declaringArkFile = declaringArkFile;
    }
    /**
     * Returns the declaring namespace of this class, which may also be an **undefined**.
     * @returns The declaring namespace (may be **undefined**) of this class.
     */
    getDeclaringArkNamespace() {
        return this.declaringArkNamespace;
    }
    setDeclaringArkNamespace(declaringArkNamespace) {
        this.declaringArkNamespace = declaringArkNamespace;
    }
    isDefaultArkClass() {
        return this.getName() === Const_1.DEFAULT_ARK_CLASS_NAME;
    }
    isAnonymousClass() {
        return this.getName().startsWith(Const_1.ANONYMOUS_CLASS_PREFIX);
    }
    /**
     * Returns the signature of current class (i.e., {@link ClassSignature}).
     * The {@link ClassSignature} can uniquely identify a class, according to which we can find the class from the scene.
     * @returns The class signature.
     */
    getSignature() {
        return this.classSignature;
    }
    setSignature(classSig) {
        this.classSignature = classSig;
    }
    getSuperClassName() {
        return this.heritageClasses.keys().next().value || '';
    }
    addHeritageClassName(className) {
        this.heritageClasses.set(className, undefined);
    }
    /**
     * Returns the superclass of this class.
     * @returns The superclass of this class.
     */
    getSuperClass() {
        const heritageClass = this.getHeritageClass(this.getSuperClassName());
        if (heritageClass && heritageClass.getCategory() !== ClassCategory.INTERFACE) {
            return heritageClass;
        }
        return null;
    }
    getHeritageClass(heritageClassName) {
        if (!heritageClassName) {
            return null;
        }
        let superClass = this.heritageClasses.get(heritageClassName);
        if (superClass === undefined) {
            let type = TypeInference_1.TypeInference.inferUnclearRefName(heritageClassName, this);
            if (type) {
                type = TypeInference_1.TypeInference.replaceAliasType(type);
            }
            if (type instanceof Type_1.ClassType &&
                (superClass = this.declaringArkFile.getScene().getClass(type.getClassSignature()))) {
                superClass.addExtendedClass(this);
                const realGenericTypes = type.getRealGenericTypes();
                if (realGenericTypes) {
                    this.realTypes = realGenericTypes;
                }
            }
            this.heritageClasses.set(heritageClassName, superClass || null);
        }
        return superClass || null;
    }
    getAllHeritageClasses() {
        const result = [];
        this.heritageClasses.forEach((v, k) => {
            const heritage = v !== null && v !== void 0 ? v : this.getHeritageClass(k);
            if (heritage) {
                result.push(heritage);
            }
        });
        return result;
    }
    getExtendedClasses() {
        return this.extendedClasses;
    }
    addExtendedClass(extendedClass) {
        this.extendedClasses.set(extendedClass.getName(), extendedClass);
    }
    getImplementedInterfaceNames() {
        if (this.category === ClassCategory.INTERFACE) {
            return [];
        }
        return Array.from(this.heritageClasses.keys()).slice(1);
    }
    hasImplementedInterface(interfaceName) {
        return this.heritageClasses.has(interfaceName) && this.getSuperClassName() !== interfaceName;
    }
    getImplementedInterface(interfaceName) {
        const heritageClass = this.getHeritageClass(interfaceName);
        if (heritageClass && heritageClass.getCategory() === ClassCategory.INTERFACE) {
            return heritageClass;
        }
        return null;
    }
    /**
     * Get the field according to its field signature.
     * If no field cound be found, **null**will be returned.
     * @param fieldSignature - the field's signature.
     * @returns A field. If there is no field in this class, the return will be a **null**.
     */
    getField(fieldSignature) {
        const fieldName = fieldSignature.getFieldName();
        let fieldSearched = this.getFieldWithName(fieldName);
        if (!fieldSearched) {
            fieldSearched = this.getStaticFieldWithName(fieldName);
        }
        return fieldSearched;
    }
    getFieldWithName(fieldName) {
        return this.fields.get(fieldName) || null;
    }
    getStaticFieldWithName(fieldName) {
        return this.staticFields.get(fieldName) || null;
    }
    /**
     * Returns an **array** of fields in the class.
     * @returns an **array** of fields in the class.
     */
    getFields() {
        const allFields = Array.from(this.fields.values());
        allFields.push(...this.staticFields.values());
        return allFields;
    }
    addField(field) {
        if (field.isStatic()) {
            this.staticFields.set(field.getName(), field);
        }
        else {
            this.fields.set(field.getName(), field);
        }
    }
    addFields(fields) {
        fields.forEach((field) => {
            this.addField(field);
        });
    }
    getRealTypes() {
        return this.realTypes;
    }
    getGenericsTypes() {
        return this.genericsTypes;
    }
    addGenericType(gType) {
        if (!this.genericsTypes) {
            this.genericsTypes = [];
        }
        this.genericsTypes.push(gType);
    }
    /**
     * Returns all methods defined in the specific class in the form of an array.
     * @param generated - indicating whether this API returns the methods that are dynamically
     * generated at runtime. If it is not specified as true or false, the return will not include the generated method.
     * @returns An array of all methods in this class.
     * @example
     * 1. Get methods defined in class `BookService`.

     ```typescript
     let classes: ArkClass[] = scene.getClasses();
     let serviceClass : ArkClass = classes[1];
     let methods: ArkMethod[] = serviceClass.getMethods();
     let methodNames: string[] = methods.map(mthd => mthd.name);
     console.log(methodNames);
     ```
     */
    getMethods(generated) {
        const allMethods = Array.from(this.methods.values())
            .filter(f => !generated && !f.isGenerated() || generated);
        allMethods.push(...this.staticMethods.values());
        return allMethods;
    }
    getMethod(methodSignature) {
        var _a;
        const methodName = methodSignature.getMethodSubSignature().getMethodName();
        const methodSearched = (_a = this.getMethodWithName(methodName)) !== null && _a !== void 0 ? _a : this.getStaticMethodWithName(methodName);
        if (methodSearched === null) {
            return null;
        }
        const implSignature = methodSearched.getImplementationSignature();
        if (implSignature !== null && implSignature.isMatch(methodSignature)) {
            return methodSearched;
        }
        const declareSignatures = methodSearched.getDeclareSignatures();
        if (declareSignatures !== null) {
            for (let i = 0; i < declareSignatures.length; i++) {
                if (declareSignatures[i].isMatch(methodSignature)) {
                    return methodSearched;
                }
            }
        }
        return null;
    }
    getMethodWithName(methodName) {
        return this.methods.get(methodName) || null;
    }
    getStaticMethodWithName(methodName) {
        return this.staticMethods.get(methodName) || null;
    }
    addMethod(method) {
        if (method.isStatic()) {
            this.staticMethods.set(method.getName(), method);
        }
        else {
            this.methods.set(method.getName(), method);
        }
    }
    setDefaultArkMethod(defaultMethod) {
        this.defaultMethod = defaultMethod;
        this.addMethod(defaultMethod);
    }
    getDefaultArkMethod() {
        return this.defaultMethod;
    }
    setViewTree(viewTree) {
        this.viewTree = viewTree;
    }
    /**
     * Returns the view tree of the ArkClass.
     * @returns The view tree of the ArkClass.
     * @example
     * 1. get viewTree of ArkClass.

     ```typescript
     for (let arkFiles of scene.getFiles()) {
     for (let arkClasss of arkFiles.getClasses()) {
     if (arkClasss.hasViewTree()) {
     arkClasss.getViewTree();
     }
     }
     }
     ```
     */
    getViewTree() {
        return this.viewTree;
    }
    /**
     * Check whether the view tree is defined.
     * If it is defined, the return value is true, otherwise it is false.
     * @returns True if the view tree is defined; false otherwise.
     * @example
     * 1. Judge viewTree of ArkClass.

     ```typescript
     for (let arkFiles of scene.getFiles()) {
     for (let arkClasss of arkFiles.getClasses()) {
     if (arkClasss.hasViewTree()) {
     arkClasss.getViewTree();
     }
     }
     }
     ```
     */
    hasViewTree() {
        return this.viewTree !== undefined;
    }
    getStaticFields(classMap) {
        const fields = [];
        let classes = [];
        if (this.declaringArkNamespace) {
            classes = classMap.get(this.declaringArkNamespace.getNamespaceSignature());
        }
        else {
            classes = classMap.get(this.declaringArkFile.getFileSignature());
        }
        for (const arkClass of classes) {
            for (const field of arkClass.getFields()) {
                if (field.isStatic()) {
                    fields.push(field);
                }
            }
        }
        return fields;
    }
    getGlobalVariable(globalMap) {
        if (this.declaringArkNamespace) {
            return globalMap.get(this.declaringArkNamespace.getNamespaceSignature());
        }
        return globalMap.get(this.declaringArkFile.getFileSignature());
    }
    getAnonymousMethodNumber() {
        return this.anonymousMethodNumber++;
    }
    getIndexSignatureNumber() {
        return this.indexSignatureNumber++;
    }
    getExportType() {
        return ArkExport_1.ExportType.CLASS;
    }
    getInstanceInitMethod() {
        return this.instanceInitMethod;
    }
    getStaticInitMethod() {
        return this.staticInitMethod;
    }
    setInstanceInitMethod(arkMethod) {
        this.instanceInitMethod = arkMethod;
    }
    setStaticInitMethod(arkMethod) {
        this.staticInitMethod = arkMethod;
    }
    removeField(field) {
        if (field.isStatic()) {
            return this.staticFields.delete(field.getName());
        }
        return this.fields.delete(field.getName());
    }
    removeMethod(method) {
        let rtn = false;
        if (method.isStatic()) {
            rtn = this.staticMethods.delete(method.getName());
        }
        else {
            rtn = this.methods.delete(method.getName());
        }
        rtn && (rtn = this.getDeclaringArkFile().getScene().removeMethod(method));
        return rtn;
    }
    validate() {
        return this.validateFields(['declaringArkFile', 'category', 'classSignature']);
    }
}
exports.ArkClass = ArkClass;
