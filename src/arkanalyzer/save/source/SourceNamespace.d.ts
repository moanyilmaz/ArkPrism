import { ArkNamespace } from '../../core/model/ArkNamespace';
import { SourceBase } from './SourceBase';
/**
 * @category save
 */
export declare class SourceNamespace extends SourceBase {
    ns: ArkNamespace;
    constructor(ns: ArkNamespace, indent?: string);
    getLine(): number;
    dump(): string;
}
//# sourceMappingURL=SourceNamespace.d.ts.map