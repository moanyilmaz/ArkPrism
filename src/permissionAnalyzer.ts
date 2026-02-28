/**
 * ArkPrism - Permission Analyzer
 * Extracts declared permissions from module.json5 files.
 * (Adapted from privacyanalyzer)
 */

import { PermissionResult, StringJsonFileObject } from './prototypes';
import { findFiles } from './utils';
import { readFileSync } from 'fs';
import JSON5 from 'json5';

/**
 * Parse a module.json5 file and extract permission declarations.
 */
function parseModuleJson5(filePath: string): PermissionResult[] {
    let results: PermissionResult[] = [];

    try {
        let content = readFileSync(filePath, 'utf8');
        let json = JSON5.parse(content);

        let moduleName = json?.module?.name || "unknown";
        let requestPermissions = json?.module?.requestPermissions;

        if (Array.isArray(requestPermissions)) {
            for (let perm of requestPermissions) {
                let reason: string[] | null = null;
                if (perm.reason) {
                    // reason is usually a $string:xxx reference
                    reason = typeof perm.reason === 'string' ? [perm.reason] : [];
                }
                results.push({
                    moduleName: moduleName,
                    permission: perm.name || "unknown",
                    reason: reason
                });
            }
        }
    } catch (e) {
        console.log(`[PERMISSION] Error parsing ${filePath}: ${e}`);
    }

    return results;
}

/**
 * Resolve $string:xxx references from string.json files.
 */
function resolveStringReferences(
    permissions: PermissionResult[],
    projectDir: string
): PermissionResult[] {
    // Find all string.json files
    let stringFiles = findFiles(projectDir, "string.json");
    let stringMap = new Map<string, string>();

    for (let sf of stringFiles) {
        try {
            let content = readFileSync(sf, 'utf8');
            let json = JSON.parse(content);
            if (json.string && Array.isArray(json.string)) {
                for (let item of json.string as StringJsonFileObject[]) {
                    stringMap.set(item.name, item.value);
                }
            }
        } catch {
            // skip
        }
    }

    // Resolve references
    for (let perm of permissions) {
        if (perm.reason) {
            perm.reason = perm.reason.map(r => {
                if (r.startsWith("$string:")) {
                    let key = r.substring(8); // remove "$string:"
                    return stringMap.get(key) || r;
                }
                return r;
            });
        }
    }

    return permissions;
}

/**
 * Analyze all module.json5 files in the project for permission declarations.
 */
export function analyzePermissions(projectDir: string): PermissionResult[] {
    console.log("[PERMISSION] Analyzing permissions...");

    let moduleJsonFiles = findFiles(projectDir, "module.json5");
    console.log(`[PERMISSION] Found ${moduleJsonFiles.length} module.json5 files.`);

    let allPermissions: PermissionResult[] = [];
    for (let file of moduleJsonFiles) {
        allPermissions = allPermissions.concat(parseModuleJson5(file));
    }

    // Resolve string references
    allPermissions = resolveStringReferences(allPermissions, projectDir);

    console.log(`[PERMISSION] Found ${allPermissions.length} permission declarations.`);
    return allPermissions;
}
