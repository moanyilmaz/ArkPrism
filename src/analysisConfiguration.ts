export type AnalysisProfile = 'precise' | 'fast';
export type TaintCallGraphMode = 'pta' | 'rta' | 'cha';

export interface AnalysisConfigurationInput {
    analysisProfile?: string;
    taintCallGraph?: string;
    noPta?: boolean;
}

export interface AnalysisConfiguration {
    profile: AnalysisProfile | 'custom';
    taintCallGraph: TaintCallGraphMode;
}

export function resolveAnalysisConfiguration(input: AnalysisConfigurationInput): AnalysisConfiguration {
    const { analysisProfile: profile, taintCallGraph: graph, noPta } = input;
    if (profile !== undefined && profile !== 'precise' && profile !== 'fast') {
        throw new Error(`Invalid analysis profile: ${profile}. Expected precise or fast.`);
    }
    if (graph !== undefined && graph !== 'pta' && graph !== 'rta' && graph !== 'cha') {
        throw new Error(`Invalid taint call graph: ${graph}. Expected pta, rta or cha.`);
    }
    const profileGraph = profile === 'fast' ? 'rta' : profile === 'precise' ? 'pta' : undefined;
    if (profileGraph && graph && profileGraph !== graph) {
        throw new Error('Conflicting --analysis-profile and --taint-call-graph options.');
    }
    const mode = graph || profileGraph || (noPta ? 'cha' : 'pta');
    if (noPta && mode !== 'cha') {
        throw new Error('--no-pta is the legacy CHA mode; do not combine it with a different analysis mode.');
    }
    return { profile: mode === 'pta' ? 'precise' : mode === 'rta' ? 'fast' : 'custom', taintCallGraph: mode };
}
