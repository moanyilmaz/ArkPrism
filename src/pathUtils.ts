import * as path from 'path';

const WINDOWS_DEVICE_PREFIX = '\\\\?\\';
const WINDOWS_UNC_DEVICE_PREFIX = '\\\\?\\UNC\\';

/** Remove a Windows extended-length prefix without changing the remaining path. */
export function stripWindowsExtendedPathPrefix(inputPath: string): string {
    if (inputPath.startsWith(WINDOWS_UNC_DEVICE_PREFIX)) {
        return `\\\\${inputPath.slice(WINDOWS_UNC_DEVICE_PREFIX.length)}`;
    }
    if (inputPath.startsWith(WINDOWS_DEVICE_PREFIX)) {
        return inputPath.slice(WINDOWS_DEVICE_PREFIX.length);
    }
    return inputPath;
}

/** Resolve a user-facing path while keeping reports and logs free of device prefixes. */
export function toDisplayPath(inputPath: string): string {
    return path.resolve(stripWindowsExtendedPathPrefix(inputPath));
}

/**
 * Convert an absolute Windows path to the extended-length namespace used by
 * Unicode Win32 filesystem APIs. Other platforms keep an ordinary absolute path.
 */
export function toFileSystemPath(inputPath: string): string {
    const absolutePath = toDisplayPath(inputPath);
    return process.platform === 'win32'
        ? path.toNamespacedPath(absolutePath)
        : absolutePath;
}

export interface AnalysisPath {
    displayPath: string;
    fileSystemPath: string;
}

/** Resolve both representations once at the process boundary. */
export function resolveAnalysisPath(inputPath: string): AnalysisPath {
    const displayPath = toDisplayPath(inputPath);
    return {
        displayPath,
        fileSystemPath: toFileSystemPath(displayPath),
    };
}
