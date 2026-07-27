import {
    PrivacyDataApiResult,
    TaintFlowLink,
    TaintFlowResult
} from './prototypes';

function normalizePath(value: string | undefined): string {
    return (value || '')
        .replace(/\\/g, '/')
        .replace(/\/+/g, '/')
        .toLowerCase();
}

function pathsReferToSameFile(left: string | undefined, right: string | undefined): boolean {
    const a = normalizePath(left);
    const b = normalizePath(right);
    if (!a || !b) return false;
    return a === b || a.endsWith(`/${b}`) || b.endsWith(`/${a}`);
}

function normalizedMember(method: string): string {
    return method
        .replace(/\(\)\s*$/, '')
        .replace(/\s*\(.*/, '')
        .split('.')
        .filter(Boolean)
        .pop() || method;
}

function statementMentionsMember(statement: string, method: string): boolean {
    const member = normalizedMember(method);
    const escaped = member.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(?:\\.|:\\s*\\.)${escaped}(?:\\(|\\s*>|\\s*\\()`).test(statement);
}

/**
 * Conservatively link detector occurrences to independently produced taint flows.
 * File agreement is mandatory. A link then requires either the exact ArkIR source
 * statement or the same positive source line plus a compatible member token.
 */
export function linkTaintFlowsToPrivacyUsages(
    usages: PrivacyDataApiResult[],
    flows: TaintFlowResult[]
): TaintFlowLink[] {
    const links: TaintFlowLink[] = [];

    usages.forEach((usage, usageIndex) => {
        flows.forEach((flow, taintFlowIndex) => {
            if (flow.sourceKind !== 'privacy_data') return;
            if (!pathsReferToSameFile(usage.file, flow.sourceFile)) return;

            const exactStatement = usage.code.trim() === flow.sourceApi.trim();
            const sameLocation = (usage.line || 0) > 0
                && flow.sourceLine > 0
                && usage.line === flow.sourceLine
                && statementMentionsMember(flow.sourceApi, usage.method);
            if (!exactStatement && !sameLocation) return;

            links.push({
                apiUsageIndex: usageIndex,
                taintFlowIndex,
                evidence: exactStatement ? 'exact_statement' : 'source_location'
            });
        });
    });

    return links;
}
