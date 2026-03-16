import { MethodSignature } from "../arkanalyzer";

export class Source {
    methodSignature: MethodSignature;
    sourceType: string;
    sourceIndex: number;
    callbackIndex: number;
    constructor(methodSignature: MethodSignature, sourceType: string, sourceIndex: number, callbackIndex: number) {
        this.methodSignature = methodSignature;
        this.sourceType = sourceType;
        this.sourceIndex = sourceIndex;
        this.callbackIndex = callbackIndex;
    }
}
