/**
 * Smart ablation: Run lifecycle-enhanced mode first on all projects,
 * then only run flat mode on projects with flows or collab behaviors.
 * This avoids double-running 0-result projects.
 */
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const DATASET = 'D:/argus-dataset/all-1015/ARGUS-successful-1015-samples-20260617';
const ARKPRISM = 'node dist/arkprism.js';
const CWD = 'D:/Projects/Argus-0703/ArkPrism';
const OUTPUT_DIR = 'D:/Projects/Argus-0703/ArkPrism/ablation_results';

if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

const projects = fs.readdirSync(DATASET).filter(p => {
    return fs.statSync(path.join(DATASET, p)).isDirectory();
});

console.log(`Found ${projects.length} projects.`);
console.log('Phase 1: Run lifecycle-enhanced mode on all projects...');

const lcResults = [];
const startTime = Date.now();

// Phase 1: Run lifecycle-enhanced only
for (let i = 0; i < projects.length; i++) {
    const proj = projects[i];
    const projPath = path.join(DATASET, proj);

    if (i % 50 === 0) {
        const elapsed = ((Date.now() - startTime) / 1000 / 60).toFixed(1);
        console.log(`\n[Phase 1] ${i}/${projects.length} (${elapsed}min, ${lcResults.length} done)`);
    }

    try {
        const out = execSync(
            `${ARKPRISM} "${projPath}" --no-pta --lifecycle-level 2 --no-dot`,
            { cwd: CWD, timeout: 300000, encoding: 'utf8', stdio: ['pipe','pipe','pipe'] }
        );
        const cg = out.match(/CG ready \(nodes=(\d+)\)/);
        const lcCG = cg ? parseInt(cg[1]) : 0;
        const collab = out.match(/Collab\.\s+behaviors found:\s*(\d+)/);
        const lcCollab = collab ? parseInt(collab[1]) : 0;
        const flows = out.match(/Taint flows detected:\s*(\d+)/);
        const lcFlows = flows ? parseInt(flows[1]) : 0;
        const ifds = out.match(/flows=(\d+), edges/);
        const lcIfds = ifds ? parseInt(ifds[1]) : 0;
        const cp = out.match(/(\d+) cross-phase edges/);
        const lcCrossPhase = cp ? parseInt(cp[1]) : 0;

        lcResults.push({ proj, lcCG, lcCollab, lcFlows, lcIfds, lcCrossPhase });

        if (lcFlows > 0 || lcCollab > 0) {
            console.log(`  ${proj}: CG=${lcCG}, Collab=${lcCollab}, Flows=${lcFlows}, CP=${lcCrossPhase}`);
        }
    } catch (e) {
        lcResults.push({ proj, lcCG: 0, lcCollab: 0, lcFlows: 0, lcIfds: 0, lcCrossPhase: 0, failed: true });
    }
}

// Save Phase 1 results
fs.writeFileSync(path.join(OUTPUT_DIR, 'lc_results.json'), JSON.stringify(lcResults, null, 2));

// Phase 2: Run flat mode only on projects with flows or collab
const interesting = lcResults.filter(r => (r.lcFlows > 0 || r.lcCollab > 0) && !r.failed);
console.log(`\n\nPhase 2: Run flat mode on ${interesting.length} interesting projects...`);

const results = [];
for (let i = 0; i < interesting.length; i++) {
    const r = interesting[i];
    const projPath = path.join(DATASET, r.proj);

    if (i % 10 === 0) {
        const elapsed = ((Date.now() - startTime) / 1000 / 60).toFixed(1);
        console.log(`\n[Phase 2] ${i}/${interesting.length} (${elapsed}min)`);
    }

    try {
        const out = execSync(
            `${ARKPRISM} "${projPath}" --no-pta --no-lifecycle --no-dot`,
            { cwd: CWD, timeout: 300000, encoding: 'utf8', stdio: ['pipe','pipe','pipe'] }
        );
        const cg = out.match(/CG ready \(nodes=(\d+)\)/);
        const flatCG = cg ? parseInt(cg[1]) : 0;
        const collab = out.match(/Collab\.\s+behaviors found:\s*(\d+)/);
        const flatCollab = collab ? parseInt(collab[1]) : 0;
        const flows = out.match(/Taint flows detected:\s*(\d+)/);
        const flatFlows = flows ? parseInt(flows[1]) : 0;
        const ifds = out.match(/flows=(\d+), edges/);
        const flatIfds = ifds ? parseInt(ifds[1]) : 0;

        results.push({
            proj: r.proj,
            flatCG, lcCG: r.lcCG,
            flatCollab, lcCollab: r.lcCollab,
            flatFlows, lcFlows: r.lcFlows,
            flatIfds, lcIfds: r.lcIfds,
            lcCrossPhase: r.lcCrossPhase
        });

        const cgPct = flatCG > 0 ? ((r.lcCG - flatCG) / flatCG * 100).toFixed(1) : 'N/A';
        const diffCollab = r.lcCollab - flatCollab;
        const diffFlows = r.lcFlows - flatFlows;
        console.log(`  ${r.proj}: CG ${flatCG}→${r.lcCG} (+${cgPct}%), Collab ${flatCollab}→${r.lcCollab} (${diffCollab>0?'+':''}${diffCollab}), Flows ${flatFlows}→${r.lcFlows} (${diffFlows>0?'+':''}${diffFlows})`);
    } catch (e) {
        console.log(`  ${r.proj}: FLAT FAILED`);
        results.push({
            proj: r.proj,
            flatCG: -1, lcCG: r.lcCG,
            flatCollab: -1, lcCollab: r.lcCollab,
            flatFlows: -1, lcFlows: r.lcFlows,
            flatIfds: -1, lcIfds: r.lcIfds,
            lcCrossPhase: r.lcCrossPhase
        });
    }
}

// Save full results
fs.writeFileSync(path.join(OUTPUT_DIR, 'lc_cg_ablation.json'), JSON.stringify(results, null, 2));

// Summary
console.log('\n\n=== LIFECYCLE CG ABLATION SUMMARY ===');
const valid = results.filter(r => r.flatCG > 0 && r.lcCG > 0);
const withCollabDiff = valid.filter(r => r.lcCollab !== r.flatCollab);
const withFlowDiff = valid.filter(r => r.lcFlows !== r.flatFlows);

console.log(`Projects with flows/collab: ${interesting.length}`);
console.log(`Valid comparisons: ${valid.length}`);
console.log(`Projects with different collab: ${withCollabDiff.length}`);
console.log(`Projects with different taint flows: ${withFlowDiff.length}`);

// CG stats
const avgCGIncrease = valid.length > 0 ?
    valid.reduce((sum, r) => sum + (r.lcCG - r.flatCG) / r.flatCG, 0) / valid.length * 100 : 0;
console.log(`Average CG node increase: ${avgCGIncrease.toFixed(1)}%`);

// Collab stats
const totalFlatCollab = valid.reduce((s, r) => s + r.flatCollab, 0);
const totalLCCollab = valid.reduce((s, r) => s + r.lcCollab, 0);
const collabPct = totalFlatCollab > 0 ? ((totalLCCollab - totalFlatCollab) / totalFlatCollab * 100).toFixed(1) : 'N/A';
console.log(`Total collab: Flat=${totalFlatCollab}, LC=${totalLCCollab} (+${collabPct}%)`);

// Flow stats
const totalFlatFlows = valid.reduce((s, r) => s + r.flatFlows, 0);
const totalLCFlows = valid.reduce((s, r) => s + r.lcFlows, 0);
console.log(`Total flows: Flat=${totalFlatFlows}, LC=${totalLCFlows}`);

// Per-project collab differences
if (withCollabDiff.length > 0) {
    console.log('\nProjects with collab behavior differences:');
    withCollabDiff.forEach(r => {
        const cgPct = ((r.lcCG - r.flatCG) / r.flatCG * 100).toFixed(1);
        console.log(`  ${r.proj}: CG +${cgPct}%, Collab ${r.flatCollab}→${r.lcCollab} (${r.lcCollab > r.flatCollab ? '+' : ''}${r.lcCollab - r.flatCollab}), Flows ${r.flatFlows}→${r.lcFlows}`);
    });
}

const elapsed = ((Date.now() - startTime) / 1000 / 60).toFixed(1);
console.log(`\nTotal time: ${elapsed} minutes`);
