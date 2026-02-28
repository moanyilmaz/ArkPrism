import { ArkFile } from '../model/ArkFile';
import { ArkExport } from '../model/ArkExport';
import { ArkMethod } from '../model/ArkMethod';
import { AbstractFieldRef } from '../base/Ref';
export declare class SdkUtils {
    static buildGlobalMap(file: ArkFile, globalMap: Map<string, ArkExport>): void;
    private static loadClass;
    private static loadGlobalLocal;
    private static copyMethod;
    static computeGlobalThis(leftOp: AbstractFieldRef, arkMethod: ArkMethod): void;
}
//# sourceMappingURL=SdkUtils.d.ts.map