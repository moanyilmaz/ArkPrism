import { spawnSync } from 'child_process';
import { getHeapStatistics } from 'v8';

const MEBIBYTE = 1024 * 1024;
export const DEFAULT_MAX_OLD_SPACE_SIZE_MB = 12288;
const HEAP_CHILD_MARKER = 'ARKPRISM_HEAP_REEXEC';
const HEAP_SIZE_ENV = 'ARKPRISM_MAX_OLD_SPACE_SIZE_MB';

export function getRequiredHeapMb(env: NodeJS.ProcessEnv = process.env): number {
    const configured = env[HEAP_SIZE_ENV];
    if (configured === undefined || configured.trim() === '') {
        return DEFAULT_MAX_OLD_SPACE_SIZE_MB;
    }
    const parsed = Number(configured);
    if (!Number.isInteger(parsed) || parsed < 0) {
        throw new Error(`[HEAP_CONFIG_INVALID] ${HEAP_SIZE_ENV} must be a non-negative integer.`);
    }
    return parsed;
}

export function getCurrentHeapLimitMb(): number {
    return Math.floor(getHeapStatistics().heap_size_limit / MEBIBYTE);
}

function removeHeapLimitArgs(args: string[]): string[] {
    const result: string[] = [];
    for (let index = 0; index < args.length; index++) {
        const arg = args[index];
        if (/^--max[-_]old[-_]space[-_]size=/.test(arg)) {
            continue;
        }
        if (/^--max[-_]old[-_]space[-_]size$/.test(arg)) {
            index++;
            continue;
        }
        result.push(arg);
    }
    return result;
}

/** Relaunch ArkPrism before analysis when Node's default heap is too small. */
export function ensureAnalysisHeap(): void {
    const requiredHeapMb = getRequiredHeapMb();
    if (requiredHeapMb === 0 || getCurrentHeapLimitMb() >= requiredHeapMb) {
        return;
    }
    if (process.env[HEAP_CHILD_MARKER] === '1') {
        throw new Error(
            `[HEAP_CONFIG_FAILED] V8 heap limit is ${getCurrentHeapLimitMb()} MB; ` +
            `${requiredHeapMb} MB is required.`
        );
    }

    const nodeArgs = [
        `--max-old-space-size=${requiredHeapMb}`,
        ...removeHeapLimitArgs(process.execArgv),
        ...process.argv.slice(1),
    ];
    console.log(
        `[RUNTIME] Relaunching ArkPrism with a ${requiredHeapMb} MB V8 heap ` +
        `(current limit: ${getCurrentHeapLimitMb()} MB).`
    );
    const child = spawnSync(process.execPath, nodeArgs, {
        stdio: 'inherit',
        env: {
            ...process.env,
            [HEAP_CHILD_MARKER]: '1',
        },
    });
    if (child.error) {
        throw child.error;
    }
    process.exit(child.status ?? 1);
}
