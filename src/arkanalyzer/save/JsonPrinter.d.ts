import { Printer } from './Printer';
import { ArkFile } from '../core/model/ArkFile';
export declare class JsonPrinter extends Printer {
    private arkFile;
    constructor(arkFile: ArkFile);
    dump(): string;
    private serializeArkFile;
    private serializeNamespace;
    private serializeClass;
    private serializeField;
    private serializeMethod;
    private serializeMethodBody;
    private serializeMethodParameter;
    private serializeImportInfo;
    private serializeExportInfo;
    private serializeDecorator;
    private serializeLineColPosition;
    private serializeType;
    private serializeFileSignature;
    private serializeNamespaceSignature;
    private serializeClassSignature;
    private serializeFieldSignature;
    private serializeMethodSignature;
    private serializeAliasTypeSignature;
    private serializeCfg;
    private serializeBasicBlock;
    private serializeLocal;
    private serializeConstant;
    private serializeValue;
    private serializeStmt;
}
//# sourceMappingURL=JsonPrinter.d.ts.map