import { IPtsCollection, PtsCollectionType } from './PtsDS';
import { NodeID } from '../../core/graph/BaseExplicitGraph';
export declare class PointerAnalysisConfig {
    private static instance;
    kLimit: number;
    outputDirectory: string;
    detectTypeDiff: boolean;
    dotDump: boolean;
    unhandledFuncDump: boolean;
    ptsCollectionType: PtsCollectionType;
    ptsCollectionCtor: new () => IPtsCollection<NodeID>;
    constructor(kLimit: number, outputDirectory: string, detectTypeDiff?: boolean, dotDump?: boolean, unhandledFuncDump?: boolean, ptsCoType?: PtsCollectionType);
    static create(kLimit: number, outputDirectory: string, detectTypeDiff?: boolean, dotDump?: boolean, unhandledFuncDump?: boolean, ptsCoType?: PtsCollectionType): PointerAnalysisConfig;
    static getInstance(): PointerAnalysisConfig;
}
//# sourceMappingURL=PointerAnalysisConfig.d.ts.map