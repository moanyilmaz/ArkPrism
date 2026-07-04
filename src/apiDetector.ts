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
    Cfg, ArkAssignStmt, ArkInvokeStmt, Value,
    AbstractInvokeExpr, ArkMethod, ArkFile, ArkClass
} from './arkanalyzer';
import {
    ImportBasicInfo, PrivacyDataAPI, PrivacyPackageInfo,
    ImportEntryCheckUnit, PrivacyDataApiResult
} from './prototypes';
import { getSystemImportInfoFromArkFile } from './utils';

const PACKAGE_ALIASES: Record<string, string[]> = {
    '@ohos.distributedDeviceManager': ['@kit.DistributedServiceKit'],
    '@kit.DistributedServiceKit': ['@ohos.distributedDeviceManager'],
    '@ohos.deviceInfo': ['@kit.BasicServicesKit'],
    '@kit.BasicServicesKit': [
        '@ohos.deviceInfo',
        '@ohos.request',
        '@ohos.pasteboard',
    ],
    '@ohos.multimedia.audio': ['@kit.AudioKit'],
    '@kit.AudioKit': ['@ohos.multimedia.audio'],
    '@ohos.geoLocationManager': ['@kit.LocationKit', '@ohos.geolocation'],
    '@ohos.geolocation': ['@kit.LocationKit', '@ohos.geoLocationManager'],
    '@kit.LocationKit': ['@ohos.geoLocationManager', '@ohos.geolocation'],
    '@ohos.sensor': ['@kit.SensorServiceKit'],
    '@kit.SensorServiceKit': ['@ohos.sensor'],
    '@ohos.wifiManager': ['@kit.ConnectivityKit'],
    '@kit.ConnectivityKit': ['@ohos.wifiManager'],
};

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
    declaringMethod: string
): PrivacyDataApiResult[] {
    if (cfg === undefined) return [];
    let blocks = cfg.getBlocks();
    let results: PrivacyDataApiResult[] = [];

    for (let block of blocks) {
        let stmts = block.getStmts();
        for (let stmt of stmts) {
            if (stmt.containsInvokeExpr()) {
                let stmtUses: Value[] = stmt.getUses();
                let invokeExpr: AbstractInvokeExpr | undefined = stmt.getInvokeExpr();
                let invokeMethodName: string | undefined = invokeExpr?.getMethodSignature().getMethodSubSignature().getMethodName();
                let stmtText = stmt.toString();
                let caller: Value | undefined = stmtUses.length > 1 ? stmtUses[1] : undefined;
                let callerTypeList: string[] | undefined = caller?.getType().getTypeString().split(".");

                let callerNamespace = (Array.isArray(callerTypeList) && callerTypeList.length > 0) ? callerTypeList[0] : undefined;
                let namespacesInCaller: ImportEntryCheckUnit[] = callerNamespace
                    ? indirectCallCheckUnits.filter(unit => unit.importClauseName === callerNamespace)
                    : [];

                // Heuristic fallback: if type inference failed (unknown/empty type) but method name matches
                // an indirect call rule, try to match by method name alone
                // This handles cases where ArkAnalyzer can't infer the return type of SDK helper methods
                if (namespacesInCaller.length === 0 && invokeMethodName) {
                    for (const unit of indirectCallCheckUnits) {
                        const matchedByMethod = unit.relatedApis.find(api => methodMatches(api, invokeMethodName, stmtText));
                        if (matchedByMethod) {
                            namespacesInCaller = [unit];
                            break;
                        }
                    }
                }

                if (namespacesInCaller.length > 0) {
                    // Privacy rules store methods without namespace prefix (e.g., "createAsset", not "photoAccessHelper.createAsset")
                    let match = findMatchedApi(namespacesInCaller, invokeMethodName, stmtText);
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
    let systemImportInfos: ImportBasicInfo[] = getSystemImportInfoFromArkFile(file, systemPackages);

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
                if (!namespaceMatchesImport(api.namespace, importInfo)) continue;
                if (api.directCall === true) {
                    directCallApis.push(api);
                } else if (api.directCall === false) {
                    indirectCallApis.push(api);
                }
                privacyConstants.push(api);
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
                checkIndirectCallPrivacyApis(cfg, indirectCallCheckUnits, file.getName(), methodSig)
            );

            // Pattern 4: privacy constants
            results = results.concat(
                checkPrivacyConstantUsages(cfg, privacyConstantsCheckUnits, file.getName(), methodSig)
            );
        }
    }

    return results;
}
