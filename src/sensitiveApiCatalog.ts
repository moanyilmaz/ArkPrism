import {
    PrivacyDataAPI,
    PrivacyPackageInfo,
    SensitiveApiOverload,
} from './prototypes';

interface ReviewedSensitiveApiRecord {
    URL_postfix?: string;
    import_kit?: string;
    possible_module_title?: string;
    api_signature?: string;
    api_kwd?: string;
    call_catagory?: string;
    descrip0?: string;
    descrip1?: string;
    descrip2?: string;
    permission?: string | null;
    dataType?: string;
    label?: string;
    supplement?: string;
}

function text(value: unknown): string {
    return String(value == null ? '' : value).trim();
}

function optionalText(value: unknown): string | undefined {
    const valueText = text(value);
    return valueText && valueText.toLowerCase() !== 'null' ? valueText : undefined;
}

function unique(values: Array<string | undefined>): string[] {
    return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

function parseIdentity(record: ReviewedSensitiveApiRecord): { namespace: string; method: string } {
    const signature = text(record.api_signature);
    const callIndex = signature.indexOf('(');
    const head = (callIndex >= 0 ? signature.slice(0, callIndex) : signature).trim();
    const suffix = callIndex >= 0 ? signature.slice(callIndex).trim() : '';
    const parts = head.split('.').filter(Boolean);

    if (parts.length === 0) {
        throw new Error(`Sensitive API record has no usable identity: ${JSON.stringify(record)}`);
    }
    if (parts.length === 1) {
        const member = text(record.api_kwd) || parts[0];
        return { namespace: member, method: `${member}${suffix}` };
    }
    return {
        namespace: parts[0],
        method: `${parts.slice(1).join('.')}${suffix}`,
    };
}

function splitParameters(parameters: string): string[] {
    if (!parameters.trim()) return [];
    const result: string[] = [];
    let current = '';
    let angle = 0;
    let square = 0;
    let brace = 0;
    let paren = 0;
    let quote = '';

    for (let index = 0; index < parameters.length; index++) {
        const char = parameters[index];
        if (quote) {
            current += char;
            if (char === quote && parameters[index - 1] !== '\\') quote = '';
            continue;
        }
        if (char === "'" || char === '"' || char === '`') {
            quote = char;
            current += char;
            continue;
        }
        if (char === '<') angle++;
        else if (char === '>') angle = Math.max(0, angle - 1);
        else if (char === '[') square++;
        else if (char === ']') square = Math.max(0, square - 1);
        else if (char === '{') brace++;
        else if (char === '}') brace = Math.max(0, brace - 1);
        else if (char === '(') paren++;
        else if (char === ')') paren = Math.max(0, paren - 1);

        if (char === ',' && angle === 0 && square === 0 && brace === 0 && paren === 0) {
            result.push(current.trim());
            current = '';
        } else {
            current += char;
        }
    }
    if (current.trim()) result.push(current.trim());
    return result;
}

function parseOverload(record: ReviewedSensitiveApiRecord): SensitiveApiOverload | undefined {
    const signature = text(record.descrip0);
    const open = signature.indexOf('(');
    if (open < 0 || !/\)\s*:/.test(signature)) return undefined;

    let depth = 0;
    let close = -1;
    let quote = '';
    for (let index = open; index < signature.length; index++) {
        const char = signature[index];
        if (quote) {
            if (char === quote && signature[index - 1] !== '\\') quote = '';
            continue;
        }
        if (char === "'" || char === '"' || char === '`') {
            quote = char;
            continue;
        }
        if (char === '(') depth++;
        if (char === ')' && --depth === 0) {
            close = index;
            break;
        }
    }
    if (close < 0) return undefined;

    const parameters = splitParameters(signature.slice(open + 1, close));
    const hasRest = parameters.some(parameter => parameter.trim().startsWith('...'));
    const minArgs = parameters.filter(parameter =>
        !parameter.trim().startsWith('...') &&
        !/^\s*[A-Za-z_$][\w$]*\s*\?\s*:/.test(parameter) &&
        !parameter.includes('=')
    ).length;
    return {
        signature,
        minArgs,
        maxArgs: hasRest ? null : parameters.length,
        description: optionalText(record.descrip1),
    };
}

function legacyPackages(record: ReviewedSensitiveApiRecord): string[] {
    const title = text(record.possible_module_title);
    return unique([...title.matchAll(/@(?:ohos|hms)\.[A-Za-z0-9_.]+/g)].map(match => match[0]));
}

function documentedReceiverTypes(record: ReviewedSensitiveApiRecord): string[] {
    const title = text(record.possible_module_title);
    return unique(
        [...title.matchAll(/\b(?:Class|Interface)\s*\(([A-Za-z_$][\w$]*)\)/g)]
            .map(match => match[1]),
    );
}

function accessKind(record: ReviewedSensitiveApiRecord): boolean | null {
    if (!/\)\s*:/.test(text(record.descrip0))) return null;
    return text(record.call_catagory) === '间接调用' ? false : true;
}

function appendUnique<T>(values: T[] | undefined, additions: T[]): T[] {
    return [...new Set([...(values || []), ...additions])];
}

function appendOverload(
    values: SensitiveApiOverload[] | undefined,
    overload: SensitiveApiOverload | undefined,
): SensitiveApiOverload[] {
    if (!overload) return values || [];
    const retained = [...(values || [])];
    if (!retained.some(value => value.signature === overload.signature)) {
        retained.push(overload);
    }
    return retained;
}

/**
 * Convert the reviewed flat PAC catalog into the grouped detector model while
 * retaining every overload and every supplied PAC classification.
 */
export function normalizeSensitiveApiCatalog(value: unknown): PrivacyPackageInfo[] {
    if (!Array.isArray(value)) {
        throw new Error('config/sensitive_apis.json must contain the reviewed flat API array');
    }

    const groups = new Map<string, Map<string, PrivacyDataAPI>>();
    for (const raw of value as ReviewedSensitiveApiRecord[]) {
        const systemPackage = text(raw.import_kit);
        const catalogApiSignature = text(raw.api_signature);
        const dataType = text(raw.dataType);
        const label = text(raw.label);
        if (!systemPackage || !catalogApiSignature || !dataType || !label) {
            throw new Error(`Sensitive API record is missing import_kit, api_signature, dataType, or label: ${JSON.stringify(raw)}`);
        }

        const identity = parseIdentity(raw);
        const directCall = accessKind(raw);
        const key = [
            catalogApiSignature.toLowerCase(),
            String(directCall),
            dataType,
            label,
        ].join('|');
        if (!groups.has(systemPackage)) groups.set(systemPackage, new Map());
        const packageRules = groups.get(systemPackage)!;
        const overload = parseOverload(raw);
        const permission = optionalText(raw.permission);
        const description = optionalText(raw.descrip1);
        const supplement = optionalText(raw.supplement);
        const aliases = legacyPackages(raw).filter(alias => alias !== systemPackage);
        const receiverTypes = documentedReceiverTypes(raw)
            .filter(receiverType => receiverType.toLowerCase() !== identity.namespace.toLowerCase());
        const existing = packageRules.get(key);

        if (existing) {
            existing.permissions = appendUnique(existing.permissions, permission ? [permission] : []);
            existing.packageAliases = appendUnique(existing.packageAliases, aliases);
            existing.receiverTypes = appendUnique(existing.receiverTypes, receiverTypes);
            existing.overloads = appendOverload(existing.overloads, overload);
            if (!existing.description && description) existing.description = description;
            if (!existing.supplement && supplement) existing.supplement = supplement;
            continue;
        }

        packageRules.set(key, {
            ...identity,
            directCall,
            permission,
            permissions: permission ? [permission] : [],
            profilingCategory: `${dataType}.${label}`,
            packageAliases: aliases,
            receiverTypes,
            dataType,
            label,
            description,
            supplement,
            documentation: optionalText(raw.URL_postfix),
            catalogApiSignature,
            overloads: overload ? [overload] : [],
        });
    }

    return [...groups.entries()].map(([systemPackage, rules]) => ({
        systemPackage,
        privacyApis: [...rules.values()],
    }));
}
