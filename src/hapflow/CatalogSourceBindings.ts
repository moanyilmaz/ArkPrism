import ts from 'ohos-typescript';
import {
    Scene, Stmt, Value, ArkAssignStmt, AbstractInvokeExpr, FunctionType, ClosureType,
    ClassSignature, FileSignature, MethodSignature, MethodSubSignature,
} from '../arkanalyzer';
import { PrivacyDataApiResult, PrivacyPackageInfo, SensitiveApiOverload } from '../prototypes';
import { Source } from './Source';
import { getRulePackagesForImport } from '../apiDetector';

export interface CatalogBindingStats {
    detectedUsages: number;
    boundUsages: number;
    propertyUsages: number;
    unresolved: Array<{ file: string; line?: number; api: string; reason: string }>;
}

export interface CatalogSourceBindings {
    values: WeakMap<Value, Source[]>;
    statements: Map<Stmt, Source[]>;
    stats: CatalogBindingStats;
}

interface Carrier {
    kind: 'return' | 'callback';
    callbackIndex: number;
    sourceIndex: number;
    returnType?: string;
}

function hasDataValue(type: ts.TypeNode | undefined): boolean {
    if (!type || [ts.SyntaxKind.VoidKeyword, ts.SyntaxKind.NeverKeyword, ts.SyntaxKind.UndefinedKeyword,
        ts.SyntaxKind.AnyKeyword, ts.SyntaxKind.UnknownKeyword].includes(type.kind)) return false;
    if (ts.isTypeReferenceNode(type) && type.typeName.getText().split('.').pop() === 'Promise') {
        return hasDataValue(type.typeArguments?.[0]);
    }
    return true;
}

function carrierFor(overload: SensitiveApiOverload, invoke: AbstractInvokeExpr): Carrier | undefined {
    const args = invoke.getArgs();
    if (args.length < overload.minArgs || (overload.maxArgs !== null && args.length > overload.maxArgs)) return;
    const start = overload.signature.indexOf('(');
    const file = ts.createSourceFile('carrier.ts', `interface Carrier { read${overload.signature.slice(start)}; }`, ts.ScriptTarget.Latest, true);
    const declaration = file.statements[0];
    if (!declaration || !ts.isInterfaceDeclaration(declaration)) return;
    const method = declaration.members[0];
    if (!method || !ts.isMethodSignature(method)) return;
    // Equal-arity callback and Promise overloads can differ in a primitive argument.
    if (method.parameters.some((parameter, i) => {
        const actual = args[i]?.getType();
        return (actual instanceof FunctionType || actual instanceof ClosureType) && parameter.type &&
            [ts.SyntaxKind.NumberKeyword, ts.SyntaxKind.StringKeyword, ts.SyntaxKind.BooleanKeyword,
                ts.SyntaxKind.BigIntKeyword].includes(parameter.type.kind);
    })) return;
    for (let i = 0; i < method.parameters.length; i++) {
        const type = method.parameters[i].type;
        if (!type || !ts.isTypeReferenceNode(type)) continue;
        const name = type.typeName.getText(file).split('.').pop();
        if (name !== 'Callback' && name !== 'AsyncCallback') continue;
        if (!hasDataValue(type.typeArguments?.[0])) continue;
        const actual = args[i]?.getType();
        if (!(actual instanceof FunctionType) && !(actual instanceof ClosureType)) continue;
        return { kind: 'callback', callbackIndex: i, sourceIndex: name === 'AsyncCallback' ? 1 : 0,
            returnType: method.type?.getText(file) };
    }
    const returnType = method.type;
    if (!hasDataValue(returnType)) return;
    // Callback overloads cannot be reinterpreted as return sources.
    if (method.parameters.some(p => p.type && /(?:Async)?Callback\s*</.test(p.type.getText(file)))) return;
    return { kind: 'return', callbackIndex: -1, sourceIndex: -1, returnType: returnType!.getText(file) };
}

/** Bind accepted occurrences, preserving receiver/event evidence from API recognition. */
export function bindCatalogSources(
    scene: Scene,
    usages: PrivacyDataApiResult[],
    packages: PrivacyPackageInfo[],
): CatalogSourceBindings {
    const values = new WeakMap<Value, Source[]>();
    const statements = new Map<Stmt, Source[]>();
    const stats: CatalogBindingStats = { detectedUsages: usages.length, boundUsages: 0, propertyUsages: 0, unresolved: [] };
    const methods = new Map(scene.getMethods().map(method => [method.getSignature().toString(), method]));
    const rules = packages.flatMap(pkg => pkg.privacyApis.map(api => ({ api, packages: [pkg.systemPackage, ...(api.packageAliases || [])] })));
    for (const usage of usages) {
        const reject = (reason: string) => stats.unresolved.push({ file: usage.file, line: usage.line, api: usage.catalogApiSignature || usage.method, reason });
        const importPackages = getRulePackagesForImport(usage.apiPackage);
        const rule = rules.find(r => r.packages.some(p => importPackages.includes(p))
            && r.api.catalogApiSignature?.toLowerCase() === usage.catalogApiSignature?.toLowerCase()
            && r.api.dataType === usage.dataType && r.api.label === usage.label)?.api;
        if (!rule) { reject('No reviewed catalog rule for the accepted identity'); continue; }
        const method = methods.get(usage.declaringMethod || '');
        const candidates = method?.getCfg() ? [...method.getCfg()!.getBlocks()].flatMap(b => b.getStmts()).filter(s => s.toString() === usage.code) : [];
        if (!candidates.length) { reject('Accepted source statement could not be located in IR'); continue; }
        let bound = false;
        for (const stmt of candidates) {
            const invoke = stmt.getInvokeExpr();
            const property = usage.category === 'privacy constants' && stmt instanceof ArkAssignStmt && !invoke;
            const value = property ? (stmt as ArkAssignStmt).getRightOp() : invoke;
            if (!value) continue;
            const carriers: Carrier[] = property ? [{ kind: 'return', callbackIndex: -1, sourceIndex: -1 }]
                : (rule.overloads || []).map(o => carrierFor(o, invoke!)).filter((c): c is Carrier => !!c);
            const unique = new Map(carriers.map(c => [`${c.kind}:${c.callbackIndex}:${c.sourceIndex}:${/^Promise\s*</.test(c.returnType || '')}`, c]));
            if (unique.size !== 1) continue;
            const carrier = [...unique.values()][0];
            const member = usage.method.split('(')[0].split('.').pop()!;
            const signature = invoke?.getMethodSignature() || new MethodSignature(
                new ClassSignature(usage.namespace, new FileSignature('@reviewedCatalog', usage.apiPackage)),
                new MethodSubSignature(member, [], value.getType()),
            );
            const source = new Source(signature, carrier.kind, carrier.sourceIndex, carrier.callbackIndex, {
                module: usage.apiPackage, namespace: usage.namespace, apiName: member,
                sourceKind: 'privacy_data', ruleOrigin: 'reviewed_catalog_occurrence',
                dataType: usage.dataType, label: usage.label, catalogApiSignature: usage.catalogApiSignature,
                description: usage.description,
                returnType: carrier.returnType,
            });
            const sources = statements.get(stmt) || [];
            if (!sources.some(existing => existing.rule.catalogApiSignature === source.rule.catalogApiSignature
                && existing.rule.dataType === source.rule.dataType && existing.rule.label === source.rule.label
                && existing.sourceType === source.sourceType && existing.sourceIndex === source.sourceIndex
                && existing.callbackIndex === source.callbackIndex)) sources.push(source);
            values.set(value, sources);
            statements.set(stmt, sources);
            bound = true;
        }
        if (bound) {
            stats.boundUsages++;
            if (usage.category === 'privacy constants') stats.propertyUsages++;
        } else reject('No unambiguous value carrier in the reviewed overloads');
    }
    return { values, statements, stats };
}
