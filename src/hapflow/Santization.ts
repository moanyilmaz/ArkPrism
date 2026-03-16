import { ArkMethod } from "../arkanalyzer";

export class Santization {
    method: ArkMethod;
    paramIndex: number[];
    constructor(method: ArkMethod, params: number[]) {
        this.method = method;
        this.paramIndex = params;
    }
}
