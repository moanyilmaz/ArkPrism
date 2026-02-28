/**
 * ArkPrism - Utility Functions
 * Shared helpers for Scene construction, file I/O, and configuration loading.
 */

import { Scene, SceneConfig, ArkFile } from "./arkanalyzer";
import { PrivacyPackageInfo, ImportBasicInfo } from "./prototypes";
import { readdirSync, readFileSync, statSync, existsSync, mkdirSync, writeFileSync } from 'fs';
import * as path from 'path';

/**
 * Build a Scene from a JSON config file (matches privacyanalyzer's approach).
 * Scene → buildBasicInfo → buildScene4HarmonyProject → inferTypes
 */
export function getSceneFromJson(config: SceneConfig): Scene {
    let projectScene: Scene = new Scene();
    projectScene.buildBasicInfo(config);
    projectScene.buildScene4HarmonyProject();
    projectScene.inferTypes();
    return projectScene;
}

/**
 * Read the system packages list from a JSON file.
 */
export function readSystemPackages(filePath: string): string[] {
    let data = readFileSync(filePath, 'utf8');
    return JSON.parse(data);
}

/**
 * Read privacy API definitions from a JSON file.
 */
export function readPrivacyApis(filePath: string): PrivacyPackageInfo[] {
    let data = readFileSync(filePath, 'utf8');
    return JSON.parse(data) as PrivacyPackageInfo[];
}

/**
 * Extract system import info from an ArkFile.
 * Only includes imports from known system packages.
 * (Directly adapted from privacyanalyzer)
 */
export function getSystemImportInfoFromArkFile(file: ArkFile, systemPackages: string[]): ImportBasicInfo[] {
    let arkFileSystemImportInfo: ImportBasicInfo[] = [];
    for (const info of file.getImportInfos()) {
        if (systemPackages.includes(info.getFrom() || "")) {
            arkFileSystemImportInfo.push({
                originName: info.getOriginName(),
                importClauseName: info.getImportClauseName(),
                importFrom: info.getFrom(),
                declaringArkFile: info.getDeclaringArkFile()
            });
        }
    }
    return arkFileSystemImportInfo;
}

/**
 * Recursively find files matching a target filename.
 * Skips build and cache directories.
 */
export function findFiles(rootPath: string, targetFilename: string): string[] {
    if (rootPath.includes("build") || rootPath.includes("cache")) return [];
    if (!existsSync(rootPath)) return [];
    let res: string[] = [];
    let files = readdirSync(rootPath);
    for (const f of files) {
        const fullPath = path.join(rootPath, f);
        if (statSync(fullPath).isDirectory()) {
            res = res.concat(findFiles(fullPath, targetFilename));
        } else if (f === targetFilename) {
            res.push(fullPath);
        }
    }
    return res;
}

/**
 * Write JSON output to a file.
 */
export function writeJsonOutput(data: object, outputDir: string, filename: string): void {
    if (!existsSync(outputDir)) {
        mkdirSync(outputDir, { recursive: true });
    }
    const outputFilePath = path.join(outputDir, filename);
    writeFileSync(outputFilePath, JSON.stringify(data, null, 2), 'utf8');
    console.log(`[OUTPUT] Report written to: ${outputFilePath}`);
}

/**
 * Format a timestamp for output.
 */
export function getTimestamp(): string {
    return new Date().toISOString();
}
