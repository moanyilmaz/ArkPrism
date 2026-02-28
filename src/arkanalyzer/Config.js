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
exports.SceneConfig = void 0;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const logger_1 = __importStar(require("./utils/logger"));
const getAllFiles_1 = require("./utils/getAllFiles");
const logger = logger_1.default.getLogger(logger_1.LOG_MODULE_TYPE.ARKANALYZER, 'Config');
const CONFIG_FILENAME = 'arkanalyzer.json';
const DEFAULT_CONFIG_FILE = path_1.default.join(__dirname, '../config', CONFIG_FILENAME);
class SceneConfig {
    constructor(options) {
        this.targetProjectName = '';
        this.targetProjectDirectory = '';
        this.etsSdkPath = '';
        this.sdksObj = [];
        this.sdkFiles = [];
        this.sdkFilesMap = new Map();
        this.projectFiles = [];
        this.options = { supportFileExts: ['.ets', '.ts'] };
        this.loadDefaultConfig(options);
    }
    getOptions() {
        return this.options;
    }
    /**
     * Set the scene's config,
     * such as  the target project's name, the used sdks and the full path.
     * @param targetProjectName - the target project's name.
     * @param targetProjectDirectory - the target project's directory.
     * @param sdks - sdks used in this scene.
     * @param fullFilePath - the full file path.
     */
    buildConfig(targetProjectName, targetProjectDirectory, sdks, fullFilePath) {
        this.targetProjectName = targetProjectName;
        this.targetProjectDirectory = targetProjectDirectory;
        this.sdksObj = sdks;
        if (fullFilePath) {
            this.projectFiles.push(...fullFilePath);
        }
    }
    /**
     * Create a sceneConfig object for a specified project path and set the target project directory to the targetProjectDirectory property of the sceneConfig object.
     * @param targetProjectDirectory - the target project directory, such as xxx/xxx/xxx, started from project directory.
     * @example
     * 1. build a sceneConfig object.

    ```typescript
    const projectDir = 'xxx/xxx/xxx';
    const sceneConfig: SceneConfig = new SceneConfig();
    sceneConfig.buildFromProjectDir(projectDir);
    ```
     */
    buildFromProjectDir(targetProjectDirectory) {
        this.targetProjectDirectory = targetProjectDirectory;
        this.targetProjectName = path_1.default.basename(targetProjectDirectory);
        this.projectFiles = (0, getAllFiles_1.getAllFiles)(targetProjectDirectory, this.options.supportFileExts, this.options.ignoreFileNames);
    }
    buildFromProjectFiles(projectName, projectDir, filesAndDirectorys, sdks) {
        if (sdks) {
            this.sdksObj = sdks;
        }
        this.targetProjectDirectory = projectDir;
        this.targetProjectName = projectName;
        if (filesAndDirectorys.length === 0) {
            logger.error('no files for build scene!');
            return;
        }
        filesAndDirectorys.forEach(fileOrDirectory => this.processFilePaths(fileOrDirectory, projectDir));
    }
    processFilePaths(fileOrDirectory, projectDir) {
        let absoluteFilePath = '';
        if (fileOrDirectory.includes(projectDir)) {
            absoluteFilePath = fileOrDirectory;
        }
        else {
            absoluteFilePath = path_1.default.join(projectDir, fileOrDirectory);
        }
        if (fs_1.default.statSync(absoluteFilePath).isDirectory()) {
            (0, getAllFiles_1.getAllFiles)(absoluteFilePath, this.getOptions().supportFileExts, this.options.ignoreFileNames).forEach((filePath) => {
                if (!this.projectFiles.includes(filePath)) {
                    this.projectFiles.push(filePath);
                }
            });
        }
        else {
            this.projectFiles.push(absoluteFilePath);
        }
    }
    buildFromJson(configJsonPath) {
        if (fs_1.default.existsSync(configJsonPath)) {
            let configurationsText;
            try {
                configurationsText = fs_1.default.readFileSync(configJsonPath, 'utf-8');
            }
            catch (error) {
                logger.error(`Error reading file: ${error}`);
                return;
            }
            logger.info(configurationsText);
            let configurations;
            try {
                configurations = JSON.parse(configurationsText);
            }
            catch (error) {
                logger.error(`Error parsing JSON: ${error}`);
                return;
            }
            const targetProjectName = configurations.targetProjectName ? configurations.targetProjectName : '';
            const targetProjectDirectory = configurations.targetProjectDirectory
                ? configurations.targetProjectDirectory
                : '';
            const sdks = configurations.sdks ? configurations.sdks : [];
            if (configurations.options) {
                this.options = Object.assign(Object.assign({}, this.options), configurations.options);
            }
            this.buildConfig(targetProjectName, targetProjectDirectory, sdks);
        }
        else {
            logger.error(`Your configJsonPath: "${configJsonPath}" is not exist.`);
        }
    }
    getTargetProjectName() {
        return this.targetProjectName;
    }
    getTargetProjectDirectory() {
        return this.targetProjectDirectory;
    }
    getProjectFiles() {
        return this.projectFiles;
    }
    getSdkFiles() {
        return this.sdkFiles;
    }
    getSdkFilesMap() {
        return this.sdkFilesMap;
    }
    getEtsSdkPath() {
        return this.etsSdkPath;
    }
    getSdksObj() {
        return this.sdksObj;
    }
    loadDefaultConfig(options) {
        let configFile = DEFAULT_CONFIG_FILE;
        if (!fs_1.default.existsSync(configFile)) {
            configFile = path_1.default.join(__dirname, 'config', CONFIG_FILENAME);
        }
        try {
            this.options = Object.assign(Object.assign({}, this.options), JSON.parse(fs_1.default.readFileSync(configFile, 'utf-8')));
        }
        catch (error) { }
        if (options) {
            this.options = Object.assign(Object.assign({}, this.options), options);
        }
    }
}
exports.SceneConfig = SceneConfig;
