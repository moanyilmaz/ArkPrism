import { ClassSignature, FieldSignature, MethodSignature } from '../../core/model/ArkSignature';
export declare function IsCollectionClass(classSignature: ClassSignature): boolean;
export declare enum BuiltApiType {
    SetAdd = 0,
    MapSet = 1,
    MapGet = 2,
    ArrayPush = 3,
    Foreach = 4,
    FunctionCall = 5,
    FunctionApply = 6,
    FunctionBind = 7,
    NotBuiltIn = 8
}
export declare const ARRAY_FIELD_SIGNATURE: FieldSignature;
export declare const SET_FIELD_SIGNATURE: FieldSignature;
export declare const MAP_FIELD_SIGNATURE: FieldSignature;
export declare function getBuiltInApiType(method: MethodSignature): BuiltApiType;
//# sourceMappingURL=PTAUtils.d.ts.map