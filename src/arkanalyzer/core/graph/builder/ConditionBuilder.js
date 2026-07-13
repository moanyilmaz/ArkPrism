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
Object.defineProperty(exports, "__esModule", { value: true });
exports.ConditionBuilder = void 0;
const BasicBlock_1 = require("../BasicBlock");
const ArkIRTransformer_1 = require("../../common/ArkIRTransformer");
const Stmt_1 = require("../../base/Stmt");
const Local_1 = require("../../base/Local");
const IRUtils_1 = require("../../common/IRUtils");
/**
 * Builder for condition in CFG
 */
class ConditionBuilder {
    rebuildBlocksContainConditionalOperator(blockBuilderToCfgBlock, basicBlockSet, isArkUIBuilder) {
        var _a;
        if (isArkUIBuilder) {
            this.deleteDummyConditionalOperatorStmt(basicBlockSet);
            return;
        }
        const blockPairsToSet = [];
        for (const [currBlockBuilder, currBasicBlock] of blockBuilderToCfgBlock) {
            const stmtsInCurrBasicBlock = Array.from(currBasicBlock.getStmts());
            const stmtsCnt = stmtsInCurrBasicBlock.length;
            let conditionalOperatorEndPos = -1;
            for (let i = stmtsCnt - 1; i >= 0; i--) {
                const stmt = stmtsInCurrBasicBlock[i];
                if (stmt instanceof ArkIRTransformer_1.DummyStmt && ((_a = stmt.toString()) === null || _a === void 0 ? void 0 : _a.startsWith(ArkIRTransformer_1.ArkIRTransformer.DUMMY_CONDITIONAL_OPERATOR_END_STMT))) {
                    conditionalOperatorEndPos = i;
                    break;
                }
            }
            if (conditionalOperatorEndPos === -1) {
                continue;
            }
            let { generatedTopBlock: generatedTopBlock, generatedBottomBlocks: generatedBottomBlocks } = this.generateBlocksContainConditionalOperatorGroup(stmtsInCurrBasicBlock.slice(0, conditionalOperatorEndPos + 1), basicBlockSet);
            if (conditionalOperatorEndPos !== stmtsCnt - 1) {
                // need create a new basic block for rest statements
                const { generatedTopBlock: extraBlock } = this.generateBlockWithoutConditionalOperator(stmtsInCurrBasicBlock.slice(conditionalOperatorEndPos + 1));
                generatedBottomBlocks.forEach(generatedBottomBlock => {
                    generatedBottomBlock.addSuccessorBlock(extraBlock);
                    extraBlock.addPredecessorBlock(generatedBottomBlock);
                });
                basicBlockSet.add(extraBlock);
                generatedBottomBlocks = this.removeUnnecessaryBlocksInConditionalOperator(extraBlock, basicBlockSet);
            }
            this.relinkPrevAndSuccOfBlockContainConditionalOperator(currBasicBlock, generatedTopBlock, generatedBottomBlocks);
            basicBlockSet.delete(currBasicBlock);
            blockPairsToSet.push([currBlockBuilder, generatedTopBlock]);
        }
        for (const [currBlockBuilder, generatedTopBlock] of blockPairsToSet) {
            blockBuilderToCfgBlock.set(currBlockBuilder, generatedTopBlock);
        }
    }
    relinkPrevAndSuccOfBlockContainConditionalOperator(currBasicBlock, generatedTopBlock, generatedBottomBlocks) {
        const predecessorsOfCurrBasicBlock = Array.from(currBasicBlock.getPredecessors());
        predecessorsOfCurrBasicBlock.forEach(predecessor => {
            predecessor.removeSuccessorBlock(currBasicBlock);
            currBasicBlock.removePredecessorBlock(predecessor);
            generatedTopBlock.addPredecessorBlock(predecessor);
            predecessor.addSuccessorBlock(generatedTopBlock);
        });
        const successorsOfCurrBasicBlock = Array.from(currBasicBlock.getSuccessors());
        successorsOfCurrBasicBlock.forEach(successor => {
            successor.removePredecessorBlock(currBasicBlock);
            currBasicBlock.removeSuccessorBlock(successor);
            generatedBottomBlocks.forEach(generatedBottomBlock => {
                generatedBottomBlock.addSuccessorBlock(successor);
                successor.addPredecessorBlock(generatedBottomBlock);
            });
        });
    }
    generateBlocksContainConditionalOperatorGroup(sourceStmts, basicBlockSet) {
        const { firstEndPos: firstEndPos } = this.findFirstConditionalOperator(sourceStmts);
        if (firstEndPos === -1) {
            return this.generateBlockWithoutConditionalOperator(sourceStmts);
        }
        const { generatedTopBlock: firstGeneratedTopBlock, generatedBottomBlocks: firstGeneratedBottomBlocks, generatedAllBlocks: firstGeneratedAllBlocks, } = this.generateBlocksContainSingleConditionalOperator(sourceStmts.slice(0, firstEndPos + 1));
        const generatedTopBlock = firstGeneratedTopBlock;
        let generatedBottomBlocks = firstGeneratedBottomBlocks;
        firstGeneratedAllBlocks.forEach(block => basicBlockSet.add(block));
        const stmtsCnt = sourceStmts.length;
        if (firstEndPos !== stmtsCnt - 1) {
            // need handle other conditional operators
            const { generatedTopBlock: restGeneratedTopBlock, generatedBottomBlocks: restGeneratedBottomBlocks } = this.generateBlocksContainConditionalOperatorGroup(sourceStmts.slice(firstEndPos + 1, stmtsCnt), basicBlockSet);
            firstGeneratedBottomBlocks.forEach(firstGeneratedBottomBlock => {
                firstGeneratedBottomBlock.addSuccessorBlock(restGeneratedTopBlock);
                restGeneratedTopBlock.addPredecessorBlock(firstGeneratedBottomBlock);
            });
            restGeneratedBottomBlocks.forEach(block => basicBlockSet.add(block));
            this.removeUnnecessaryBlocksInConditionalOperator(restGeneratedTopBlock, basicBlockSet);
            generatedBottomBlocks = restGeneratedBottomBlocks;
        }
        return { generatedTopBlock, generatedBottomBlocks };
    }
    generateBlocksContainSingleConditionalOperator(sourceStmts) {
        const { firstIfTruePos: ifTruePos, firstIfFalsePos: ifFalsePos, firstEndPos: endPos } = this.findFirstConditionalOperator(sourceStmts);
        if (endPos === -1) {
            return this.generateBlockWithoutConditionalOperator(sourceStmts);
        }
        const { generatedTopBlock: generatedTopBlock, generatedAllBlocks: generatedAllBlocks } = this.generateBlockWithoutConditionalOperator(sourceStmts.slice(0, ifTruePos));
        let generatedBottomBlocks = [];
        const { generatedTopBlock: generatedTopBlockOfTrueBranch, generatedBottomBlocks: generatedBottomBlocksOfTrueBranch, generatedAllBlocks: generatedAllBlocksOfTrueBranch, } = this.generateBlocksContainSingleConditionalOperator(sourceStmts.slice(ifTruePos + 1, ifFalsePos));
        generatedBottomBlocks.push(...generatedBottomBlocksOfTrueBranch);
        generatedAllBlocks.push(...generatedAllBlocksOfTrueBranch);
        const { generatedTopBlock: generatedTopBlockOfFalseBranch, generatedBottomBlocks: generatedBottomBlocksOfFalseBranch, generatedAllBlocks: generatedAllBlocksOfFalseBranch, } = this.generateBlocksContainSingleConditionalOperator(sourceStmts.slice(ifFalsePos + 1, endPos));
        generatedBottomBlocks.push(...generatedBottomBlocksOfFalseBranch);
        generatedAllBlocks.push(...generatedAllBlocksOfFalseBranch);
        generatedTopBlock.addSuccessorBlock(generatedTopBlockOfTrueBranch);
        generatedTopBlockOfTrueBranch.addPredecessorBlock(generatedTopBlock);
        generatedTopBlock.addSuccessorBlock(generatedTopBlockOfFalseBranch);
        generatedTopBlockOfFalseBranch.addPredecessorBlock(generatedTopBlock);
        const stmtsCnt = sourceStmts.length;
        if (endPos !== stmtsCnt - 1) {
            // need create a new basic block for rest statements
            const { generatedTopBlock: extraBlock } = this.generateBlockWithoutConditionalOperator(sourceStmts.slice(endPos + 1));
            generatedBottomBlocks.forEach(generatedBottomBlock => {
                generatedBottomBlock.addSuccessorBlock(extraBlock);
                extraBlock.addPredecessorBlock(generatedBottomBlock);
            });
            generatedBottomBlocks = [extraBlock];
            generatedAllBlocks.push(extraBlock);
        }
        return { generatedTopBlock, generatedBottomBlocks, generatedAllBlocks };
    }
    generateBlockWithoutConditionalOperator(sourceStmts) {
        const generatedBlock = new BasicBlock_1.BasicBlock();
        sourceStmts.forEach(stmt => generatedBlock.addStmt(stmt));
        return {
            generatedTopBlock: generatedBlock,
            generatedBottomBlocks: [generatedBlock],
            generatedAllBlocks: [generatedBlock],
        };
    }
    deleteDummyConditionalOperatorStmt(basicBlockSet) {
        var _a;
        for (const basicBlock of basicBlockSet) {
            const stmts = Array.from(basicBlock.getStmts());
            for (const stmt of stmts) {
                if (stmt instanceof ArkIRTransformer_1.DummyStmt && ((_a = stmt.toString()) === null || _a === void 0 ? void 0 : _a.startsWith(ArkIRTransformer_1.ArkIRTransformer.DUMMY_CONDITIONAL_OPERATOR))) {
                    basicBlock.remove(stmt);
                }
            }
        }
    }
    findFirstConditionalOperator(stmts) {
        let firstIfTruePos = -1;
        let firstIfFalsePos = -1;
        let firstEndPos = -1;
        let firstConditionalOperatorNo = '';
        for (let i = 0; i < stmts.length; i++) {
            const stmt = stmts[i];
            if (stmt instanceof ArkIRTransformer_1.DummyStmt) {
                if (stmt.toString().startsWith(ArkIRTransformer_1.ArkIRTransformer.DUMMY_CONDITIONAL_OPERATOR_IF_TRUE_STMT) && firstIfTruePos === -1) {
                    firstIfTruePos = i;
                    firstConditionalOperatorNo = stmt.toString().replace(ArkIRTransformer_1.ArkIRTransformer.DUMMY_CONDITIONAL_OPERATOR_IF_TRUE_STMT, '');
                }
                else if (stmt.toString() === ArkIRTransformer_1.ArkIRTransformer.DUMMY_CONDITIONAL_OPERATOR_IF_FALSE_STMT + firstConditionalOperatorNo) {
                    firstIfFalsePos = i;
                }
                else if (stmt.toString() === ArkIRTransformer_1.ArkIRTransformer.DUMMY_CONDITIONAL_OPERATOR_END_STMT + firstConditionalOperatorNo) {
                    firstEndPos = i;
                }
            }
        }
        return { firstIfTruePos, firstIfFalsePos, firstEndPos };
    }
    removeUnnecessaryBlocksInConditionalOperator(bottomBlock, allBlocks) {
        const firstStmtInBottom = bottomBlock.getHead();
        if (!(firstStmtInBottom instanceof Stmt_1.ArkAssignStmt)) {
            return [bottomBlock];
        }
        const targetValue = firstStmtInBottom.getLeftOp();
        const tempResultValue = firstStmtInBottom.getRightOp();
        if (!(targetValue instanceof Local_1.Local && IRUtils_1.IRUtils.isTempLocal(tempResultValue))) {
            return [bottomBlock];
        }
        const oldPredecessors = Array.from(bottomBlock.getPredecessors());
        const newPredecessors = [];
        for (const predecessor of oldPredecessors) {
            predecessor.removeSuccessorBlock(bottomBlock);
            newPredecessors.push(...this.replaceTempRecursively(predecessor, targetValue, tempResultValue, allBlocks));
        }
        bottomBlock.remove(firstStmtInBottom);
        if (bottomBlock.getStmts().length === 0) {
            // must be a new block without successors
            allBlocks.delete(bottomBlock);
            return newPredecessors;
        }
        oldPredecessors.forEach(oldPredecessor => {
            bottomBlock.removePredecessorBlock(oldPredecessor);
        });
        newPredecessors.forEach(newPredecessor => {
            bottomBlock.addPredecessorBlock(newPredecessor);
            newPredecessor.addSuccessorBlock(bottomBlock);
        });
        return [bottomBlock];
    }
    replaceTempRecursively(currBottomBlock, targetLocal, tempResultLocal, allBlocks) {
        const stmts = currBottomBlock.getStmts();
        const stmtsCnt = stmts.length;
        let tempResultReassignStmt = null;
        for (let i = stmtsCnt - 1; i >= 0; i--) {
            const stmt = stmts[i];
            if (stmt instanceof Stmt_1.ArkAssignStmt && stmt.getLeftOp() === tempResultLocal) {
                if (IRUtils_1.IRUtils.isTempLocal(stmt.getRightOp())) {
                    tempResultReassignStmt = stmt;
                }
                else {
                    stmt.setLeftOp(targetLocal);
                }
            }
        }
        let newBottomBlocks = [];
        if (tempResultReassignStmt) {
            const oldPredecessors = currBottomBlock.getPredecessors();
            const newPredecessors = [];
            const prevTempResultLocal = tempResultReassignStmt.getRightOp();
            for (const predecessor of oldPredecessors) {
                predecessor.removeSuccessorBlock(currBottomBlock);
                newPredecessors.push(...this.replaceTempRecursively(predecessor, targetLocal, prevTempResultLocal, allBlocks));
            }
            currBottomBlock.remove(tempResultReassignStmt);
            if (currBottomBlock.getStmts().length === 0) {
                // remove this block
                newBottomBlocks = newPredecessors;
                allBlocks.delete(currBottomBlock);
            }
            else {
                currBottomBlock.getPredecessors().splice(0, oldPredecessors.length, ...newPredecessors);
                newPredecessors.forEach(newPredecessor => {
                    newPredecessor.addSuccessorBlock(currBottomBlock);
                });
                newBottomBlocks = [currBottomBlock];
            }
        }
        else {
            newBottomBlocks = [currBottomBlock];
        }
        return newBottomBlocks;
    }
}
exports.ConditionBuilder = ConditionBuilder;
