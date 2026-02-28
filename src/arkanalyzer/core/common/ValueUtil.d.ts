import { Constant, StringConstant } from '../base/Constant';
export declare const EMPTY_STRING = "";
export declare class ValueUtil {
    private static readonly NumberConstantCache;
    static readonly EMPTY_STRING_CONSTANT: StringConstant;
    static getOrCreateNumberConst(n: number): Constant;
    static createStringConst(str: string): Constant;
    static createConst(str: string): Constant;
    static getUndefinedConst(): Constant;
    static getNullConstant(): Constant;
    static getBooleanConstant(value: boolean): Constant;
}
//# sourceMappingURL=ValueUtil.d.ts.map