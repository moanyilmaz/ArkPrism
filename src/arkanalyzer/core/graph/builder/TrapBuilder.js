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
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
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
    buildTraps(blockBuilderToCfgBlock, blockBuildersBeforeTry, arkIRTransformer, basicBlockSet) {
        var _a, _b, _c;
        const traps = [];
        for (const blockBuilderBeforeTry of blockBuildersBeforeTry) {
            if (blockBuilderBeforeTry.nexts.length === 0) {
                logger.error(`can't find try block.`);
                continue;
            }
            const blockBuilderContainTry = blockBuilderBeforeTry.nexts[0];
            const stmtsCnt = blockBuilderBeforeTry.stmts.length;
            const tryStmtBuilder = blockBuilderBeforeTry.stmts[stmtsCnt - 1];
            const finallyBlockBuilder = (_a = tryStmtBuilder.finallyStatement) === null || _a === void 0 ? void 0 : _a.block;
            if (!finallyBlockBuilder) {
                logger.error(`can't find finally block or dummy finally block.`);
                continue;
            }
            const { bfsBlocks: tryBfsBlocks, tailBlocks: tryTailBlocks } = this.getAllBlocksBFS(blockBuilderToCfgBlock, blockBuilderContainTry, finallyBlockBuilder);
            let catchBfsBlocks = [];
            let catchTailBlocks = [];
            const catchBlockBuilder = (_b = tryStmtBuilder.catchStatement) === null || _b === void 0 ? void 0 : _b.block;
            if (catchBlockBuilder) {
                ({ bfsBlocks: catchBfsBlocks, tailBlocks: catchTailBlocks } = this.getAllBlocksBFS(blockBuilderToCfgBlock, catchBlockBuilder));
            }
            const finallyStmts = finallyBlockBuilder.stmts;
            const blockBuilderAfterFinally = (_c = tryStmtBuilder.afterFinal) === null || _c === void 0 ? void 0 : _c.block;
            if (!blockBuilderAfterFinally) {
                logger.error(`can't find block after try...catch.`);
                continue;
            }
            if (finallyStmts.length === 1 && finallyStmts[0].code === 'dummyFinally') { // no finally block
                const trapsIfNoFinally = this.buildTrapsIfNoFinally(tryBfsBlocks, tryTailBlocks, catchBfsBlocks, catchTailBlocks, finallyBlockBuilder, blockBuilderAfterFinally, basicBlockSet, blockBuilderToCfgBlock);
                if (trapsIfNoFinally) {
                    traps.push(...trapsIfNoFinally);
                }
            }
            else {
                const trapsIfFinallyExist = this.buildTrapsIfFinallyExist(tryBfsBlocks, tryTailBlocks, catchBfsBlocks, catchTailBlocks, finallyBlockBuilder, blockBuilderAfterFinally, basicBlockSet, arkIRTransformer, blockBuilderToCfgBlock);
                traps.push(...trapsIfFinallyExist);
            }
        }
        return traps;
    }
    buildTrapsIfNoFinally(tryBfsBlocks, tryTailBlocks, catchBfsBlocks, catchTailBlocks, finallyBlockBuilder, blockBuilderAfterFinally, basicBlockSet, blockBuilderToCfgBlock) {
        if (catchBfsBlocks.length === 0) {
            logger.error(`catch block expected.`);
            return null;
        }
        if (!blockBuilderToCfgBlock.has(blockBuilderAfterFinally)) {
            logger.error(`can't find basicBlock corresponding to the blockBuilder.`);
            return null;
        }
        let blockAfterFinally = blockBuilderToCfgBlock.get(blockBuilderAfterFinally);
        if (!blockBuilderToCfgBlock.has(finallyBlockBuilder)) {
            logger.error(`can't find basicBlock corresponding to the blockBuilder.`);
            return null;
        }
        const finallyBlock = blockBuilderToCfgBlock.get(finallyBlockBuilder);
        let dummyFinallyIdxInPredecessors = -1;
        for (let i = 0; i < blockAfterFinally.getPredecessors().length; i++) {
            if (blockAfterFinally.getPredecessors()[i] === finallyBlock) {
                dummyFinallyIdxInPredecessors = i;
                break;
            }
        }
        if (dummyFinallyIdxInPredecessors === -1) {
            return null;
        }
        blockAfterFinally.getPredecessors().splice(dummyFinallyIdxInPredecessors, 1);
        for (const tryTailBlock of tryTailBlocks) {
            tryTailBlock.setSuccessorBlock(0, blockAfterFinally);
            blockAfterFinally.addPredecessorBlock(tryTailBlock);
        }
        basicBlockSet.delete(finallyBlock);
        for (const catchTailBlock of catchTailBlocks) {
            catchTailBlock.addSuccessorBlock(blockAfterFinally);
            blockAfterFinally.addPredecessorBlock(catchTailBlock);
        }
        for (const tryTailBlock of tryTailBlocks) {
            tryTailBlock.addExceptionalSuccessorBlock(catchBfsBlocks[0]);
        }
        return [new Trap_1.Trap(tryBfsBlocks, catchBfsBlocks)];
    }
    buildTrapsIfFinallyExist(tryBfsBlocks, tryTailBlocks, catchBfsBlocks, catchTailBlocks, finallyBlockBuilder, blockBuilderAfterFinally, basicBlockSet, arkIRTransformer, blockBuilderToCfgBlock) {
        const { bfsBlocks: finallyBfsBlocks, tailBlocks: finallyTailBlocks } = this.getAllBlocksBFS(blockBuilderToCfgBlock, finallyBlockBuilder, blockBuilderAfterFinally);
        const copyFinallyBfsBlocks = this.copyFinallyBlocks(finallyBfsBlocks, finallyTailBlocks, basicBlockSet, arkIRTransformer, blockBuilderToCfgBlock);
        const traps = [];
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
    getAllBlocksBFS(blockBuilderToCfgBlock, startBlockBuilder, endBlockBuilder) {
        const bfsBlocks = [];
        const tailBlocks = [];
        const queue = [];
        const visitedBlockBuilders = new Set();
        queue.push(startBlockBuilder);
        while (queue.length !== 0) {
            const currBlockBuilder = queue.splice(0, 1)[0];
            if (visitedBlockBuilders.has(currBlockBuilder)) {
                continue;
            }
            visitedBlockBuilders.add(currBlockBuilder);
            if (!blockBuilderToCfgBlock.has(currBlockBuilder)) {
                logger.error(`can't find basicBlock corresponding to the blockBuilder.`);
                continue;
            }
            const currBlock = blockBuilderToCfgBlock.get(currBlockBuilder);
            bfsBlocks.push(currBlock);
            const childList = currBlockBuilder.nexts;
            if (childList.length === 0 || (childList.length !== 0 && (childList[0] === endBlockBuilder))) {
                if (childList[0] === endBlockBuilder) {
                    tailBlocks.push(currBlock);
                    continue;
                }
            }
            if (childList.length !== 0) {
                for (const child of childList) {
                    queue.push(child);
                }
            }
        }
        return { bfsBlocks, tailBlocks };
    }
    copyFinallyBlocks(finallyBfsBlocks, finallyTailBlocks, basicBlockSet, arkIRTransformer, blockBuilderToCfgBlock) {
        var _a;
        const copyFinallyBfsBlocks = this.copyBlocks(finallyBfsBlocks);
        const caughtExceptionRef = new Ref_1.ArkCaughtExceptionRef(Type_1.UnknownType.getInstance());
        const { value: exceptionValue, stmts: exceptionAssignStmts, } = arkIRTransformer.generateAssignStmtForValue(caughtExceptionRef, [Position_1.FullPosition.DEFAULT]);
        copyFinallyBfsBlocks[0].addHead(exceptionAssignStmts);
        const finallyPredecessorsCnt = copyFinallyBfsBlocks[0].getPredecessors().length;
        copyFinallyBfsBlocks[0].getPredecessors().splice(0, finallyPredecessorsCnt);
        const throwStmt = new Stmt_1.ArkThrowStmt(exceptionValue);
        let copyFinallyTailBlocks = copyFinallyBfsBlocks.splice(copyFinallyBfsBlocks.length - finallyTailBlocks.length, finallyTailBlocks.length);
        copyFinallyTailBlocks.forEach((copyFinallyTailBlock) => {
            const successorsCnt = copyFinallyTailBlock.getSuccessors().length;
            copyFinallyTailBlock.getSuccessors().splice(0, successorsCnt);
        });
        if (copyFinallyTailBlocks.length > 1) {
            const newCopyFinallyTailBlock = new BasicBlock_1.BasicBlock();
            copyFinallyTailBlocks.forEach((copyFinallyTailBlock) => {
                copyFinallyTailBlock.addSuccessorBlock(newCopyFinallyTailBlock);
                newCopyFinallyTailBlock.addPredecessorBlock(copyFinallyTailBlock);
            });
            copyFinallyTailBlocks = [newCopyFinallyTailBlock];
        }
        (_a = copyFinallyTailBlocks[0]) === null || _a === void 0 ? void 0 : _a.addStmt(throwStmt);
        copyFinallyBfsBlocks.push(...copyFinallyTailBlocks);
        copyFinallyBfsBlocks.forEach((copyFinallyBfsBlock) => {
            basicBlockSet.add(copyFinallyBfsBlock);
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
                targetBlock.addPredecessorBlock(targetPredecessor);
            }
            for (const successor of sourceBlock.getSuccessors()) {
                const targetSuccessor = sourceToTarget.get(successor);
                targetBlock.addSuccessorBlock(targetSuccessor);
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
