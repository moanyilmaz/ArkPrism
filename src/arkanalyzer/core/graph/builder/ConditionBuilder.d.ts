import { BasicBlock } from '../BasicBlock';
/**
 * Builder for condition in CFG
 */
export declare class ConditionBuilder {
    rebuildBlocksContainConditionalOperator(basicBlockSet: Set<BasicBlock>, isArkUIBuilder: boolean): void;
    private relinkPrevAndSuccOfBlockContainConditionalOperator;
    private generateBlocksContainConditionalOperatorGroup;
    private generateBlocksContainSingleConditionalOperator;
    private generateBlockWithoutConditionalOperator;
    private deleteDummyConditionalOperatorStmt;
    private findFirstConditionalOperator;
    private removeUnnecessaryBlocksInConditionalOperator;
    private replaceTempRecursively;
}
//# sourceMappingURL=ConditionBuilder.d.ts.map