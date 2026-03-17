import { Stmt } from "../arkanalyzer";
import { Value } from "../arkanalyzer";

export class TaintFact {
    private value: Value;
    private path: Stmt[] = [];
    private last: TaintFact | null = null;
    constructor(value: Value, stmts?: Stmt[]) {
        this.value = value;
        if (stmts) {
            this.path = stmts;
        }
    }

    public getValue(): Value {
        return this.value;
    }

    public addPath(path: Stmt) {
        this.path.push(path);
    }

    public addPaths(paths: Stmt[]) {
        this.path = this.path.concat(paths);
    }

    public getPath(): Stmt[] {
        return this.path;
    }

    public setLast(fact: TaintFact | null) {
        this.last = fact;
    }

    public getLast(): TaintFact | null {
        return this.last;
    }
}
