import * as fs from 'fs';
import * as path from 'path';

export interface OpenHarmonySdkInfo {
    path: string;
    apiVersion: string;
    version: string;
    releaseType?: string;
}

export function readOpenHarmonySdkInfo(sdkPath: string): OpenHarmonySdkInfo {
    if (!sdkPath) {
        throw new Error(
            'OpenHarmony SDK is required. Pass --sdkPath <ets-dir> or set OPENHARMONY_SDK_PATH.',
        );
    }

    const resolvedPath = path.resolve(sdkPath);
    if (!fs.existsSync(resolvedPath) || !fs.statSync(resolvedPath).isDirectory()) {
        throw new Error(`OpenHarmony SDK directory does not exist: ${resolvedPath}`);
    }

    const manifestPath = path.join(resolvedPath, 'oh-uni-package.json');
    if (!fs.existsSync(manifestPath)) {
        throw new Error(
            `Invalid OpenHarmony ets SDK: missing oh-uni-package.json in ${resolvedPath}`,
        );
    }

    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const apiVersion = String(manifest.apiVersion || '').trim();
    const version = String(manifest.version || '').trim();
    if (!apiVersion || !version) {
        throw new Error(`Invalid OpenHarmony SDK metadata: ${manifestPath}`);
    }

    return {
        path: resolvedPath,
        apiVersion,
        version,
        releaseType: manifest.releaseType ? String(manifest.releaseType) : undefined,
    };
}
