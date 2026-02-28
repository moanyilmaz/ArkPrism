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
exports.KLimitedContextSensitive = exports.DUMMY_CID = void 0;
exports.DUMMY_CID = 0;
class Context {
    constructor(contextElems = []) {
        this.contextElems = contextElems;
    }
    static newEmpty() {
        return new Context();
    }
    static new(contextElems) {
        return new Context(contextElems);
    }
    // use old context and a new element to create a new k-limited Context 
    static newKLimitedContext(oldCtx, elem, k) {
        let elems = [];
        if (k > 0) {
            elems.push(elem);
            if (oldCtx.contextElems.length < k) {
                elems = elems.concat(oldCtx.contextElems);
            }
            else {
                elems = elems.concat(oldCtx.contextElems.slice(0, k - 1));
            }
        }
        return new Context(elems);
    }
    static kLimitedContext(ctx, k) {
        if (ctx.length() <= k) {
            return new Context(ctx.contextElems);
        }
        else {
            const elems = ctx.contextElems.slice(0, k);
            return new Context(elems);
        }
    }
    length() {
        return this.contextElems.length;
    }
    get(index) {
        if (index < 0 || index >= this.contextElems.length) {
            throw new Error('Index out of bounds');
        }
        return this.contextElems[index];
    }
    toString() {
        return this.contextElems.join('-');
    }
}
Context.sEmptyCtx = new Context([]);
class ContextCache {
    constructor() {
        this.contextList = [];
        this.contextToIDMap = new Map();
        this.contextList = [];
        this.contextToIDMap = new Map();
    }
    getOrNewContextID(context) {
        let cStr = context.toString();
        if (this.contextToIDMap.has(cStr)) {
            return this.contextToIDMap.get(cStr);
        }
        else {
            // real cid start from 1
            const id = this.contextList.length;
            this.contextList.push(context);
            this.contextToIDMap.set(cStr, id);
            return id;
        }
    }
    updateContext(id, newContext, oldContext) {
        if (this.contextList.length < id) {
            return false;
        }
        this.contextList[id] = newContext;
        let oldCStr = oldContext.toString();
        let newCStr = newContext.toString();
        this.contextToIDMap.delete(oldCStr);
        this.contextToIDMap.set(newCStr, id);
        return true;
    }
    getContextID(context) {
        let cStr = context.toString();
        if (this.contextToIDMap.has(cStr)) {
            return this.contextToIDMap.get(cStr);
        }
        return undefined;
    }
    getContext(id) {
        //if (id === 0 || id > this.contextList.length) {
        if (id > this.contextList.length) {
            return undefined;
        }
        return this.contextList[id];
    }
    getContextList() {
        return this.contextList;
    }
}
class KLimitedContextSensitive {
    constructor(k) {
        this.k = k;
        this.ctxCache = new ContextCache();
        // put dummy cid
        this.getEmptyContextID();
    }
    emptyContext() {
        return new Context([]);
    }
    getEmptyContextID() {
        return this.getContextID(Context.newEmpty());
    }
    getContextID(context) {
        return this.ctxCache.getOrNewContextID(context);
    }
    getContextByID(context_id) {
        return this.ctxCache.getContext(context_id);
    }
    getNewContextID(callerFuncId) {
        return this.ctxCache.getOrNewContextID(Context.new([callerFuncId]));
    }
    getOrNewContext(callerCid, calleeFuncId, findCalleeAsTop = false) {
        const callerCtx = this.ctxCache.getContext(callerCid);
        if (!callerCtx) {
            throw new Error(`Context with id ${callerCid} not found.`);
        }
        const calleeNewCtx = Context.newKLimitedContext(callerCtx, calleeFuncId, this.k);
        if (findCalleeAsTop) {
            const calleeAsTopCtx = Context.newKLimitedContext(Context.sEmptyCtx, calleeFuncId, this.k);
            let topID = this.ctxCache.getContextID(calleeAsTopCtx);
            if (topID) {
                this.ctxCache.updateContext(topID, calleeNewCtx, calleeAsTopCtx);
                return topID;
            }
        }
        const calleeCid = this.ctxCache.getOrNewContextID(calleeNewCtx);
        return calleeCid;
    }
}
exports.KLimitedContextSensitive = KLimitedContextSensitive;
