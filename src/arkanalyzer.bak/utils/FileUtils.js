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
exports.getFileRecursively = exports.ModulePath = exports.FileUtils = void 0;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const logger_1 = __importStar(require("./logger"));
const pathTransfer_1 = require("./pathTransfer");
const EtsConst_1 = require("../core/common/EtsConst");
const logger = logger_1.default.getLogger(logger_1.LOG_MODULE_TYPE.ARKANALYZER, 'FileUtils');
class FileUtils {
    static getIndexFileName(srcPath) {
        for (const fileInDir of fs_1.default.readdirSync(srcPath, { withFileTypes: true })) {
            if (fileInDir.isFile() && /^index(\.d)?\.e?ts$/i.test(fileInDir.name)) {
                return fileInDir.name;
            }
        }
        return '';
    }
    static isDirectory(srcPath) {
        try {
            return fs_1.default.statSync(srcPath).isDirectory();
        }
        catch (e) {
        }
        return false;
    }
    static isAbsolutePath(path) {
        return /^(\/|\\|[A-Z]:\\)/.test(path);
    }
    static generateModuleMap(ohPkgContentMap) {
        const moduleMap = new Map();
        ohPkgContentMap.forEach((content, filePath) => {
            const moduleName = content.name;
            if (moduleName && moduleName.startsWith('@')) {
                const modulePath = path_1.default.dirname(filePath);
                moduleMap.set(moduleName, new ModulePath(modulePath, content.main ?
                    path_1.default.resolve(modulePath, content.main) : ''));
            }
        });
        ohPkgContentMap.forEach((content, filePath) => {
            if (content.dependencies) {
                Object.entries(content.dependencies).forEach(([name, value]) => {
                    if (!moduleMap.get(name)) {
                        const modulePath = path_1.default.resolve(path_1.default.dirname(filePath), value.replace('file:', ''));
                        const key = path_1.default.resolve(modulePath, EtsConst_1.OH_PACKAGE_JSON5);
                        const target = ohPkgContentMap.get(key);
                        if (target) {
                            moduleMap.set(name, new ModulePath(modulePath, target.main ?
                                path_1.default.resolve(modulePath, target.main) : ''));
                        }
                    }
                });
            }
        });
        return moduleMap;
    }
}
exports.FileUtils = FileUtils;
FileUtils.FILE_FILTER = {
    ignores: ['.git', '.preview', '.hvigor', '.idea', 'test', 'ohosTest'],
    include: /(?<!\.d)\.(ets|ts|json5)$/
};
class ModulePath {
    constructor(path, main) {
        this.path = (0, pathTransfer_1.transfer2UnixPath)(path);
        this.main = (0, pathTransfer_1.transfer2UnixPath)(main);
    }
}
exports.ModulePath = ModulePath;
function getFileRecursively(srcDir, fileName, visited = new Set()) {
    let res = '';
    if (!fs_1.default.existsSync(srcDir) || !fs_1.default.statSync(srcDir).isDirectory()) {
        logger.warn(`Input directory ${srcDir} is not exist`);
        return res;
    }
    const filesUnderThisDir = fs_1.default.readdirSync(srcDir, { withFileTypes: true });
    const realSrc = fs_1.default.realpathSync(srcDir);
    if (visited.has(realSrc)) {
        return res;
    }
    visited.add(realSrc);
    filesUnderThisDir.forEach(file => {
        if (res !== '') {
            return res;
        }
        if (file.name === fileName) {
            res = path_1.default.resolve(srcDir, file.name);
            return res;
        }
        const tmpDir = path_1.default.resolve(srcDir, '../');
        res = getFileRecursively(tmpDir, fileName, visited);
    });
    return res;
}
exports.getFileRecursively = getFileRecursively;
