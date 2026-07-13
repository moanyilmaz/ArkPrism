"use strict";
/*
 * Copyright (c) 2025 Huawei Device Co., Ltd.
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
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.TrapBuilder = void 0;
const BasicBlock_1 = require("../BasicBlock");
const Trap_1 = require("../../base/Trap");
const Ref_1 = require("../../base/Ref");
const Type_1 = require("../../base/Type");
const Position_1 = require("../../base/Position");
const Stmt_1 = require("../../base/Stmt");
const logger_1 = __importStar(require("../../../utils/logger"));
const logger = logger_1.default.getLogger(logger_1.LOG_MODULE_TYPE.ARKANALYZER, 'TrapBuilder');
/**
 * Builder for traps from try...catch
 */
class TrapBuilder {
    constructor(blockBuildersBeforeTry, blockBuilderToCfgBlock, arkIRTransformer, basicBlockSet) {
        this.blockBuildersBeforeTry = blockBuildersBeforeTry;
        this.processedBlockBuildersBeforeTry = new Set();
        this.arkIRTransformer = arkIRTransformer;
        this.basicBlockSet = basicBlockSet;
        this.blockBuilderToCfgBlock = blockBuilderToCfgBlock;
    }
    buildTraps() {
        const traps = [];
        const blockBuildersBeforeTry = Array.from(this.blockBuildersBeforeTry);
        for (const blockBuilderBeforeTry of blockBuildersBeforeTry) {
            traps.push(...this.buildTrapGroup(blockBuilderBeforeTry).traps);
        }
        return traps;
    }
    buildTrapGroup(blockBuilderBeforeTry) {
        if (this.shouldSkipProcessing(blockBuilderBeforeTry)) {
            return { traps: [], headBlockBuilder: null };
        }
        const tryStmtBuilder = this.getTryStatementBuilder(blockBuilderBeforeTry);
        if (!tryStmtBuilder) {
            return { traps: [], headBlockBuilder: null };
        }
        const finallyBlockBuilder = this.getFinallyBlock(tryStmtBuilder);
        if (!finallyBlockBuilder) {
            return { traps: [], headBlockBuilder: null };
        }
        const headBlockBuilderWithinTry = this.prepareHeadBlock(blockBuilderBeforeTry);
        const traps = [];
        const tryResult = this.processTryBlock(headBlockBuilderWithinTry, finallyBlockBuilder);
        traps.push(...tryResult.traps);
        const updatedHeadBlock = tryResult.newStartBlockBuilder;
        const catchResult = this.processCatchBlock(tryStmtBuilder);
        traps.push(...catchResult.traps);
        const blockBuilderAfterFinally = this.getAfterFinallyBlock(tryStmtBuilder);
        if (!blockBuilderAfterFinally) {
            return { traps: [], headBlockBuilder: null };
        }
        const singleTraps = this.buildSingleTraps(tryResult.bfsBlocks, tryResult.tailBlocks, catchResult.bfsBlocks, catchResult.tailBlocks, finallyBlockBuilder, blockBuilderAfterFinally);
        traps.push(...singleTraps);
        return { traps, headBlockBuilder: updatedHeadBlock };
    }
    shouldSkipProcessing(blockBuilderBeforeTry) {
        if (this.processedBlockBuildersBeforeTry.has(blockBuilderBeforeTry)) {
            return true;
        }
        this.processedBlockBuildersBeforeTry.add(blockBuilderBeforeTry);
        if (blockBuilderBeforeTry.nexts.length === 0) {
            logger.error(`can't find try block.`);
            return true;
        }
        return false;
    }
    getTryStatementBuilder(blockBuilderBeforeTry) {
        const stmtsCnt = blockBuilderBeforeTry.stmts.length;
        const tryStmtBuilder = blockBuilderBeforeTry.stmts[stmtsCnt - 1];
        return tryStmtBuilder;
    }
    getFinallyBlock(tryStmtBuilder) {
        var _a;
        const finallyBlockBuilder = (_a = tryStmtBuilder.finallyStatement) === null || _a === void 0 ? void 0 : _a.block;
        if (!finallyBlockBuilder) {
            logger.error(`can't find finally block or dummy finally block.`);
            return null;
        }
        return finallyBlockBuilder;
    }
    prepareHeadBlock(blockBuilderBeforeTry) {
        const headBlockBuilderWithinTry = blockBuilderBeforeTry.nexts[0];
        this.removeEmptyBlockBeforeTry(blockBuilderBeforeTry);
        return headBlockBuilderWithinTry;
    }
    processTryBlock(headBlockBuilderWithinTry, finallyBlockBuilder) {
        const result = this.buildTrapsRecursively(headBlockBuilderWithinTry, finallyBlockBuilder);
        const { bfsBlocks, tailBlocks } = this.getAllBlocksBFS(result.newStartBlockBuilder, finallyBlockBuilder);
        return {
            traps: result.traps,
            newStartBlockBuilder: result.newStartBlockBuilder,
            bfsBlocks,
            tailBlocks
        };
    }
    processCatchBlock(tryStmtBuilder) {
        var _a;
        const catchBlockBuilder = (_a = tryStmtBuilder.catchStatement) === null || _a === void 0 ? void 0 : _a.block;
        if (!catchBlockBuilder) {
            return { traps: [], bfsBlocks: [], tailBlocks: [] };
        }
        const result = this.buildTrapsRecursively(catchBlockBuilder);
        const { bfsBlocks, tailBlocks } = this.getAllBlocksBFS(result.newStartBlockBuilder);
        return {
            traps: result.traps,
            bfsBlocks,
            tailBlocks
        };
    }
    getAfterFinallyBlock(tryStmtBuilder) {
        var _a;
        const blockBuilderAfterFinally = (_a = tryStmtBuilder.afterFinal) === null || _a === void 0 ? void 0 : _a.block;
        if (!blockBuilderAfterFinally) {
            logger.error(`can't find block after try...catch.`);
            return null;
        }
        return blockBuilderAfterFinally;
    }
    buildSingleTraps(tryBfsBlocks, tryTailBlocks, catchBfsBlocks, catchTailBlocks, finallyBlockBuilder, blockBuilderAfterFinally) {
        const finallyStmts = finallyBlockBuilder.stmts;
        if (finallyStmts.length === 1 && finallyStmts[0].code === 'dummyFinally') {
            return this.buildTrapsIfNoFinally(tryBfsBlocks, tryTailBlocks, catchBfsBlocks, catchTailBlocks, finallyBlockBuilder);
        }
        else {
            return this.buildTrapsIfFinallyExist(tryBfsBlocks, tryTailBlocks, catchBfsBlocks, catchTailBlocks, finallyBlockBuilder, blockBuilderAfterFinally);
        }
    }
    buildTrapsRecursively(startBlockBuilder, endBlockBuilder) {
        const queue = [];
        const visitedBlockBuilders = new Set();
        queue.push(startBlockBuilder);
        while (queue.length !== 0) {
            const currBlockBuilder = queue.splice(0, 1)[0];
            if (visitedBlockBuilders.has(currBlockBuilder)) {
                continue;
            }
            visitedBlockBuilders.add(currBlockBuilder);
            const childList = currBlockBuilder.nexts;
            for (const child of childList) {
                if (child !== endBlockBuilder) {
                    queue.push(child);
                }
            }
        }
        const allTraps = [];
        for (const blockBuilder of visitedBlockBuilders) {
            if (this.blockBuildersBeforeTry.has(blockBuilder)) {
                const { traps, headBlockBuilder } = this.buildTrapGroup(blockBuilder);
                allTraps.push(...traps);
                if (blockBuilder === startBlockBuilder && this.shouldRemoveEmptyBlockBeforeTry(blockBuilder)) {
                    startBlockBuilder = headBlockBuilder;
                }
            }
        }
        return { traps: allTraps, newStartBlockBuilder: startBlockBuilder };
    }
    removeEmptyBlockBeforeTry(blockBuilderBeforeTry) {
        if (!this.shouldRemoveEmptyBlockBeforeTry(blockBuilderBeforeTry)) {
            return;
        }
        const headBlockBuilderWithinTry = blockBuilderBeforeTry.nexts[0];
        const headBlockWithinTry = this.blockBuilderToCfgBlock.get(headBlockBuilderWithinTry);
        headBlockWithinTry.getPredecessors().splice(0, 1);
        const prevsOfBlockBuilderBeforeTry = blockBuilderBeforeTry.lasts;
        for (const prevBlockBuilder of prevsOfBlockBuilderBeforeTry) {
            const prevBlock = this.blockBuilderToCfgBlock.get(prevBlockBuilder);
            for (let j = 0; j < prevBlockBuilder.nexts.length; j++) {
                if (prevBlockBuilder.nexts[j] === blockBuilderBeforeTry) {
                    prevBlockBuilder.nexts[j] = headBlockBuilderWithinTry;
                    prevBlock.setSuccessorBlock(j, headBlockWithinTry);
                    break;
                }
            }
            headBlockWithinTry.addPredecessorBlock(prevBlock);
        }
        headBlockBuilderWithinTry.lasts.splice(0, 1, ...prevsOfBlockBuilderBeforeTry);
        this.basicBlockSet.delete(this.blockBuilderToCfgBlock.get(blockBuilderBeforeTry));
        this.blockBuilderToCfgBlock.delete(blockBuilderBeforeTry);
    }
    shouldRemoveEmptyBlockBeforeTry(blockBuilderBeforeTry) {
        const stmtsCnt = blockBuilderBeforeTry.stmts.length;
        // This BlockBuilder contains only one redundant TryStatementBuilder, so the BlockBuilder can be deleted.
        return stmtsCnt === 1;
    }
    buildTrapsIfNoFinally(tryBfsBlocks, tryTailBlocks, catchBfsBlocks, catchTailBlocks, finallyBlockBuilder) {
        if (catchBfsBlocks.length === 0) {
            logger.error(`catch block expected.`);
            return [];
        }
        const blockBuilderAfterFinally = finallyBlockBuilder.nexts[0];
        let blockAfterFinally = this.blockBuilderToCfgBlock.get(blockBuilderAfterFinally);
        if (!this.blockBuilderToCfgBlock.has(finallyBlockBuilder)) {
            logger.error(`can't find basicBlock corresponding to the blockBuilder.`);
            return [];
        }
        const finallyBlock = this.blockBuilderToCfgBlock.get(finallyBlockBuilder);
        let dummyFinallyIdxInPredecessors = -1;
        for (let i = 0; i < blockAfterFinally.getPredecessors().length; i++) {
            if (blockAfterFinally.getPredecessors()[i] === finallyBlock) {
                dummyFinallyIdxInPredecessors = i;
                break;
            }
        }
        if (dummyFinallyIdxInPredecessors === -1) {
            logger.error(`Dummy finally block isn't a predecessor of block after finally block.`);
            return [];
        }
        blockAfterFinally.getPredecessors().splice(dummyFinallyIdxInPredecessors, 1);
        for (const tryTailBlock of tryTailBlocks) {
            tryTailBlock.setSuccessorBlock(0, blockAfterFinally);
            blockAfterFinally.addPredecessorBlock(tryTailBlock);
        }
        this.basicBlockSet.delete(finallyBlock);
        for (const catchTailBlock of catchTailBlocks) {
            catchTailBlock.addSuccessorBlock(blockAfterFinally);
            blockAfterFinally.addPredecessorBlock(catchTailBlock);
        }
        for (const tryTailBlock of tryTailBlocks) {
            tryTailBlock.addExceptionalSuccessorBlock(catchBfsBlocks[0]);
        }
        return [new Trap_1.Trap(tryBfsBlocks, catchBfsBlocks)];
    }
    buildTrapsIfFinallyExist(tryBfsBlocks, tryTailBlocks, catchBfsBlocks, catchTailBlocks, finallyBlockBuilder, blockBuilderAfterFinally) {
        const traps = [];
        const { traps: trapsInFinally, newStartBlockBuilder: newStartBlockBuilder, } = this.buildTrapsRecursively(finallyBlockBuilder, blockBuilderAfterFinally);
        traps.push(...trapsInFinally);
        // May update head blockBuilder with catch statement.
        finallyBlockBuilder = newStartBlockBuilder;
        const { bfsBlocks: finallyBfsBlocks, tailBlocks: finallyTailBlocks } = this.getAllBlocksBFS(finallyBlockBuilder, blockBuilderAfterFinally);
        const copyFinallyBfsBlocks = this.copyFinallyBlocks(finallyBfsBlocks, finallyTailBlocks);
        if (catchBfsBlocks.length !== 0) {
            for (const catchTailBlock of catchTailBlocks) {
                catchTailBlock.addSuccessorBlock(finallyBfsBlocks[0]);
                finallyBfsBlocks[0].addPredecessorBlock(catchTailBlock);
            }
            // try -> catch trap
            for (const tryTailBlock of tryTailBlocks) {
                tryTailBlock.addExceptionalSuccessorBlock(catchBfsBlocks[0]);
            }
            traps.push(new Trap_1.Trap(tryBfsBlocks, catchBfsBlocks));
            // catch -> finally trap
            for (const catchTailBlock of catchTailBlocks) {
                catchTailBlock.addExceptionalSuccessorBlock(copyFinallyBfsBlocks[0]);
            }
            traps.push(new Trap_1.Trap(catchBfsBlocks, copyFinallyBfsBlocks));
        }
        else {
            // try -> finally trap
            for (const tryTailBlock of tryTailBlocks) {
                tryTailBlock.addExceptionalSuccessorBlock(copyFinallyBfsBlocks[0]);
            }
            traps.push(new Trap_1.Trap(tryBfsBlocks, copyFinallyBfsBlocks));
        }
        return traps;
    }
    getAllBlocksBFS(startBlockBuilder, endBlockBuilder) {
        const bfsBlocks = [];
        const tailBlocks = [];
        const startBlock = this.blockBuilderToCfgBlock.get(startBlockBuilder);
        const endBlock = endBlockBuilder ? this.blockBuilderToCfgBlock.get(endBlockBuilder) : undefined;
        const queue = [];
        const visitedBlocks = new Set();
        queue.push(startBlock);
        while (queue.length !== 0) {
            const currBlock = queue.splice(0, 1)[0];
            if (visitedBlocks.has(currBlock)) {
                continue;
            }
            visitedBlocks.add(currBlock);
            bfsBlocks.push(currBlock);
            const successors = currBlock.getSuccessors();
            if (successors.length !== 0) {
                for (const successor of successors) {
                    if (successor === endBlock) {
                        tailBlocks.push(currBlock);
                    }
                    else {
                        // A tail block's successor may be within the traversal range
                        queue.push(successor);
                    }
                }
            }
            else {
                tailBlocks.push(currBlock);
            }
        }
        return { bfsBlocks, tailBlocks };
    }
    copyFinallyBlocks(finallyBfsBlocks, finallyTailBlocks) {
        const copyFinallyBfsBlocks = this.copyBlocks(finallyBfsBlocks);
        const caughtExceptionRef = new Ref_1.ArkCaughtExceptionRef(Type_1.UnknownType.getInstance());
        const { value: exceptionValue, stmts: exceptionAssignStmts, } = this.arkIRTransformer.generateAssignStmtForValue(caughtExceptionRef, [Position_1.FullPosition.DEFAULT]);
        copyFinallyBfsBlocks[0].addHead(exceptionAssignStmts);
        const finallyPredecessorsCnt = copyFinallyBfsBlocks[0].getPredecessors().length;
        copyFinallyBfsBlocks[0].getPredecessors().splice(0, finallyPredecessorsCnt);
        const throwStmt = new Stmt_1.ArkThrowStmt(exceptionValue);
        let copyFinallyTailBlocks = copyFinallyBfsBlocks.splice(copyFinallyBfsBlocks.length - finallyTailBlocks.length, finallyTailBlocks.length);
        if (copyFinallyTailBlocks.length > 1) {
            const newCopyFinallyTailBlock = new BasicBlock_1.BasicBlock();
            copyFinallyTailBlocks.forEach((copyFinallyTailBlock) => {
                copyFinallyTailBlock.addSuccessorBlock(newCopyFinallyTailBlock);
                newCopyFinallyTailBlock.addPredecessorBlock(copyFinallyTailBlock);
            });
            copyFinallyBfsBlocks.push(...copyFinallyTailBlocks);
            copyFinallyTailBlocks = [newCopyFinallyTailBlock];
        }
        copyFinallyTailBlocks[0].addStmt(throwStmt);
        copyFinallyBfsBlocks.push(...copyFinallyTailBlocks);
        copyFinallyBfsBlocks.forEach((copyFinallyBfsBlock) => {
            this.basicBlockSet.add(copyFinallyBfsBlock);
        });
        return copyFinallyBfsBlocks;
    }
    copyBlocks(sourceBlocks) {
        const sourceToTarget = new Map();
        const targetBlocks = [];
        for (const sourceBlock of sourceBlocks) {
            const targetBlock = new BasicBlock_1.BasicBlock();
            for (const stmt of sourceBlock.getStmts()) {
                targetBlock.addStmt(this.copyStmt(stmt));
            }
            sourceToTarget.set(sourceBlock, targetBlock);
            targetBlocks.push(targetBlock);
        }
        for (const sourceBlock of sourceBlocks) {
            const targetBlock = sourceToTarget.get(sourceBlock);
            for (const predecessor of sourceBlock.getPredecessors()) {
                const targetPredecessor = sourceToTarget.get(predecessor);
                // Only include blocks within the copy range, so that predecessor and successor relationships to
                // external blocks can be trimmed
                if (targetPredecessor) {
                    targetBlock.addPredecessorBlock(targetPredecessor);
                }
            }
            for (const successor of sourceBlock.getSuccessors()) {
                const targetSuccessor = sourceToTarget.get(successor);
                if (targetSuccessor) {
                    targetBlock.addSuccessorBlock(targetSuccessor);
                }
            }
        }
        return targetBlocks;
    }
    copyStmt(sourceStmt) {
        if (sourceStmt instanceof Stmt_1.ArkAssignStmt) {
            return new Stmt_1.ArkAssignStmt(sourceStmt.getLeftOp(), sourceStmt.getRightOp());
        }
        else if (sourceStmt instanceof Stmt_1.ArkInvokeStmt) {
            return new Stmt_1.ArkInvokeStmt(sourceStmt.getInvokeExpr());
        }
        else if (sourceStmt instanceof Stmt_1.ArkIfStmt) {
            return new Stmt_1.ArkIfStmt(sourceStmt.getConditionExpr());
        }
        else if (sourceStmt instanceof Stmt_1.ArkReturnStmt) {
            return new Stmt_1.ArkReturnStmt(sourceStmt.getOp());
        }
        else if (sourceStmt instanceof Stmt_1.ArkReturnVoidStmt) {
            return new Stmt_1.ArkReturnVoidStmt();
        }
        else if (sourceStmt instanceof Stmt_1.ArkThrowStmt) {
            return new Stmt_1.ArkThrowStmt(sourceStmt.getOp());
        }
        return null;
    }
}
exports.TrapBuilder = TrapBuilder;
