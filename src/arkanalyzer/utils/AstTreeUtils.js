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
exports.AstTreeUtils = void 0;
const __1 = require("..");
const EtsConst_1 = require("../core/common/EtsConst");
class AstTreeUtils {
    static getASTNode(fileName, code) {
        const sourceFile = __1.ts.createSourceFile(fileName, code, __1.ts.ScriptTarget.Latest, true, undefined, EtsConst_1.ETS_COMPILER_OPTIONS);
        return sourceFile;
    }
}
exports.AstTreeUtils = AstTreeUtils;
