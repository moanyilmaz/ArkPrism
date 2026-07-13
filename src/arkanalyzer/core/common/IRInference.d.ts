import { ArkMethod } from '../model/ArkMethod';
import { ClassType, Type } from '../base/Type';
import { Local } from '../base/Local';
import { AbstractExpr, AbstractInvokeExpr, AliasTypeExpr, ArkInstanceInvokeExpr, ArkStaticInvokeExpr } from '../base/Expr';
import { Scene } from '../../Scene';
import { ArkClass } from '../model/ArkClass';
import { ClassSignature, MethodSignature } from '../model/ArkSignature';
import { AbstractRef, ArkInstanceFieldRef, ArkParameterRef } from '../base/Ref';
import { ArkFile } from '../model/ArkFile';
import { KeyofTypeExpr, TypeQueryExpr } from '../base/TypeExpr';
export declare class IRInference {
    private static inferExportInfos;
    private static inferImportInfos;
    static inferFile(file: ArkFile): void;
    static inferStaticInvokeExpr(expr: ArkStaticInvokeExpr, arkMethod: ArkMethod): AbstractInvokeExpr;
    private static inferStaticInvokeExprByMethodName;
    static inferInstanceInvokeExpr(expr: ArkInstanceInvokeExpr, arkMethod: ArkMethod): AbstractInvokeExpr;
    /**
     * process arkUI function with Annotation @Extend @Styles @AnimatableExtend
     * @param expr
     * @param arkMethod
     * @param methodName
     */
    private static processExtendFunc;
    static inferFieldRef(ref: ArkInstanceFieldRef, arkMethod: ArkMethod): AbstractRef;
    private static inferBase;
    static inferThisLocal(arkMethod: ArkMethod): Local | null;
    static inferArgs(expr: AbstractInvokeExpr, arkMethod: ArkMethod): void;
    private static inferArg;
    static inferRightWithSdkType(leftType: Type, rightType: Type, ackClass: ArkClass): void;
    static inferArgTypeWithSdk(sdkType: ClassType, scene: Scene, argType: Type): void;
    private static inferInvokeExpr;
    private static inferInvokeExprWithArray;
    private static inferInvokeExprWithFunction;
    private static inferInvokeExprWithDeclaredClass;
    private static getRealTypes;
    static replaceMethodSignature(init: MethodSignature, declared: MethodSignature): MethodSignature;
    private static processForEach;
    static inferLocal(base: Local, arkMethod: ArkMethod): void;
    private static generateNewFieldSignature;
    private static repairType;
    static inferAnonymousClass(anon: ArkClass | null, declaredSignature: ClassSignature, set?: Set<string>): void;
    private static assignAnonMethod;
    private static assignAnonField;
    static inferAliasTypeExpr(expr: AliasTypeExpr, arkMethod: ArkMethod): AbstractExpr;
    static inferTypeQueryExpr(expr: TypeQueryExpr, arkMethod: ArkMethod): void;
    static inferKeyofTypeExpr(expr: KeyofTypeExpr, arkMethod: ArkMethod): void;
    static inferParameterRef(ref: ArkParameterRef, arkMethod: ArkMethod): AbstractRef;
}
//# sourceMappingURL=IRInference.d.ts.map