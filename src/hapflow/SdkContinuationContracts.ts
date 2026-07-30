import {
    AbstractInvokeExpr,
    ArkClass,
    ArkInstanceInvokeExpr,
    ArkNamespace,
    ClassSignature,
    ClassType,
    MethodSignature,
    Scene,
    UnclearReferenceType,
    Value,
} from '../arkanalyzer';

export interface SdkMethodContract {
    minArgs: number;
    maxArgs: number | null;
    returnsPromise: boolean;
}

const PLATFORM_TASK_CALLBACK_INDEX = new Map<string, number>([
    ['setTimeout', 0],
    ['setInterval', 0],
    ['queueMicrotask', 0],
]);

export function isPlatformTaskCallbackSignature(
    methodName: string,
    declaringClassName: string,
    callbackIndex: number
): boolean {
    return declaringClassName === ''
        && PLATFORM_TASK_CALLBACK_INDEX.get(methodName) === callbackIndex;
}

export function isPromiseTypeText(typeName: string): boolean {
    return /(^|[|&<:.,\s])Promise(?:<|[.>,|&:\s]|$)/.test(typeName);
}

export function sdkMethodArityMatches(
    actualArgs: number,
    minArgs: number,
    maxArgs: number | null
): boolean {
    return actualArgs >= minArgs && (maxArgs === null || actualArgs <= maxArgs);
}

export function sdkContractsGuaranteePromise(
    actualArgs: number,
    contracts: ReadonlyArray<SdkMethodContract>
): boolean {
    const compatible = contracts.filter(contract =>
        sdkMethodArityMatches(actualArgs, contract.minArgs, contract.maxArgs)
    );
    return compatible.length > 0 && compatible.every(contract => contract.returnsPromise);
}

function methodContract(signature: MethodSignature): SdkMethodContract {
    const parameters = signature.getMethodSubSignature().getParameters();
    return {
        minArgs: parameters.filter(parameter =>
            !parameter.isOptional() && !parameter.hasDotDotDotToken()
        ).length,
        maxArgs: parameters.some(parameter => parameter.hasDotDotDotToken())
            ? null
            : parameters.length,
        returnsPromise: isPromiseTypeText(
            signature.getMethodSubSignature().getReturnType().toString()
        ),
    };
}

function normalizeReceiverTypeName(typeName: string): string {
    let normalized = typeName.trim().replace(/\s+/g, '');
    const signatureSeparator = normalized.lastIndexOf(':');
    if (signatureSeparator >= 0) normalized = normalized.slice(signatureSeparator + 1);
    if (normalized.startsWith('typeof')) normalized = normalized.slice('typeof'.length);
    const genericStart = normalized.indexOf('<');
    if (genericStart >= 0) normalized = normalized.slice(0, genericStart);
    return normalized;
}

export class SdkPromiseContractResolver {
    private contracts: Map<string, SdkMethodContract[]> | undefined;

    constructor(private readonly scene: Scene) {}

    public invocationReturnsPromise(invokeExpr: AbstractInvokeExpr): boolean {
        const subSignature = invokeExpr.getMethodSignature().getMethodSubSignature();
        if (isPromiseTypeText(subSignature.getReturnType().toString())) return true;

        const resolvedMethod = this.scene.getMethod(invokeExpr.getMethodSignature());
        if (resolvedMethod) {
            const signatures = resolvedMethod.getDeclareSignatures() || [resolvedMethod.getSignature()];
            if (sdkContractsGuaranteePromise(
                invokeExpr.getArgs().length,
                signatures.map(methodContract)
            )) {
                return true;
            }
        }

        if (!(invokeExpr instanceof ArkInstanceInvokeExpr)) return false;
        const methodName = subSignature.getMethodName();
        const actualArgs = invokeExpr.getArgs().length;
        const index = this.getContracts();
        for (const receiverKey of this.getValueReceiverKeys(invokeExpr.getBase())) {
            const contracts = index.get(`${receiverKey}\u0000${methodName}`);
            if (!contracts) continue;
            if (!contracts.some(contract =>
                sdkMethodArityMatches(actualArgs, contract.minArgs, contract.maxArgs)
            )) continue;
            return sdkContractsGuaranteePromise(actualArgs, contracts);
        }
        return false;
    }

    private getReceiverKeys(classSignature: ClassSignature): string[] {
        const namespaceNames: string[] = [];
        let namespaceSignature = classSignature.getDeclaringNamespaceSignature();
        while (namespaceSignature) {
            namespaceNames.unshift(namespaceSignature.getNamespaceName());
            namespaceSignature = namespaceSignature.getDeclaringNamespaceSignature();
        }

        const className = classSignature.getClassName();
        const qualifiedName = [...namespaceNames, className].filter(Boolean).join('.');
        return Array.from(new Set([
            normalizeReceiverTypeName(qualifiedName),
            normalizeReceiverTypeName(classSignature.toString()),
            normalizeReceiverTypeName(className),
        ].filter(Boolean)));
    }

    private getValueReceiverKeys(value: Value): string[] {
        const type = value.getType();
        const keys: string[] = [];
        if (type instanceof ClassType) {
            keys.push(...this.getReceiverKeys(type.getClassSignature()));
        } else if (type instanceof UnclearReferenceType) {
            keys.push(normalizeReceiverTypeName(type.getName()));
        }
        keys.push(normalizeReceiverTypeName(type.toString()));

        const unique = Array.from(new Set(keys.filter(Boolean)));
        for (const key of [...unique]) {
            const separator = key.lastIndexOf('.');
            if (separator >= 0) unique.push(key.slice(separator + 1));
        }
        return Array.from(new Set(unique.filter(Boolean)));
    }

    private indexClass(arkClass: ArkClass, index: Map<string, SdkMethodContract[]>): void {
        const receiverKeys = this.getReceiverKeys(arkClass.getSignature());
        for (const method of arkClass.getMethods()) {
            const signatures = method.getDeclareSignatures() || [method.getSignature()];
            const contracts = signatures.map(methodContract);
            if (!contracts.some(contract => contract.returnsPromise)) continue;

            for (const receiverKey of receiverKeys) {
                const key = `${receiverKey}\u0000${method.getName()}`;
                const existing = index.get(key) || [];
                existing.push(...contracts);
                index.set(key, existing);
            }
        }
    }

    private indexNamespace(
        namespace: ArkNamespace,
        index: Map<string, SdkMethodContract[]>
    ): void {
        for (const arkClass of namespace.getClasses()) {
            this.indexClass(arkClass, index);
        }
        for (const child of namespace.getNamespaces()) {
            this.indexNamespace(child, index);
        }
    }

    private getContracts(): Map<string, SdkMethodContract[]> {
        if (this.contracts) return this.contracts;

        const index = new Map<string, SdkMethodContract[]>();
        for (const file of this.scene.getSdkArkFiles()) {
            for (const arkClass of file.getClasses()) {
                this.indexClass(arkClass, index);
            }
            for (const namespace of file.getNamespaces()) {
                this.indexNamespace(namespace, index);
            }
        }
        this.contracts = index;
        return index;
    }
}
