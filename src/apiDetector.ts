/**
 * ArkPrism - Layer 2: Privacy API Detection
 * Four-pattern matching for sensitive API calls.
 *
 * Patterns:
 *   1. Direct invoke stmt (callback-based, no return value)
 *   2. Direct invoke after assignment (return value assigned)
 *   3. Indirect invoke (instance method on manager objects)
 *   4. Privacy constants (field access on system namespaces)
 *
 * Architecture borrowed from privacyanalyzer with enhancements:
 *   - Added declaringMethod tracking for call chain building
 *   - Added profilingCategory propagation for multi-source analysis
 *   - Added permission tracking from rule definitions
 */

import {
    Cfg, ArkAssignStmt, ArkInvokeStmt, Local, Value,
    AbstractInvokeExpr, ArkAwaitExpr, ArkInstanceInvokeExpr, ArkMethod, ArkFile, ArkClass, ts
} from './arkanalyzer';
import {
    ImportBasicInfo, PrivacyDataAPI, PrivacyPackageInfo,
    ImportEntryCheckUnit, PrivacyDataApiResult
} from './prototypes';
import { getSystemImportInfoFromArkFile } from './utils';
import { readFileSync } from 'fs';
import * as path from 'path';

const PACKAGE_ALIASES: Record<string, string[]> = JSON.parse(
    readFileSync(path.resolve(__dirname, '..', 'config', 'package_aliases.json'), 'utf8'),
);

function getRulePackagesForImport(importFrom: string | undefined): string[] {
    if (!importFrom) return [];
    return [importFrom, ...(PACKAGE_ALIASES[importFrom] || [])];
}

function namespaceMatchesImport(apiNamespace: string, importInfo: ImportBasicInfo): boolean {
    if (apiNamespace === importInfo.originName) return true;
    if (apiNamespace.toLowerCase() === importInfo.originName.toLowerCase()) return true;
    if (apiNamespace === importInfo.importClauseName) return true;
    if (apiNamespace.toLowerCase() === importInfo.importClauseName.toLowerCase()) return true;

    const importedNames = new Set([importInfo.originName, importInfo.importClauseName]);
    const packageTail = importInfo.importFrom?.split('.').pop();
    if (packageTail?.toLowerCase() === apiNamespace.toLowerCase()) {
        // Legacy @ohos modules commonly expose one default namespace. The
        // source-level local name may be arbitrary (for example,
        // `import info from '@ohos.deviceInfo'`).
        return true;
    }

    if (importInfo.importFrom === '@ohos.distributedDeviceManager' &&
        importedNames.has('deviceManager')) {
        return apiNamespace === 'DeviceManager' || apiNamespace === 'distributedDeviceManager';
    }

    if ((importInfo.importFrom === '@ohos.geoLocationManager' || importInfo.importFrom === '@ohos.geolocation' ||
        importInfo.importFrom === '@kit.LocationKit') &&
        (importedNames.has('geoLocationManager') || importedNames.has('geolocation'))) {
        return apiNamespace === 'geoLocationManager' || apiNamespace === 'geolocation';
    }

    if (importInfo.importFrom === '@ohos.wifiManager') {
        return apiNamespace === 'wifiManager';
    }

    if ((importInfo.importFrom === '@ohos.deviceInfo' || importInfo.importFrom === '@kit.BasicServicesKit') &&
        (importedNames.has('deviceInfo') || importedNames.has('deviceinfo'))) {
        return apiNamespace === 'deviceInfo' || apiNamespace === 'deviceinfo';
    }

    if (importInfo.importFrom === '@ohos.identifier.oaid') {
        return apiNamespace === 'identifier';
    }

    if ((importInfo.importFrom === '@ohos.reminderAgent' ||
        importInfo.importFrom === '@kit.ReminderAgentKit' ||
        importInfo.importFrom === '@kit.BackgroundTasksKit') &&
        importedNames.has('reminderAgentManager')) {
        return apiNamespace === 'reminderAgent';
    }

    return false;
}

function normalizedRuleMethod(method: string | undefined): string {
    if (!method) return "";
    return method
        .replace(/\(\)\s*$/, "")
        .replace(/\s*\(.*/, "")
        .split(".")
        .filter(Boolean)
        .pop() || method;
}

function methodMatches(api: PrivacyDataAPI, invokeMethodName: string | undefined, stmtText: string): boolean {
    if (!invokeMethodName) return false;
    if (api.method === invokeMethodName) return true;

    const normalized = normalizedRuleMethod(api.method);
    if (normalized !== invokeMethodName) return false;

    if (api.method.includes(".")) return true;

    if (api.method.includes("(")) {
        const argMatch = api.method.match(/['"]([^'"]+)['"]/);
        if (!argMatch) return true;
        const expected = argMatch[1];
        const expectedTail = expected.split(".").pop() || expected;
        return stmtText.includes(`'${expected}'`) || stmtText.includes(`"${expected}"`) ||
            stmtText.includes(expected) || stmtText.includes(expectedTail);
    }

    return false;
}

function stmtHasNamespaceCaller(namespaceName: string, stmtText: string): boolean {
    const escaped = namespaceName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`\\b(?:instanceinvoke|staticinvoke)\\s+${escaped}(?:\\.|\\s*<)`).test(stmtText) ||
        new RegExp(`\\b${escaped}\\s*\\.\\s*<`).test(stmtText) ||
        new RegExp(`\\b${escaped}\\s*\\.\\s*[A-Za-z_$][\\w$]*\\s*\\.\\s*<`).test(stmtText);
}

function findUnitsInStmt(
    units: ImportEntryCheckUnit[],
    uses: Value[],
    stmtText: string,
    preferredUseIndexes: number[] = []
): ImportEntryCheckUnit[] {
    const useNames = new Set<string>();
    if (preferredUseIndexes.length > 0) {
        for (const index of preferredUseIndexes) {
            const value = uses[index]?.toString();
            if (value) useNames.add(value);
        }
    } else {
        for (const value of uses) {
            const text = value?.toString();
            if (text) useNames.add(text);
        }
    }

    return units.filter(unit => {
        if (stmtHasNamespaceCaller(unit.importClauseName, stmtText)) return true;
        return preferredUseIndexes.length === 0 && useNames.has(unit.importClauseName);
    });
}

function findMatchedApi(
    units: ImportEntryCheckUnit[],
    invokeMethodName: string | undefined,
    stmtText: string
): { unit: ImportEntryCheckUnit; api: PrivacyDataAPI } | undefined {
    for (const unit of units) {
        let matchedApi = unit.relatedApis.find(api => api.method === invokeMethodName);
        if (!matchedApi) {
            matchedApi = unit.relatedApis.find(api => methodMatches(api, invokeMethodName, stmtText));
        }
        if (matchedApi) return { unit, api: matchedApi };
    }
    return undefined;
}

function normalizedIdentity(value: string | undefined): string {
    return (value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function identityTokens(value: string | undefined): string[] {
    return (value || '')
        .split(/[^A-Za-z0-9_$]+/)
        .map(token => normalizedIdentity(token))
        .filter(Boolean);
}

function typeIdentityTokens(value: string | undefined): string[] {
    const typeText = value || '';
    const semanticType = typeText.includes(':')
        ? typeText.slice(typeText.lastIndexOf(':') + 1)
        : typeText;
    return identityTokens(semanticType);
}

function apiReceiverIdentities(api: PrivacyDataAPI): Set<string> {
    const identities = new Set([normalizedIdentity(api.namespace)]);
    const methodPrefix = api.method
        .replace(/\s*\(.*/, '')
        .split('.')
        .slice(0, -1);
    for (const token of methodPrefix) {
        const normalized = normalizedIdentity(token);
        if (normalized) identities.add(normalized);
    }
    for (const factory of api.receiverFactories || []) {
        const normalized = normalizedIdentity(factory);
        if (normalized) identities.add(normalized);
    }
    return identities;
}

const GENERIC_INDIRECT_METHODS = new Set([
    'cancel', 'close', 'connect', 'create', 'delete', 'disconnect',
    'get', 'head', 'off', 'on', 'open', 'post', 'put', 'read',
    'request', 'set', 'start', 'stop', 'write',
]);

interface ReceiverDefinitionEvidence {
    units: ImportEntryCheckUnit[];
    identities: string[];
}

type SourceTypeHints = Map<string, Set<string>>;

interface SourceOccurrence {
    member: string;
    accessKind: "call" | "property";
    receiver: string;
    line: number;
    column: number;
    expression: string;
}

function collectSourceTypeHints(file: ArkFile): SourceTypeHints {
    const source = ts.createSourceFile(
        file.getName(),
        file.getCode(),
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.TS,
    );
    const importedTypeAliases = new Map<string, string>();
    const hints: SourceTypeHints = new Map();

    function collectImports(node: any): void {
        if (ts.isImportDeclaration(node)) {
            const bindings = node.importClause?.namedBindings;
            if (bindings && ts.isNamedImports(bindings)) {
                for (const element of bindings.elements) {
                    importedTypeAliases.set(
                        normalizedIdentity(element.name.text),
                        normalizedIdentity(element.propertyName?.text || element.name.text),
                    );
                }
            }
        }
        ts.forEachChild(node, collectImports);
    }

    function recordHint(name: any, typeNode: any): void {
        if (!typeNode || !name || !ts.isIdentifier(name)) return;
        const identities = new Set(identityTokens(typeNode.getText(source)));
        for (const identity of [...identities]) {
            const imported = importedTypeAliases.get(identity);
            if (imported) identities.add(imported);
        }
        if (identities.size > 0) {
            hints.set(normalizedIdentity(name.text), identities);
        }
    }

    function collectDeclarations(node: any): void {
        if (ts.isParameter(node) ||
            ts.isPropertyDeclaration(node) ||
            ts.isPropertySignature(node) ||
            ts.isVariableDeclaration(node)) {
            recordHint(node.name, node.type);
        }
        ts.forEachChild(node, collectDeclarations);
    }

    collectImports(source);
    collectDeclarations(source);
    return hints;
}

function collectSourceOccurrences(file: ArkFile): SourceOccurrence[] {
    const source = ts.createSourceFile(
        file.getName(),
        file.getCode(),
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.TS,
    );
    const occurrences: SourceOccurrence[] = [];

    function visit(node: any): void {
        if (ts.isPropertyAccessExpression(node)) {
            const call = ts.isCallExpression(node.parent) && node.parent.expression === node
                ? node.parent
                : undefined;
            const start = node.name.getStart(source);
            const location = source.getLineAndCharacterOfPosition(start);
            occurrences.push({
                member: node.name.text,
                accessKind: call ? "call" : "property",
                receiver: node.expression.getText(source),
                line: location.line + 1,
                column: location.character + 1,
                expression: (call || node).getText(source),
            });
        }
        ts.forEachChild(node, visit);
    }
    visit(source);
    return occurrences;
}

function recoverSourceLocations(
    file: ArkFile,
    results: PrivacyDataApiResult[],
    importInfos: ImportBasicInfo[],
    sourceTypeHints: SourceTypeHints,
): PrivacyDataApiResult[] {
    const occurrences = collectSourceOccurrences(file);
    const used = new Set<number>();

    function occurrenceScore(result: PrivacyDataApiResult, occurrence: SourceOccurrence): number {
        const receiverText = occurrence.receiver.replace(/\s+/g, '');
        const receiverRoot = receiverText.split(/[.?(\[]/).filter(Boolean)[0] || receiverText;
        const receiverTail = receiverText.split('.').filter(Boolean).pop() || receiverText;
        const receiverIdentities = new Set<string>();
        for (const name of [receiverRoot, receiverTail]) {
            const identity = normalizedIdentity(name.replace(/^this\./, ''));
            if (identity) receiverIdentities.add(identity);
            for (const hinted of sourceTypeHints.get(identity) || []) receiverIdentities.add(hinted);
        }
        const api: PrivacyDataAPI = {
            namespace: result.namespace,
            method: result.method,
            permission: result.permission,
            profilingCategory: result.profilingCategory || '',
            directCall: result.category === "privacy constants" ? null : result.category !== "indirect invoke",
        };
        const expectedIdentities = apiReceiverIdentities(api);
        const relevantImports = importInfos.filter(info => info.importFrom === result.apiPackage);
        const namespaceReceiver = relevantImports.some(info =>
            receiverText === info.importClauseName ||
            receiverText.startsWith(`${info.importClauseName}.`) ||
            receiverText.startsWith(`${info.importClauseName}?.`),
        );
        const typedReceiver = [...receiverIdentities].some(identity => expectedIdentities.has(identity));
        const exactReceiver = expectedIdentities.has(normalizedIdentity(receiverTail));
        const lineDistance = Math.abs(occurrence.line - (result.line || occurrence.line));
        return (namespaceReceiver ? 10000 : 0)
            + (typedReceiver ? 8000 : 0)
            + (exactReceiver ? 6000 : 0)
            - Math.min(lineDistance, 1000);
    }

    const orderedResults = results
        .map((result, index) => ({ result, index }))
        .sort((left, right) =>
            (left.result.line || 0) - (right.result.line || 0) || left.index - right.index,
        );
    for (const { result } of orderedResults) {
        const expectedMember = normalizedRuleMethod(result.method).toLowerCase();
        const expectedAccess = result.category === "privacy constants" ? "property" : "call";
        const candidates = occurrences
            .map((occurrence, index) => ({ occurrence, index }))
            .filter(item =>
                !used.has(item.index) &&
                item.occurrence.accessKind === expectedAccess &&
                item.occurrence.member.toLowerCase() === expectedMember,
            )
            .map(item => ({ ...item, score: occurrenceScore(result, item.occurrence) }))
            .sort((left, right) =>
                right.score - left.score ||
                left.occurrence.line - right.occurrence.line ||
                left.occurrence.column - right.occurrence.column,
            );
        if (candidates.length === 0) continue;
        const best = candidates[0];
        const sameMemberResultCount = results.filter(other =>
            (other.category === "privacy constants" ? "property" : "call") === expectedAccess &&
            normalizedRuleMethod(other.method).toLowerCase() === expectedMember,
        ).length;
        const sameMemberOccurrenceCount = occurrences.filter(occurrence =>
            occurrence.accessKind === expectedAccess &&
            occurrence.member.toLowerCase() === expectedMember,
        ).length;
        if (best.score <= 0 && sameMemberResultCount !== sameMemberOccurrenceCount) continue;
        used.add(best.index);
        result.line = best.occurrence.line;
        result.column = best.occurrence.column;
        result.originalCode = best.occurrence.expression;
        result.locationEvidence = "source_ast";
    }
    return results;
}

function findReceiverDefinitionEvidence(
    cfg: Cfg,
    receiver: Value,
    currentStmt: Value,
    units: ImportEntryCheckUnit[],
    sourceTypeHints: SourceTypeHints,
): ReceiverDefinitionEvidence {
    const statements = [...cfg.getBlocks()].flatMap(block => block.getStmts());
    const currentIndex = statements.indexOf(currentStmt as any);
    const limit = currentIndex >= 0 ? currentIndex : statements.length;
    const visited = new Set<string>();
    const visitedDefinitions = new Set<ArkAssignStmt>();
    const matchedUnits = new Set<ImportEntryCheckUnit>();
    const identities = new Set<string>();

    function addIdentity(value: Value | undefined): void {
        if (!value) return;
        for (const token of identityTokens(value.toString())) {
            identities.add(token);
            for (const hintedType of sourceTypeHints.get(token) || []) {
                identities.add(hintedType);
            }
        }
        for (const token of typeIdentityTokens(value.getType().getTypeString())) {
            if (token !== 'unknown') identities.add(token);
        }
    }

    function inspectDefinition(definition: ArkAssignStmt, depth: number): void {
        if (depth > 8 || visitedDefinitions.has(definition)) return;
        visitedDefinitions.add(definition);

        addIdentity(definition.getLeftOp());
        addIdentity(definition.getRightOp());
        const definitionText = definition.toString();
        const namespaceUnits = findUnitsInStmt(units, definition.getUses(), definitionText);
        for (const unit of namespaceUnits) matchedUnits.add(unit);

        const definingInvoke = definition.getInvokeExpr();
        if (definingInvoke instanceof ArkInstanceInvokeExpr) {
            traceValue(definingInvoke.getBase(), depth + 1);
        }

        const right = definition.getRightOp();
        if (right instanceof ArkAwaitExpr) {
            traceValue(right.getPromise(), depth + 1);
        }
        const rightName = right.toString();
        if (/^[A-Za-z_$%][\w$%.]*$/.test(rightName)) {
            trace(rightName, depth + 1);
        }
    }

    function traceValue(value: Value, depth: number): void {
        if (depth > 8) return;
        addIdentity(value);
        if (value instanceof Local) {
            const declaringStmt = value.getDeclaringStmt();
            if (declaringStmt instanceof ArkAssignStmt) {
                inspectDefinition(declaringStmt, depth);
            }
        }
        trace(value.toString(), depth);
    }

    function trace(valueName: string, depth: number): void {
        if (depth > 8 || visited.has(valueName)) return;
        visited.add(valueName);
        for (const token of identityTokens(valueName)) identities.add(token);
        for (let index = limit - 1; index >= 0; index--) {
            const definition = statements[index];
            if (!(definition instanceof ArkAssignStmt)) continue;
            if (definition.getLeftOp().toString() !== valueName) continue;
            inspectDefinition(definition, depth);
        }
    }

    traceValue(receiver, 0);
    return {
        units: [...matchedUnits],
        identities: [...identities],
    };
}

function resolveIndirectMatch(
    cfg: Cfg,
    stmt: any,
    invokeExpr: AbstractInvokeExpr,
    units: ImportEntryCheckUnit[],
    invokeMethodName: string,
    stmtText: string,
    sourceTypeHints: SourceTypeHints,
): { unit: ImportEntryCheckUnit; api: PrivacyDataAPI; evidence: PrivacyDataApiResult["matchEvidence"] } | undefined {
    const candidates = units.flatMap(unit => unit.relatedApis
        .filter(api => methodMatches(api, invokeMethodName, stmtText))
        .map(api => ({ unit, api })));
    if (candidates.length === 0) return undefined;

    const receiver = invokeExpr instanceof ArkInstanceInvokeExpr ? invokeExpr.getBase() : undefined;
    if (receiver) {
        const receiverName = normalizedIdentity(receiver.toString());
        const receiverTypes = new Set(typeIdentityTokens(receiver.getType().getTypeString()));
        const typeMatch = candidates.find(item => {
            return [...apiReceiverIdentities(item.api)]
                .some(identity => receiverTypes.has(identity));
        });
        if (typeMatch) return { ...typeMatch, evidence: "receiver_type" };

        const targetClass = normalizedIdentity(
            invokeExpr.getMethodSignature().getDeclaringClassSignature().getClassName()
        );
        const targetMatch = candidates.find(item => {
            return targetClass.length > 0
                && targetClass !== 'unk'
                && apiReceiverIdentities(item.api).has(targetClass);
        });
        if (targetMatch) return { ...targetMatch, evidence: "target_signature" };

        const definitionEvidence = findReceiverDefinitionEvidence(
            cfg,
            receiver,
            stmt,
            candidates.map(item => item.unit),
            sourceTypeHints,
        );
        const originUnits = new Set(definitionEvidence.units);
        const originCandidates = candidates.filter(item => originUnits.has(item.unit));
        const originTargets = new Set(originCandidates.map(item =>
            `${normalizedIdentity(item.api.namespace)}|${normalizedRuleMethod(item.api.method).toLowerCase()}`
        ));
        if (originTargets.size === 1 && originCandidates.length > 0) {
            return { ...originCandidates[0], evidence: "receiver_origin" };
        }

        const definitionMatch = candidates.find(item => {
            const identities = apiReceiverIdentities(item.api);
            return definitionEvidence.identities.some(identity => identities.has(identity));
        });
        if (definitionMatch) return { ...definitionMatch, evidence: "receiver_type" };

        const genericMethod = GENERIC_INDIRECT_METHODS.has(invokeMethodName.toLowerCase());
        if (!genericMethod) {
            const namespaceMatch = candidates.find(item => {
                const identities = apiReceiverIdentities(item.api);
                return receiverName === normalizedIdentity(item.unit.importClauseName)
                    || identities.has(receiverName);
            });
            if (namespaceMatch) return { ...namespaceMatch, evidence: "namespace" };
        }
    }

    return undefined;
}

/**
 * Check for direct call privacy APIs.
 * Handles both: (a) assignment stmts with invoke, and (b) pure invoke stmts.
 *
 * Examples:
 *   (a) let net = connection.getDefaultNet();  // direct invoke after assignment
 *   (b) identifier.getOAID(callback);          // direct invoke stmt
 */
function checkDirectCallPrivacyApis(
    cfg: Cfg | undefined,
    directCallCheckUnits: ImportEntryCheckUnit[],
    filename: string,
    declaringMethod: string
): PrivacyDataApiResult[] {
    if (cfg === undefined) return [];
    let blocks = cfg.getBlocks();
    let results: PrivacyDataApiResult[] = [];
    let namespaceMemberAliases = new Map<string, ImportEntryCheckUnit[]>();

    for (let block of blocks) {
        for (let stmt of block.getStmts()) {
            if (!(stmt instanceof ArkAssignStmt) || stmt.containsInvokeExpr()) continue;
            const assignText = stmt.toString();
            for (const unit of directCallCheckUnits) {
                const escaped = unit.importClauseName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
                const memberMatch = assignText.match(new RegExp(`\\b${escaped}\\s*\\.\\s*<[^>]*\\.\\s*([A-Za-z_$][\\w$]*)>`));
                const memberName = memberMatch?.[1];
                if (!memberName) continue;
                if (unit.relatedApis.some(api => api.method.startsWith(`${memberName}.`))) {
                    namespaceMemberAliases.set(stmt.getLeftOp().toString(), [unit]);
                }
            }
        }
    }

    for (let block of blocks) {
        let stmts = block.getStmts();
        for (let stmt of stmts) {
            // Pattern 2: direct invoke after assignment
            if (stmt instanceof ArkAssignStmt) {
                const assignText = stmt.toString();
                if (stmt.containsFieldRef()) {
                    const fieldName = stmt.getFieldRef()?.getFieldName();
                    const namespaceName = stmt.getUses().length > 1 ? stmt.getUses()[1].toString() : undefined;
                    if (fieldName && namespaceName) {
                        const aliasUnits = directCallCheckUnits.filter(unit =>
                            unit.importClauseName === namespaceName &&
                            unit.relatedApis.some(api => api.method.startsWith(`${fieldName}.`))
                        );
                        if (aliasUnits.length > 0) {
                            namespaceMemberAliases.set(stmt.getLeftOp().toString(), aliasUnits);
                        }
                    }
                } else if (!stmt.containsInvokeExpr()) {
                    for (const unit of directCallCheckUnits) {
                        const escaped = unit.importClauseName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
                        const memberMatch = assignText.match(new RegExp(`\\b${escaped}\\s*\\.\\s*<[^>]*\\.\\s*([A-Za-z_$][\\w$]*)>`));
                        const memberName = memberMatch?.[1];
                        if (!memberName) continue;
                        const aliasUnits = unit.relatedApis.some(api => api.method.startsWith(`${memberName}.`))
                            ? [unit]
                            : [];
                        if (aliasUnits.length > 0) {
                            namespaceMemberAliases.set(stmt.getLeftOp().toString(), aliasUnits);
                        }
                    }
                }

                if (stmt.containsInvokeExpr()) {
                    let rightOp: Value = stmt.getRightOp();
                    let invokeExpr: AbstractInvokeExpr | undefined = stmt.getInvokeExpr();
                    let invokeMethodName: string | undefined = invokeExpr?.getMethodSignature().getMethodSubSignature().getMethodName();
                    let rightOpUses: Value[] = rightOp.getUses();
                    let stmtUses: Value[] = stmt.getUses();
                    let stmtText = stmt.toString();

                    let namespacesInStmt = findUnitsInStmt(directCallCheckUnits, stmtUses.length > 0 ? stmtUses : rightOpUses, stmtText, [1]);
                    const invokeCaller = stmtUses.length > 1 ? stmtUses[1]?.toString() : rightOpUses[1]?.toString();
                    if (invokeCaller && namespaceMemberAliases.has(invokeCaller)) {
                        namespacesInStmt = namespacesInStmt.concat(namespaceMemberAliases.get(invokeCaller) || []);
                    }
                    let match = findMatchedApi(namespacesInStmt, invokeMethodName, stmtText);
                    if (match) {
                            results.push({
                                category: "direct invoke stmt after assignment",
                                apiPackage: match.unit.systemPackage,
                                namespace: match.api.namespace,
                                method: match.api.method,
                                args: invokeExpr?.getArgs().map(arg => arg.toString()) || [],
                                code: stmt.toString(),
                                file: filename,
                                line: stmt.getOriginPositionInfo()?.getLineNo() || 0,
                                declaringMethod: declaringMethod,
                                permission: match.api.permission,
                                profilingCategory: match.api.profilingCategory
                            });
                    }
                }
            }
            // Pattern 1: direct invoke stmt (no assignment)
            else if (stmt instanceof ArkInvokeStmt) {
                let stmtUses: Value[] = stmt.getUses();
                let invokeExpr: AbstractInvokeExpr = stmt.getInvokeExpr();
                let invokeMethodName: string | undefined = invokeExpr.getMethodSignature().getMethodSubSignature().getMethodName();
                let stmtText = stmt.toString();

                let namespacesInStmt = findUnitsInStmt(directCallCheckUnits, stmtUses, stmtText, [1]);
                const invokeCaller = stmtUses.length > 1 ? stmtUses[1]?.toString() : undefined;
                if (invokeCaller && namespaceMemberAliases.has(invokeCaller)) {
                    namespacesInStmt = namespacesInStmt.concat(namespaceMemberAliases.get(invokeCaller) || []);
                }
                let match = findMatchedApi(namespacesInStmt, invokeMethodName, stmtText);
                if (match) {
                        results.push({
                            category: "direct invoke stmt",
                            apiPackage: match.unit.systemPackage,
                            namespace: match.api.namespace,
                            method: match.api.method,
                            args: invokeExpr.getArgs().map(arg => arg.toString()),
                            code: stmt.toString(),
                            file: filename,
                            line: stmt.getOriginPositionInfo()?.getLineNo() || 0,
                            declaringMethod: declaringMethod,
                            permission: match.api.permission,
                            profilingCategory: match.api.profilingCategory
                        });
                }
            }
        }
    }
    return results;
}

/**
 * Check for indirect call privacy APIs.
 * These are APIs called on manager/instance objects obtained from a namespace.
 *
 * Example:
 *   let mgr = pasteboard.getSystemPasteboard();
 *   let data = mgr.getData();  // indirect invoke
 */
function checkIndirectCallPrivacyApis(
    cfg: Cfg | undefined,
    indirectCallCheckUnits: ImportEntryCheckUnit[],
    filename: string,
    declaringMethod: string,
    sourceTypeHints: SourceTypeHints,
): PrivacyDataApiResult[] {
    if (cfg === undefined) return [];
    let blocks = cfg.getBlocks();
    let results: PrivacyDataApiResult[] = [];

    for (let block of blocks) {
        let stmts = block.getStmts();
        for (let stmt of stmts) {
            if (stmt.containsInvokeExpr()) {
                let invokeExpr: AbstractInvokeExpr | undefined = stmt.getInvokeExpr();
                let invokeMethodName: string | undefined = invokeExpr?.getMethodSignature().getMethodSubSignature().getMethodName();
                let stmtText = stmt.toString();
                if (invokeExpr && invokeMethodName) {
                    const match = resolveIndirectMatch(
                        cfg,
                        stmt,
                        invokeExpr,
                        indirectCallCheckUnits,
                        invokeMethodName,
                        stmtText,
                        sourceTypeHints,
                    );
                    if (match) {
                        // For indirect calls, method is just the method name (namespace is separate)
                        results.push({
                            category: "indirect invoke",
                            apiPackage: match.unit.systemPackage,
                            namespace: match.api.namespace,
                            method: match.api.method,
                            args: invokeExpr?.getArgs().map(arg => arg.toString()) || [],
                            code: stmt.toString(),
                            file: filename,
                            line: stmt.getOriginPositionInfo()?.getLineNo() || 0,
                            declaringMethod: declaringMethod,
                            permission: match.api.permission,
                            profilingCategory: match.api.profilingCategory,
                            matchEvidence: match.evidence,
                        });
                    }
                }
            }
        }
    }
    return results;
}

/**
 * Check for privacy constant usages.
 * These are system-level constants accessed as fields on namespace objects.
 *
 * Example:
 *   let brand = deviceInfo.brand;  // privacy constant
 */
function checkPrivacyConstantUsages(
    cfg: Cfg | undefined,
    constantCheckUnits: ImportEntryCheckUnit[],
    filename: string,
    declaringMethod: string
): PrivacyDataApiResult[] {
    if (cfg === undefined) return [];
    let blocks = cfg.getBlocks();
    let results: PrivacyDataApiResult[] = [];

    for (let block of blocks) {
        let stmts = block.getStmts();
        for (let stmt of stmts) {
            if (stmt.containsFieldRef()) {
                let fieldName: string | undefined = stmt.getFieldRef()?.getFieldName();
                let namespaceName: string | undefined = stmt.getUses().length > 1 ? stmt.getUses()[1].toString() : undefined;
                let stmtText = stmt.toString();

                let namespacesInStmt = namespaceName
                    ? constantCheckUnits.filter(unit => unit.importClauseName === namespaceName)
                    : findUnitsInStmt(constantCheckUnits, stmt.getUses(), stmtText, [1]);

                if (namespacesInStmt.length > 0) {
                    let match = findMatchedApi(namespacesInStmt, fieldName, stmtText);
                    if (match) {
                        results.push({
                            category: "privacy constants",
                            apiPackage: match.unit.systemPackage,
                            namespace: match.api.namespace,
                            method: match.api.method,
                            args: [],
                            code: stmt.toString(),
                            file: filename,
                            line: stmt.getOriginPositionInfo()?.getLineNo() || 0,
                            declaringMethod: declaringMethod,
                            permission: match.api.permission,
                            profilingCategory: match.api.profilingCategory
                        });
                    }
                }
            }
        }
    }
    return results;
}

function privacyApiOccurrenceKey(result: PrivacyDataApiResult): string {
    const normalized = (value: string | undefined): string =>
        (value || "").replace(/\\/g, "/").trim().toLowerCase();
    return JSON.stringify([
        normalized(result.apiPackage),
        normalized(result.namespace),
        normalized(result.method),
        normalized(result.file),
        normalized(result.declaringMethod),
        result.code.trim(),
    ]);
}

function matchEvidenceStrength(result: PrivacyDataApiResult): number {
    switch (result.matchEvidence) {
        case "receiver_origin":
            return 2;
        case "target_signature":
            return 3;
        case "receiver_type":
            return 4;
        case "namespace":
            return 1;
        default:
            // Direct namespace calls and constant reads do not need an
            // auxiliary receiver-evidence tag.
            return 5;
    }
}

/**
 * Collapse overlapping rule matches that identify the same source-level API
 * occurrence. Duplicate configuration entries and package aliases may route a
 * statement through more than one recognition pattern; downstream call-chain
 * and sink analysis must receive one canonical usage per call site.
 */
export function deduplicatePrivacyApiResults(
    results: PrivacyDataApiResult[],
): PrivacyDataApiResult[] {
    const uniqueResults = new Map<string, PrivacyDataApiResult>();
    for (const result of results) {
        const key = privacyApiOccurrenceKey(result);
        const current = uniqueResults.get(key);
        if (!current || matchEvidenceStrength(result) > matchEvidenceStrength(current)) {
            uniqueResults.set(key, result);
        }
    }
    return Array.from(uniqueResults.values());
}

/**
 * Analyze a single ArkFile for all privacy API usages.
 * Builds ImportEntryCheckUnits and runs all four detection patterns.
 */
export function analyzeFileForPrivacyApis(
    file: ArkFile,
    systemPackages: string[],
    privacyPackageInfos: PrivacyPackageInfo[]
): PrivacyDataApiResult[] {
    let results: PrivacyDataApiResult[] = [];
    let classes: ArkClass[] = file.getClasses();
    const acceptedImportPackages = new Set<string>();
    for (const systemPackage of systemPackages) {
        acceptedImportPackages.add(systemPackage);
        for (const alias of PACKAGE_ALIASES[systemPackage] || []) {
            acceptedImportPackages.add(alias);
        }
    }
    let systemImportInfos: ImportBasicInfo[] = getSystemImportInfoFromArkFile(
        file,
        Array.from(acceptedImportPackages),
    );
    const sourceTypeHints = collectSourceTypeHints(file);

    // Build check units by category
    let directCallCheckUnits: ImportEntryCheckUnit[] = [];
    let indirectCallCheckUnits: ImportEntryCheckUnit[] = [];
    let privacyConstantsCheckUnits: ImportEntryCheckUnit[] = [];

    for (let importInfo of systemImportInfos) {
        let directCallApis: PrivacyDataAPI[] = [];
        let indirectCallApis: PrivacyDataAPI[] = [];
        let privacyConstants: PrivacyDataAPI[] = [];
        const rulePackages = getRulePackagesForImport(importInfo.importFrom);
        let relatedPackages: PrivacyPackageInfo[] = privacyPackageInfos.filter(
            pkg => rulePackages.includes(pkg.systemPackage)
        );

        for (let pkg of relatedPackages) {
            for (const api of pkg.privacyApis) {
                const directNamespaceMatch = namespaceMatchesImport(api.namespace, importInfo);
                if (api.directCall === true && directNamespaceMatch) {
                    directCallApis.push(api);
                }
                if (api.directCall === false || (api.directCall === true && (api.receiverFactories?.length || 0) > 0)) {
                    // Manager/helper APIs are invoked on objects whose type is
                    // different from the imported namespace alias. Retain the
                    // package-scoped candidate and let receiver evidence
                    // resolve the semantic namespace at the call site.
                    indirectCallApis.push(api);
                }
                if (api.directCall === null && directNamespaceMatch) privacyConstants.push(api);
            }
        }

        const makeUnit = (apis: PrivacyDataAPI[]): ImportEntryCheckUnit => ({
            systemPackage: importInfo.importFrom || "",
            importSystemNamespace: importInfo.originName,
            importClauseName: importInfo.importClauseName,
            relatedApis: apis
        });

        const namespaceDirectApis = indirectCallApis.filter(api => {
            const normalizedMethod = normalizedRuleMethod(api.method);
            return normalizedMethod !== api.method && api.method.startsWith(`${api.namespace}.`);
        });
        if (namespaceDirectApis.length > 0) {
            directCallApis = directCallApis.concat(namespaceDirectApis);
        }

        if (directCallApis.length > 0) directCallCheckUnits.push(makeUnit(directCallApis));
        if (indirectCallApis.length > 0) indirectCallCheckUnits.push(makeUnit(indirectCallApis));
        if (privacyConstants.length > 0) privacyConstantsCheckUnits.push(makeUnit(privacyConstants));
    }

    // Run detection on each method in each class
    for (const clazz of classes) {
        let methods: ArkMethod[] = clazz.getMethods(true);
        for (let method of methods) {
            let body = method.getBody();
            let cfg = body?.getCfg();
            let methodSig = method.getSignature().toString();

            // Pattern 1 & 2: direct calls
            results = results.concat(
                checkDirectCallPrivacyApis(cfg, directCallCheckUnits, file.getName(), methodSig)
            );

            // Pattern 3: indirect calls
            results = results.concat(
                checkIndirectCallPrivacyApis(
                    cfg,
                    indirectCallCheckUnits,
                    file.getName(),
                    methodSig,
                    sourceTypeHints,
                )
            );

            // Pattern 4: privacy constants
            results = results.concat(
                checkPrivacyConstantUsages(cfg, privacyConstantsCheckUnits, file.getName(), methodSig)
            );
        }
    }

    return recoverSourceLocations(
        file,
        deduplicatePrivacyApiResults(results),
        systemImportInfos,
        sourceTypeHints,
    );
}
