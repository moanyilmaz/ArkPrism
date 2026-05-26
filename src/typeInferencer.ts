/**
 * Type Inference Utility
 *
 * Uses ArkAnalyzer's TypeInference to improve API matching accuracy.
 * Helps resolve:
 * 1. Generic type parameters
 * 2. Unclear reference types
 * 3. Dynamic type inference for variables
 */

import {
    Scene, ArkMethod, ArkField, ArkClass, Value, Type,
    TypeInference
} from './arkanalyzer';

/**
 * Enhanced type resolution result.
 */
export interface TypeResolution {
    originalType: string;
    resolvedType: string | null;
    confidence: 'high' | 'medium' | 'low';
}

/**
 * Infer the actual type of a value/variable in a method.
 */
export function inferValueType(value: Value, method: ArkMethod): Type | null {
    return TypeInference.inferValueType(value, method);
}

/**
 * Infer field type from base type and field name.
 */
export function inferFieldType(
    baseType: Type,
    fieldName: string,
    arkClass: ArkClass
): { type: Type | null; baseObject: any } | null {
    const result = TypeInference.inferFieldType(baseType, fieldName, arkClass);
    if (!result) return null;
    return Array.isArray(result) ? { type: result[1], baseObject: result[0] } : result;
}

/**
 * Resolve unclear reference type to actual type.
 */
export function resolveUnclearType(arkClass: ArkClass, refName: string): Type | null {
    return TypeInference.inferUnclearRefName(refName, arkClass);
}

/**
 * Get type string representation with better formatting.
 */
export function getTypeString(type: Type | null): string {
    if (!type) return 'unknown';
    return type.toString() || 'unknown';
}

/**
 * Analyze all local variables in a method and their inferred types.
 */
export function analyzeMethodTypes(scene: Scene, method: ArkMethod): Map<string, string> {
    const result = new Map<string, string>();
    const body = method.getBody();
    if (!body) return result;

    const cfg = body.getCfg();
    if (!cfg) return result;

    // Get all local variables from CFG statements
    for (const stmt of cfg.getStmts()) {
        const uses = stmt.getUses();
        for (const value of uses) {
            if ('getName' in value && typeof value.getName === 'function') {
                const local = value as Value & { getName(): string };
                const name = local.getName();
                if (name && !result.has(name)) {
                    const inferredType = inferValueType(value, method);
                    result.set(name, getTypeString(inferredType));
                }
            }
        }
    }

    return result;
}

/**
 * Check if a value's type matches an expected type pattern.
 */
export function typeMatches(
    value: Value,
    method: ArkMethod,
    expectedPatterns: string[]
): boolean {
    const inferredType = inferValueType(value, method);
    if (!inferredType) return false;

    const typeStr = getTypeString(inferredType).toLowerCase();
    return expectedPatterns.some(p => typeStr.includes(p.toLowerCase()));
}