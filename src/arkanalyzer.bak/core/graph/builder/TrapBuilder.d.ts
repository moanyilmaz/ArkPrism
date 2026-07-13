import { BasicBlock } from '../BasicBlock';
import { ArkIRTransformer } from '../../common/ArkIRTransformer';
import { Trap } from '../../base/Trap';
import { BlockBuilder } from './CfgBuilder';
/**
 * Builder for traps from try...catch
 */
export declare class TrapBuilder {
    buildTraps(blockBuilderToCfgBlock: Map<BlockBuilder, BasicBlock>, blockBuildersBeforeTry: Set<BlockBuilder>, arkIRTransformer: ArkIRTransformer, basicBlockSet: Set<BasicBlock>): Trap[];
    private buildTrapsIfNoFinally;
    private buildTrapsIfFinallyExist;
    private getAllBlocksBFS;
    private copyFinallyBlocks;
    private copyBlocks;
    private copyStmt;
}
//# sourceMappingURL=TrapBuilder.d.ts.map