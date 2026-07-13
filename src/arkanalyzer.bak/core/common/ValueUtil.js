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
exports.ValueUtil = exports.EMPTY_STRING = void 0;
const Constant_1 = require("../base/Constant");
exports.EMPTY_STRING = '';
class ValueUtil {
    static getOrCreateNumberConst(n) {
        let constant = this.NumberConstantCache.get(n);
        if (constant === undefined) {
            constant = new Constant_1.NumberConstant(n);
            this.NumberConstantCache.set(n, constant);
        }
        return constant;
    }
    static createStringConst(str) {
        if (str === exports.EMPTY_STRING) {
            return this.EMPTY_STRING_CONSTANT;
        }
        return new Constant_1.StringConstant(str);
    }
    static createConst(str) {
        const n = Number(str);
        if (!isNaN(n)) {
            return this.getOrCreateNumberConst(n);
        }
        return new Constant_1.StringConstant(str);
    }
    static getUndefinedConst() {
        return Constant_1.UndefinedConstant.getInstance();
    }
    static getNullConstant() {
        return Constant_1.NullConstant.getInstance();
    }
    static getBooleanConstant(value) {
        return Constant_1.BooleanConstant.getInstance(value);
    }
}
exports.ValueUtil = ValueUtil;
ValueUtil.NumberConstantCache = new Map();
ValueUtil.EMPTY_STRING_CONSTANT = new Constant_1.StringConstant(exports.EMPTY_STRING);
