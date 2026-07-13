/**
 * Ablation: Lifecycle-enhanced CG impact on collab behaviors and CG nodes
 * Runs on ALL 1015 projects, collects CG node counts and collab behaviors
 * Compares flat (no lifecycle) vs lifecycle-enhanced (Level 2)
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

console.log(`Found ${projects.length} projects. Running lifecycle CG ablation...`);

const results = [];
let skipped = 0;
const startTime = Date.now();

for (let i = 0; i < projects.length; i++) {
    const proj = projects[i];
    const projPath = path.join(DATASET, proj);

    if (i % 50 === 0) {
        const elapsed = ((Date.now() - startTime) / 1000 / 60).toFixed(1);
        console.log(`\n[Progress] ${i}/${projects.length} (${elapsed}min, ${results.length} done, ${skipped} skipped)`);
    }

    let flatCG = 0, lcCG = 0, flatCollab = 0, lcCollab = 0;
    let flatFlows = 0, lcFlows = 0, flatIfds = 0, lcIfds = 0;
    let lcCrossPhase = 0, lcBlocks = 0;
    let flatOk = false, lcOk = false;

    // Phase 1: Run lifecycle-enhanced first (to skip 0-flow/0-collab projects)
    try {
        const out2 = execSync(
            `${ARKPRISM} "${projPath}" --no-pta --lifecycle-level 2 --no-dot`,
            { cwd: CWD, timeout: 300000, encoding: 'utf8', stdio: ['pipe','pipe','pipe'] }
        );
        const cg2 = out2.match(/CG ready \(nodes=(\d+)\)/);
        lcCG = cg2 ? parseInt(cg2[1]) : 0;
        const collab2 = out2.match(/Collab\.\s+behaviors found:\s*(\d+)/);
        lcCollab = collab2 ? parseInt(collab2[1]) : 0;
        const m2 = out2.match(/Taint flows detected:\s*(\d+)/);
        lcFlows = m2 ? parseInt(m2[1]) : 0;
        const ifds2 = out2.match(/flows=(\d+), edges/);
        lcIfds = ifds2 ? parseInt(ifds2[1]) : 0;
        const cp = out2.match(/(\d+) cross-phase edges/);
        lcCrossPhase = cp ? parseInt(cp[1]) : 0;
        const bl = out2.match(/Level 2 DummyMain created: (\d+) blocks/);
        lcBlocks = bl ? parseInt(bl[1]) : 0;
        lcOk = true;
    } catch (e) {
        skipped++;
        continue;
    }

    // Skip projects with no flows and no collab
    if (lcFlows === 0 && lcCollab === 0) {
        skipped++;
        results.push({ proj, flatCG: 0, lcCG, flatCollab: 0, lcCollab: 0, flatFlows: 0, lcFlows: 0, flatIfds: 0, lcIfds: 0, lcCrossPhase, lcBlocks });
        continue;
    }

    // Phase 2: Run flat mode
    try {
        const out1 = execSync(
            `${ARKPRISM} "${projPath}" --no-pta --no-lifecycle --no-dot`,
            { cwd: CWD, timeout: 300000, encoding: 'utf8', stdio: ['pipe','pipe','pipe'] }
        );
        const cg1 = out1.match(/CG ready \(nodes=(\d+)\)/);
        flatCG = cg1 ? parseInt(cg1[1]) : 0;
        const collab1 = out1.match(/Collab\.\s+behaviors found:\s*(\d+)/);
        flatCollab = collab1 ? parseInt(collab1[1]) : 0;
        const m1 = out1.match(/Taint flows detected:\s*(\d+)/);
        flatFlows = m1 ? parseInt(m1[1]) : 0;
        const ifds1 = out1.match(/flows=(\d+), edges/);
        flatIfds = ifds1 ? parseInt(ifds1[1]) : 0;
        flatOk = true;
    } catch (e) {
        flatCG = -1;
    }

    if (flatOk || lcOk) {
        results.push({ proj, flatCG, lcCG, flatCollab, lcCollab, flatFlows, lcFlows, flatIfds, lcIfds, lcCrossPhase, lcBlocks });
        const diffCollab = lcCollab - flatCollab;
        const diffFlows = lcFlows - flatFlows;
        const cgPct = flatCG > 0 ? ((lcCG - flatCG) / flatCG * 100).toFixed(1) : 'N/A';
        if (diffCollab !== 0 || diffFlows !== 0) {
            console.log(`  ${proj}: CG ${flatCG}→${lcCG} (+${cgPct}%), Collab ${flatCollab}→${lcCollab} (${diffCollab>0?'+':''}${diffCollab}), Flows ${flatFlows}→${lcFlows} (${diffFlows>0?'+':''}${diffFlows})`);
        }
    }
}

// Save results
fs.writeFileSync(path.join(OUTPUT_DIR, 'lc_cg_ablation.json'), JSON.stringify(results, null, 2));

// Summary
console.log('\n\n=== LIFECYCLE CG ABLATION SUMMARY ===');
const valid = results.filter(r => r.flatCG > 0 && r.lcCG > 0);
const withFlows = valid.filter(r => r.lcFlows > 0 || r.flatFlows > 0);
const withCollabDiff = valid.filter(r => r.lcCollab !== r.flatCollab);
const withFlowDiff = valid.filter(r => r.lcFlows !== r.flatFlows);

console.log(`Projects tested: ${valid.length}`);
console.log(`Projects with taint flows: ${withFlows.length}`);
console.log(`Projects with different collab behaviors: ${withCollabDiff.length}`);
console.log(`Projects with different taint flows: ${withFlowDiff.length}`);

// CG stats
const avgCGIncrease = valid.length > 0 ?
    valid.reduce((sum, r) => sum + (r.lcCG - r.flatCG) / r.flatCG, 0) / valid.length * 100 : 0;
const medCGIncrease = (() => {
    const pcts = valid.map(r => (r.lcCG - r.flatCG) / r.flatCG * 100).sort((a, b) => a - b);
    return pcts.length > 0 ? pcts[Math.floor(pcts.length / 2)] : 0;
})();
console.log(`Average CG node increase: ${avgCGIncrease.toFixed(1)}%`);
console.log(`Median CG node increase: ${medCGIncrease.toFixed(1)}%`);

// Collab stats
const totalFlatCollab = valid.reduce((s, r) => s + r.flatCollab, 0);
const totalLCCollab = valid.reduce((s, r) => s + r.lcCollab, 0);
console.log(`Total collab behaviors: Flat=${totalFlatCollab}, LC=${totalLCCollab} (${totalLCCollab > totalFlatCollab ? '+' : ''}${totalLCCollab - totalFlatCollab}, ${totalFlatCollab > 0 ? ((totalLCCollab - totalFlatCollab) / totalFlatCollab * 100).toFixed(1) : 'N/A'}%)`);

// Flow stats
const totalFlatFlows = valid.reduce((s, r) => s + r.flatFlows, 0);
const totalLCFlows = valid.reduce((s, r) => s + r.lcFlows, 0);
console.log(`Total taint flows: Flat=${totalFlatFlows}, LC=${totalLCFlows} (${totalLCFlows > totalFlatFlows ? '+' : ''}${totalLCFlows - totalFlatFlows})`);

// Per-project collab differences
if (withCollabDiff.length > 0) {
    console.log('\nProjects with collab behavior differences:');
    withCollabDiff.forEach(r => {
        const cgPct = ((r.lcCG - r.flatCG) / r.flatCG * 100).toFixed(1);
        console.log(`  ${r.proj}: CG +${cgPct}%, Collab ${r.flatCollab}→${r.lcCollab} (${r.lcCollab > r.flatCollab ? '+' : ''}${r.lcCollab - r.flatCollab}), Flows ${r.flatFlows}→${r.lcFlows}`);
    });
}

// Cross-phase stats
const withCrossPhase = valid.filter(r => r.lcCrossPhase > 0);
const totalCrossPhase = withCrossPhase.reduce((s, r) => s + r.lcCrossPhase, 0);
console.log(`\nProjects with cross-phase edges: ${withCrossPhase.length}`);
console.log(`Total cross-phase edges: ${totalCrossPhase}`);

const elapsed = ((Date.now() - startTime) / 1000 / 60).toFixed(1);
console.log(`\nTotal time: ${elapsed} minutes`);
