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
exports.IsCollectionMapSet = exports.IsCollectionSetAdd = exports.IsCollectionAPI = exports.IsCollectionClass = void 0;
function IsCollectionClass(classSignature) {
    if (classSignature.toString().endsWith('lib.es2015.collection.d.ts: Set') ||
        classSignature.toString().endsWith('lib.es2015.collection.d.ts: Map')) {
        return true;
    }
    return false;
}
exports.IsCollectionClass = IsCollectionClass;
function IsCollectionAPI(method) {
    if (IsCollectionSetAdd(method) || IsCollectionMapSet(method)) {
        return true;
    }
    return false;
}
exports.IsCollectionAPI = IsCollectionAPI;
function IsCollectionSetAdd(method) {
    if (method.toString().endsWith('lib.es2015.collection.d.ts: Set.add(T)')) {
        return true;
    }
    return false;
}
exports.IsCollectionSetAdd = IsCollectionSetAdd;
function IsCollectionMapSet(method) {
    if (method.toString().endsWith('lib.es2015.collection.d.ts: Map.set(K, V)')) {
        return true;
    }
    return false;
}
exports.IsCollectionMapSet = IsCollectionMapSet;
