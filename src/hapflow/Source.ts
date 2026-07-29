import { MethodSignature } from "../arkanalyzer";

export type SourceKind = "privacy_data" | "framework_input";

export interface SourceRuleMetadata {
    module?: string;
    namespace?: string;
    className?: string;
    apiName?: string;
    parameterTypes?: string[];
    returnType?: string;
    sourceKind?: SourceKind;
    ruleOrigin?: string;
}

export function hasConcreteSourceCarrierType(typeName: string): boolean {
    const type = String(typeName || '').trim();
    if (!type) return false;
    return !/(^|[<|,&()[\]\s])(?:any|unknown|object|void|undefined|never)(?=$|[>|,&()[\]\s])/i.test(type);
}

export function validateSourceRuleObject(
    object: any,
    filePath: string,
    index: number
): SourceKind {
    const issues: string[] = [];
    const sourceType = String(object?.source_type || '');
    const sourceKind = String(object?.source_kind || '') as SourceKind;
    const parameters = object?.parameters;
    const returnType = String(object?.returnType || '').trim();
    const taintedIndex = object?.tainted_param_index;

    if (!String(object?.api_name || '').trim()) issues.push('api_name is required');
    if (!String(object?.module || '').trim()) issues.push('module is required');
    if (!Array.isArray(parameters)) issues.push('parameters must be an array');
    if (!String(object?.reason || '').trim()) issues.push('reason is required');
    if (!String(object?.sensitivity || '').trim()) issues.push('sensitivity is required');
    if (sourceKind !== 'privacy_data' && sourceKind !== 'framework_input') {
        issues.push('source_kind must be privacy_data or framework_input');
    }
    if (!['return', 'callback', 'ArgIn'].includes(sourceType)) {
        issues.push(`unsupported source_type=${sourceType || '(missing)'}`);
    }

    if (sourceType === 'return') {
        if (!hasConcreteSourceCarrierType(returnType)) {
            issues.push('return sources require a concrete non-void returnType');
        }
        if (taintedIndex !== -1) issues.push('return sources require tainted_param_index=-1');
        if (sourceKind !== 'privacy_data') {
            issues.push('return sources must use source_kind=privacy_data');
        }
    } else if (sourceType === 'callback' && Array.isArray(parameters)) {
        const callbackIndex = Number(taintedIndex) - 1;
        const callbackType = String(parameters[callbackIndex]?.type || '').trim();
        if (!Number.isInteger(callbackIndex) || callbackIndex < 0 || callbackIndex >= parameters.length) {
            issues.push('callback tainted_param_index must identify a parameter');
        } else if (!/(?:Async)?Callback\s*</.test(callbackType)) {
            issues.push('callback carrier parameter must have a Callback<T> type');
        }
        if (sourceKind !== 'privacy_data') {
            issues.push('callback sources must use source_kind=privacy_data');
        }
    } else if (sourceType === 'ArgIn' && Array.isArray(parameters)) {
        const sourceIndex = Number(taintedIndex) - 1;
        if (!Number.isInteger(sourceIndex) || sourceIndex < 0 || sourceIndex >= parameters.length) {
            issues.push('ArgIn tainted_param_index must identify a parameter');
        }
        if (sourceKind !== 'framework_input') {
            issues.push('ArgIn sources must use source_kind=framework_input');
        }
    }

    if (issues.length > 0) {
        throw new Error(
            `Invalid source rule ${filePath}[${index}] (${object?.api_name || 'unknown'}): `
            + issues.join('; ')
        );
    }
    return sourceKind;
}

export class Source {
    methodSignature: MethodSignature;
    sourceType: string;
    sourceIndex: number;
    callbackIndex: number;
    rule: SourceRuleMetadata;

    constructor(
        methodSignature: MethodSignature,
        sourceType: string,
        sourceIndex: number,
        callbackIndex: number,
        rule: SourceRuleMetadata = {}
    ) {
        this.methodSignature = methodSignature;
        this.sourceType = sourceType;
        this.sourceIndex = sourceIndex;
        this.callbackIndex = callbackIndex;
        this.rule = rule;
    }
}
