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

    for (let block of blocks) {
        let stmts = block.getStmts();
        for (let stmt of stmts) {
            // Pattern 2: direct invoke after assignment
            if (stmt instanceof ArkAssignStmt) {
                if (stmt.containsInvokeExpr()) {
                    let rightOp: Value = stmt.getRightOp();
                    let invokeExpr: AbstractInvokeExpr | undefined = stmt.getInvokeExpr();
                    let invokeMethodName: string | undefined = invokeExpr?.getMethodSignature().getMethodSubSignature().getMethodName();
                    let rightOpUses: Value[] = rightOp.getUses();

                    let namespacesInStmt: ImportEntryCheckUnit[] = directCallCheckUnits.filter(
                        unit => unit.importClauseName === rightOpUses[0]?.toString()
                    );
                    if (namespacesInStmt.length > 0) {
                        let relatedApis: PrivacyDataAPI[] = namespacesInStmt[0].relatedApis;
                        let matchedApi = relatedApis.find(api => api.method === invokeMethodName);
                        if (matchedApi) {
                            results.push({
                                category: "direct invoke stmt after assignment",
                                apiPackage: namespacesInStmt[0].systemPackage,
                                namespace: rightOpUses[0]?.toString() || "",
                                method: invokeMethodName || "",
                                args: invokeExpr?.getArgs().map(arg => arg.toString()) || [],
                                code: stmt.toString(),
                                file: filename,
                                declaringMethod: declaringMethod,
                                permission: matchedApi.permission,
                                profilingCategory: matchedApi.profilingCategory
                            });
                        }
                    }
                }
            }
            // Pattern 1: direct invoke stmt (no assignment)
            else if (stmt instanceof ArkInvokeStmt) {
                let stmtUses: Value[] = stmt.getUses();
                let invokeExpr: AbstractInvokeExpr = stmt.getInvokeExpr();
                let invokeMethodName: string | undefined = invokeExpr.getMethodSignature().getMethodSubSignature().getMethodName();

                let namespacesInStmt: ImportEntryCheckUnit[] = stmtUses.length > 1
                    ? directCallCheckUnits.filter(unit => unit.importClauseName === stmtUses[1].toString())
                    : [];
                if (namespacesInStmt.length > 0) {
                    let relatedApis: PrivacyDataAPI[] = namespacesInStmt[0].relatedApis;
                    let matchedApi = relatedApis.find(api => api.method === invokeMethodName);
                    if (matchedApi) {
                        results.push({
                            category: "direct invoke stmt",
                            apiPackage: namespacesInStmt[0].systemPackage,
                            namespace: stmtUses[1].toString() || "",
                            method: invokeMethodName || "",
                            args: invokeExpr.getArgs().map(arg => arg.toString()),
                            code: stmt.toString(),
                            file: filename,
                            declaringMethod: declaringMethod,
                            permission: matchedApi.permission,
                            profilingCategory: matchedApi.profilingCategory
                        });
                    }
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
                let caller: Value | undefined = stmtUses.length > 1 ? stmtUses[1] : undefined;
                let callerTypeList: string[] | undefined = caller?.getType().getTypeString().split(".");

                let callerNamespace = (Array.isArray(callerTypeList) && callerTypeList.length > 0) ? callerTypeList[0] : undefined;
                let namespacesInCaller: ImportEntryCheckUnit[] = callerNamespace
                    ? indirectCallCheckUnits.filter(unit => unit.importClauseName === callerNamespace)
                    : [];

                if (namespacesInCaller.length > 0 && callerTypeList) {
                    callerTypeList[0] = namespacesInCaller[0].importSystemNamespace;
                    let methodCall = callerTypeList.concat(invokeMethodName || "").join(".");
                    let matchedApi = namespacesInCaller[0].relatedApis.find(api => api.method === methodCall);
                    if (matchedApi) {
                        results.push({
                            category: "indirect invoke",
                            apiPackage: namespacesInCaller[0].systemPackage,
                            namespace: namespacesInCaller[0].importSystemNamespace,
                            method: methodCall,
                            args: invokeExpr?.getArgs().map(arg => arg.toString()) || [],
                            code: stmt.toString(),
                            file: filename,
                            declaringMethod: declaringMethod,
                            permission: matchedApi.permission,
                            profilingCategory: matchedApi.profilingCategory
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

                let namespacesInStmt: ImportEntryCheckUnit[] = namespaceName
                    ? constantCheckUnits.filter(unit => unit.importClauseName === namespaceName)
                    : [];

                if (namespacesInStmt.length > 0) {
                    let matchedApi = namespacesInStmt[0].relatedApis.find(api => api.method === fieldName);
                    if (matchedApi) {
                        results.push({
                            category: "privacy constants",
                            apiPackage: namespacesInStmt[0].systemPackage,
                            namespace: namespacesInStmt[0].importSystemNamespace,
                            method: fieldName || "",
                            args: [],
                            code: stmt.toString(),
                            file: filename,
                            declaringMethod: declaringMethod,
                            permission: matchedApi.permission,
                            profilingCategory: matchedApi.profilingCategory
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
        let relatedPackages: PrivacyPackageInfo[] = privacyPackageInfos.filter(
            pkg => pkg.systemPackage === importInfo.importFrom
        );

        for (let pkg of relatedPackages) {
            for (const api of pkg.privacyApis) {
                if (api.namespace !== importInfo.originName) continue;
                if (api.directCall === true) {
                    directCallApis.push(api);
                } else if (api.directCall === false) {
                    indirectCallApis.push(api);
                } else if (api.directCall === null) {
                    privacyConstants.push(api);
                }
            }
        }

        const makeUnit = (apis: PrivacyDataAPI[]): ImportEntryCheckUnit => ({
            systemPackage: importInfo.importFrom || "",
            importSystemNamespace: importInfo.originName,
            importClauseName: importInfo.importClauseName,
            relatedApis: apis
        });

        if (directCallApis.length > 0) directCallCheckUnits.push(makeUnit(directCallApis));
        if (indirectCallApis.length > 0) indirectCallCheckUnits.push(makeUnit(indirectCallApis));
        if (privacyConstants.length > 0) privacyConstantsCheckUnits.push(makeUnit(privacyConstants));
    }

    // Run detection on each method in each class
    for (const clazz of classes) {
        let methods: ArkMethod[] = clazz.getMethods();
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
