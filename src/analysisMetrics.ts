import { performance } from 'perf_hooks';

export interface AnalysisPerformance {
    totalAnalysisMs: number;
    phaseTimingsMs: Record<string, number>;
    cpuTimeMs: { user: number; system: number };
    processPeakRssBytes: number;
    heapUsedAtEndBytes: number;
}

export class AnalysisTimer {
    readonly phaseTimingsMs: Record<string, number> = {};
    private readonly started = performance.now();
    private readonly cpuStarted = process.cpuUsage();

    start(name: string): () => void {
        const started = performance.now();
        return () => {
            const elapsed = performance.now() - started;
            this.phaseTimingsMs[name] = (this.phaseTimingsMs[name] || 0) + elapsed;
            console.log(`[TIMING] ${name}: ${elapsed.toFixed(1)} ms`);
        };
    }

    measure<T>(name: string, action: () => T): T {
        const finish = this.start(name);
        try { return action(); } finally { finish(); }
    }

    snapshot(): AnalysisPerformance {
        const cpu = process.cpuUsage(this.cpuStarted);
        return {
            totalAnalysisMs: performance.now() - this.started,
            phaseTimingsMs: { ...this.phaseTimingsMs },
            cpuTimeMs: { user: cpu.user / 1000, system: cpu.system / 1000 },
            processPeakRssBytes: process.resourceUsage().maxRSS * 1024,
            heapUsedAtEndBytes: process.memoryUsage().heapUsed,
        };
    }
}
