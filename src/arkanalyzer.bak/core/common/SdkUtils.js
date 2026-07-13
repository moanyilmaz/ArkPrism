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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SdkUtils = void 0;
const ArkExport_1 = require("../model/ArkExport");
const EtsConst_1 = require("./EtsConst");
const TSConst_1 = require("./TSConst");
const Const_1 = require("./Const");
const ArkClass_1 = require("../model/ArkClass");
const ArkSignature_1 = require("../model/ArkSignature");
const ModelUtils_1 = require("./ModelUtils");
const Local_1 = require("../base/Local");
const path_1 = __importDefault(require("path"));
const IRInference_1 = require("./IRInference");
const Type_1 = require("../base/Type");
const ArkNamespace_1 = require("../model/ArkNamespace");
class SdkUtils {
    static buildGlobalMap(file, globalMap) {
        var _a, _b, _c, _d;
        const fileName = path_1.default.basename(file.getName());
        if (fileName.startsWith('@')) {
            ModelUtils_1.sdkImportMap.set(fileName.replace(/\.d\.e?ts$/, ''), file);
        }
        const isGlobalPath = (_a = file.getScene().getOptions().sdkGlobalFolders) === null || _a === void 0 ? void 0 : _a.find(x => file.getFilePath().includes(path_1.default.sep + x + path_1.default.sep));
        if (!isGlobalPath) {
            return;
        }
        IRInference_1.IRInference.inferFile(file);
        ModelUtils_1.ModelUtils.getAllClassesInFile(file).forEach(cls => {
            if (!cls.isAnonymousClass() && !cls.isDefaultArkClass()) {
                SdkUtils.loadClass(globalMap, cls);
            }
            if (cls.isDefaultArkClass()) {
                cls.getMethods()
                    .filter(mtd => !mtd.isDefaultArkMethod() && !mtd.isAnonymousMethod())
                    .forEach(mtd => globalMap.set(mtd.getName(), mtd));
            }
        });
        const defaultArkMethod = file.getDefaultClass().getDefaultArkMethod();
        (_b = defaultArkMethod === null || defaultArkMethod === void 0 ? void 0 : defaultArkMethod.getBody()) === null || _b === void 0 ? void 0 : _b.getLocals().forEach(local => {
            const name = local.getName();
            if (name !== TSConst_1.THIS_NAME && !name.startsWith(Const_1.TEMP_LOCAL_PREFIX)) {
                this.loadGlobalLocal(local, defaultArkMethod, globalMap);
            }
        });
        (_d = (_c = defaultArkMethod === null || defaultArkMethod === void 0 ? void 0 : defaultArkMethod.getBody()) === null || _c === void 0 ? void 0 : _c.getAliasTypeMap()) === null || _d === void 0 ? void 0 : _d.forEach(a => globalMap.set(a[0].getName(), a[0]));
        ModelUtils_1.ModelUtils.getAllNamespacesInFile(file).forEach(ns => globalMap.set(ns.getName(), ns));
    }
    static loadClass(globalMap, cls) {
        const old = globalMap.get(cls.getName());
        if (old instanceof ArkClass_1.ArkClass) {
            if (old.getCategory() === ArkClass_1.ClassCategory.CLASS) {
                this.copyMethod(cls, old);
            }
            else {
                this.copyMethod(old, cls);
                globalMap.delete(cls.getName());
                globalMap.set(cls.getName(), cls);
            }
        }
        else if (!old) {
            globalMap.set(cls.getName(), cls);
        }
    }
    static loadGlobalLocal(local, defaultArkMethod, globalMap) {
        const name = local.getName();
        local.setSignature(new ArkSignature_1.LocalSignature(name, defaultArkMethod.getSignature()));
        const scene = defaultArkMethod.getDeclaringArkFile().getScene();
        if (scene.getOptions().isScanAbc) {
            const instance = globalMap.get(name + 'Interface');
            const attr = globalMap.get(name + EtsConst_1.COMPONENT_ATTRIBUTE);
            if (attr instanceof ArkClass_1.ArkClass && instance instanceof ArkClass_1.ArkClass) {
                instance.getMethods().filter(m => !instance.getMethodWithName(m.getName())).forEach(m => attr.addMethod(m));
                globalMap.set(name, attr);
                return;
            }
        }
        const old = globalMap.get(name);
        if (!old) {
            globalMap.set(name, local);
        }
        else if (old instanceof ArkClass_1.ArkClass && local.getType() instanceof Type_1.ClassType) {
            const localConstructor = scene.getClass(local.getType().getClassSignature());
            if (localConstructor) {
                localConstructor.getMethods().filter(m => !old.getMethodWithName(m.getName())).forEach(m => old.addMethod(m));
            }
        }
    }
    static copyMethod(from, to) {
        from.getMethods().forEach(method => {
            var _a;
            const dist = method.isStatic() ? to.getStaticMethodWithName(method.getName()) : to.getMethodWithName(method.getName());
            const distSignatures = dist === null || dist === void 0 ? void 0 : dist.getDeclareSignatures();
            if (distSignatures) {
                (_a = method.getDeclareSignatures()) === null || _a === void 0 ? void 0 : _a.forEach(x => distSignatures.push(x));
            }
            else {
                to.addMethod(method);
            }
        });
    }
    static computeGlobalThis(leftOp, arkMethod) {
        const globalThis = arkMethod.getDeclaringArkFile().getScene().getSdkGlobal(TSConst_1.GLOBAL_THIS_NAME);
        if (globalThis instanceof ArkNamespace_1.ArkNamespace) {
            const exportInfo = new ArkExport_1.ExportInfo.Builder().exportClauseName(leftOp.getFieldName())
                .arkExport(new Local_1.Local(leftOp.getFieldName(), leftOp.getType())).build();
            globalThis.addExportInfo(exportInfo);
        }
    }
}
exports.SdkUtils = SdkUtils;
