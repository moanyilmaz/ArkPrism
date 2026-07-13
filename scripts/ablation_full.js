/**
 * Full ablation: Flat (no lifecycle) vs Lifecycle-enhanced (Level 2)
 * Runs on ALL 1015 projects, but in fast mode (skip 0-flow projects)
 * Collects: taint flows, collab behaviors, CG nodes, IFDS edges
 */
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const DATASET = 'D:/argus-dataset/all-1015/ARGUS-successful-1015-samples-20260617';
const ARKPRISM = 'node dist/arkprism.js';
const CWD = 'D:/Projects/Argus-0703/ArkPrism';
const OUTPUT_DIR = 'D:/Projects/Argus-0703/ArkPrism/ablation_results';

// Create output directory
if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

const projects = fs.readdirSync(DATASET).filter(p => {
    return fs.statSync(path.join(DATASET, p)).isDirectory();
});

console.log(`Found ${projects.length} projects. Running full ablation...`);

const results = [];
let skipped = 0;
const startTime = Date.now();

for (let i = 0; i < projects.length; i++) {
    const proj = projects[i];
    const projPath = path.join(DATASET, proj);

    // Progress every 50 projects
    if (i % 50 === 0) {
        const elapsed = ((Date.now() - startTime) / 1000 / 60).toFixed(1);
        console.log(`\n[Progress] ${i}/${projects.length} (${elapsed}min elapsed, ${results.length} with results, ${skipped} skipped)`);
    }

    let flatFlows = -1, lcFlows = -1;
    let flatIfds = -1, lcIfds = -1;
    let flatCollab = -1, lcCollab = -1;
    let flatCGNodes = -1, lcCGNodes = -1;
    let flatEdges = -1, lcEdges = -1;

    // Phase 1: Quick scan with lifecycle (to skip 0-flow projects)
    try {
        const out2 = execSync(
            `${ARKPRISM} "${projPath}" --no-pta --lifecycle-level 2 --no-dot`,
            { cwd: CWD, timeout: 300000, encoding: 'utf8', stdio: ['pipe','pipe','pipe'] }
        );
        const m2 = out2.match(/Taint flows detected:\s*(\d+)/);
        lcFlows = m2 ? parseInt(m2[1]) : 0;
        const ifds2 = out2.match(/flows=(\d+), edges/);
        lcIfds = ifds2 ? parseInt(ifds2[1]) : 0;
        const collab2 = out2.match(/Collab\.\s+behaviors found:\s*(\d+)/);
        lcCollab = collab2 ? parseInt(collab2[1]) : 0;
        const cg2 = out2.match(/CG ready \(nodes=(\d+)\)/);
        lcCGNodes = cg2 ? parseInt(cg2[1]) : 0;
        const edges2 = out2.match(/totalEdges=(\d+)/);
        lcEdges = edges2 ? parseInt(edges2[1]) : 0;
    } catch (e) {
        // Skip failed projects
        skipped++;
        continue;
    }

    // Skip 0-flow, 0-collab projects
    if (lcFlows === 0 && lcCollab === 0) {
        skipped++;
        results.push({ proj, flatFlows: 0, lcFlows: 0, flatIfds: 0, lcIfds: 0, flatCollab: 0, lcCollab: 0, flatCGNodes: 0, lcCGNodes: 0, flatEdges: 0, lcEdges: 0 });
        continue;
    }

    // Phase 2: Run flat mode for comparison
    try {
        const out1 = execSync(
            `${ARKPRISM} "${projPath}" --no-pta --no-lifecycle --no-dot`,
            { cwd: CWD, timeout: 300000, encoding: 'utf8', stdio: ['pipe','pipe','pipe'] }
        );
        const m1 = out1.match(/Taint flows detected:\s*(\d+)/);
        flatFlows = m1 ? parseInt(m1[1]) : 0;
        const ifds1 = out1.match(/flows=(\d+), edges/);
        flatIfds = ifds1 ? parseInt(ifds1[1]) : 0;
        const collab1 = out1.match(/Collab\.\s+behaviors found:\s*(\d+)/);
        flatCollab = collab1 ? parseInt(collab1[1]) : 0;
        const cg1 = out1.match(/CG ready \(nodes=(\d+)\)/);
        flatCGNodes = cg1 ? parseInt(cg1[1]) : 0;
        const edges1 = out1.match(/totalEdges=(\d+)/);
        flatEdges = edges1 ? parseInt(edges1[1]) : 0;
    } catch (e) {
        flatFlows = -1;
    }

    if (flatFlows >= 0) {
        results.push({ proj, flatFlows, lcFlows, flatIfds, lcIfds, flatCollab, lcCollab, flatCGNodes, lcCGNodes, flatEdges, lcEdges });
        const diffFlows = lcFlows - flatFlows;
        const diffCollab = lcCollab - flatCollab;
        if (diffFlows !== 0 || diffCollab !== 0) {
            console.log(`  ${proj}: Flows ${flatFlows}→${lcFlows} (${diffFlows>0?'+':''}${diffFlows}), Collab ${flatCollab}→${lcCollab} (${diffCollab>0?'+':''}${diffCollab})`);
        }
    }
}

// Save full results
fs.writeFileSync(path.join(OUTPUT_DIR, 'full_ablation.json'), JSON.stringify(results, null, 2));

// Summary
console.log('\n\n=== FULL ABLATION SUMMARY ===');
const valid = results.filter(r => r.flatFlows >= 0);
const withFlows = valid.filter(r => r.lcFlows > 0 || r.flatFlows > 0);
const withCollabDiff = valid.filter(r => r.lcCollab !== r.flatCollab);
const withFlowDiff = valid.filter(r => r.lcFlows !== r.flatFlows);

const totalFlatFlows = valid.reduce((s, r) => s + r.flatFlows, 0);
const totalLCFlows = valid.reduce((s, r) => s + r.lcFlows, 0);
const totalFlatCollab = valid.reduce((s, r) => s + r.flatCollab, 0);
const totalLCCollab = valid.reduce((s, r) => s + r.lcCollab, 0);

console.log(`Projects tested: ${valid.length}`);
console.log(`Projects with flows: ${withFlows.length}`);
console.log(`Projects with different taint flows: ${withFlowDiff.length}`);
console.log(`Projects with different collab behaviors: ${withCollabDiff.length}`);
console.log(`\nTotal taint flows: Flat=${totalFlatFlows}, LC=${totalLCFlows} (${totalLCFlows > totalFlatFlows ? '+' : ''}${totalLCFlows - totalFlatFlows})`);
console.log(`Total collab behaviors: Flat=${totalFlatCollab}, LC=${totalLCCollab} (${totalLCCollab > totalFlatCollab ? '+' : ''}${totalLCCollab - totalFlatCollab})`);

// CG stats
const validCG = valid.filter(r => r.flatCGNodes > 0 && r.lcCGNodes > 0);
const avgCGIncrease = validCG.length > 0 ?
    validCG.reduce((sum, r) => sum + (r.lcCGNodes - r.flatCGNodes) / r.flatCGNodes, 0) / validCG.length * 100 : 0;
console.log(`Average CG node increase: ${avgCGIncrease.toFixed(1)}%`);

// IFDS edge stats
const validEdges = valid.filter(r => r.flatEdges > 0 && r.lcEdges > 0);
const avgEdgeIncrease = validEdges.length > 0 ?
    validEdges.reduce((sum, r) => sum + (r.lcEdges - r.flatEdges) / r.flatEdges, 0) / validEdges.length * 100 : 0;
console.log(`Average IFDS edge increase: ${avgEdgeIncrease.toFixed(1)}%`);

if (withCollabDiff.length > 0) {
    console.log('\nProjects with collab behavior differences:');
    withCollabDiff.forEach(r => console.log(`  ${r.proj}: Flat=${r.flatCollab}, LC=${r.lcCollab} (${r.lcCollab > r.flatCollab ? '+' : ''}${r.lcCollab - r.flatCollab})`));
}

const elapsed = ((Date.now() - startTime) / 1000 / 60).toFixed(1);
console.log(`\nTotal time: ${elapsed} minutes`);
