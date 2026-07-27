import { Stmt } from "../arkanalyzer";
import { Value } from "../arkanalyzer";
import type { SourceKind, SourceRuleMetadata } from "./Source";

export interface TaintSourceEvidence {
    identityKey: string;
    statement: Stmt;
    sourceKind: SourceKind;
    sourceType: string;
    sourceIndex: number;
    callbackIndex: number;
    methodSignature: string;
    rule: SourceRuleMetadata;
}

export class TaintFact {
    private static statementIds: WeakMap<object, number> = new WeakMap();
    private static nextStatementId: number = 1;
    private value: Value;
    private path: Stmt[] = [];
    private last: TaintFact | null = null;
    private sourceEvidence?: TaintSourceEvidence;

    constructor(value: Value, stmts?: Stmt[], sourceEvidence?: TaintSourceEvidence) {
        this.value = value;
        if (stmts) {
            this.path = [...stmts];
        }
        this.sourceEvidence = sourceEvidence;
    }

    public static createSourceEvidence(
        statement: Stmt,
        sourceKind: SourceKind,
        sourceType: string,
        methodSignature: string,
        rule: SourceRuleMetadata,
        sourceIndex: number = -1,
        callbackIndex: number = -1
    ): TaintSourceEvidence {
        let statementId = this.statementIds.get(statement);
        if (statementId === undefined) {
            statementId = this.nextStatementId++;
            this.statementIds.set(statement, statementId);
        }
        const invokedMethod = statement
            .getInvokeExpr?.()
            ?.getMethodSignature?.()
            ?.toString?.() || statement.toString();
        const carrierKey = `${sourceType}:${sourceIndex}:${callbackIndex}`;
        const identityKey = sourceKind === 'framework_input'
            ? `${sourceKind}|${methodSignature}|${invokedMethod}|${carrierKey}`
            : `${sourceKind}|${methodSignature}|stmt:${statementId}|${carrierKey}`;
        return {
            identityKey,
            statement,
            sourceKind,
            sourceType,
            sourceIndex,
            callbackIndex,
            methodSignature,
            rule: { ...rule }
        };
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

    public getSourceEvidence(): TaintSourceEvidence | undefined {
        return this.sourceEvidence;
    }

    public getSourceIdentityKey(): string {
        return this.sourceEvidence?.identityKey || 'unseeded';
    }

    public hasSameSource(other: TaintFact): boolean {
        return this.getSourceIdentityKey() === other.getSourceIdentityKey();
    }

    public copyForValue(value: Value, nextStmt?: Stmt): TaintFact {
        const copy = new TaintFact(value, this.path, this.sourceEvidence);
        if (nextStmt) copy.addPath(nextStmt);
        return copy;
    }

    public setLast(fact: TaintFact | null) {
        this.last = fact;
    }

    public getLast(): TaintFact | null {
        return this.last;
    }
}
