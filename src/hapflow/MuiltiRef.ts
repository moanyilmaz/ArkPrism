import { Local, AbstractRef, Value, FieldSignature } from "../arkanalyzer";
import { Type } from "../arkanalyzer";

// Normal Edge不用管，可以通过别名分析处理函数内的多次调用，主要用于处理跨函数的问题
export class MultiRef extends AbstractRef {
    private base: Local;
    private fieldSignatures: FieldSignature[];
    constructor(base: Local, fields: FieldSignature[]) {
        super();
        this.base = base;
        this.fieldSignatures = fields;
    }

    public getType(): Type {
        return this.fieldSignatures[this.fieldSignatures.length - 1].getType();
    }

    public getUses(): Value[] {
        let uses: Value[] = [];
        uses.push(this.base);
        uses.push(...this.base.getUses());
        return uses;
    }

    public getFieldSignatures(): FieldSignature[] {
        return this.fieldSignatures;
    }

    public getBase(): Local {
        return this.base;
    }
}
