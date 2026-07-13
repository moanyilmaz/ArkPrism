/**
 * Ablation: Flat (no lifecycle) vs Lifecycle-enhanced (Level 2)
 * Compares taint flow counts and multiSourceCollaborations.
 */
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const DATASET = 'D:/argus-dataset/all-1015/ARGUS-successful-1015-samples-20260617';
const ARKPRISM = 'node dist/arkprism.js';
const CWD = 'D:/Projects/Argus-0703/ArkPrism';
const MAX_PROJECTS = 50;

// Get project list - use projects that are likely to have flows
const projects = fs.readdirSync(DATASET).filter(p => {
    const pp = path.join(DATASET, p);
    return fs.statSync(pp).isDirectory();
});

console.log(`Found ${projects.length} projects, testing first ${MAX_PROJECTS}...`);

const results = [];

for (let i = 0; i < Math.min(projects.length, MAX_PROJECTS); i++) {
    const proj = projects[i];
    const projPath = path.join(DATASET, proj);
    console.log(`\n[${i+1}/${MAX_PROJECTS}] ${proj}`);

    let flatFlows = -1, lcFlows = -1;
    let flatIfds = -1, lcIfds = -1;
    let flatCallback = -1, lcCallback = -1;
    let flatCollab = -1, lcCollab = -1;
    let flatCGNodes = -1, lcCGNodes = -1;
    let lcCrossPhase = 0;

    // Flat (no lifecycle)
    try {
        const out1 = execSync(
            `${ARKPRISM} "${projPath}" --no-pta --no-lifecycle --no-dot`,
            { cwd: CWD, timeout: 300000, encoding: 'utf8', stdio: ['pipe','pipe','pipe'] }
        );
        const m1 = out1.match(/Taint flows detected:\s*(\d+)/);
        flatFlows = m1 ? parseInt(m1[1]) : 0;
        const ifds1 = out1.match(/flows=(\d+), edges/);
        flatIfds = ifds1 ? parseInt(ifds1[1]) : 0;
        const cb1 = out1.match(/Callback analysis complete:.*flows=(\d+)/);
        flatCallback = cb1 ? parseInt(cb1[1]) : 0;
        const collab1 = out1.match(/Collab\.\s+behaviors found:\s*(\d+)/);
        flatCollab = collab1 ? parseInt(collab1[1]) : 0;
        const cg1 = out1.match(/CG ready \(nodes=(\d+)\)/);
        flatCGNodes = cg1 ? parseInt(cg1[1]) : 0;
    } catch (e) {
        console.log(`  FLAT FAILED: ${e.message?.substring(0, 80)}`);
    }

    // Lifecycle-enhanced (Level 2)
    try {
        const out2 = execSync(
            `${ARKPRISM} "${projPath}" --no-pta --lifecycle-level 2 --no-dot`,
            { cwd: CWD, timeout: 300000, encoding: 'utf8', stdio: ['pipe','pipe','pipe'] }
        );
        const m2 = out2.match(/Taint flows detected:\s*(\d+)/);
        lcFlows = m2 ? parseInt(m2[1]) : 0;
        const ifds2 = out2.match(/flows=(\d+), edges/);
        lcIfds = ifds2 ? parseInt(ifds2[1]) : 0;
        const cb2 = out2.match(/Callback analysis complete:.*flows=(\d+)/);
        lcCallback = cb2 ? parseInt(cb2[1]) : 0;
        const collab2 = out2.match(/Collab\.\s+behaviors found:\s*(\d+)/);
        lcCollab = collab2 ? parseInt(collab2[1]) : 0;
        const cg2 = out2.match(/CG ready \(nodes=(\d+)\)/);
        lcCGNodes = cg2 ? parseInt(cg2[1]) : 0;
        const cp = out2.match(/(\d+) cross-phase edges/);
        lcCrossPhase = cp ? parseInt(cp[1]) : 0;
    } catch (e) {
        console.log(`  LC FAILED: ${e.message?.substring(0, 80)}`);
    }

    if (flatFlows >= 0 || lcFlows >= 0) {
        results.push({ proj, flatFlows, lcFlows, flatIfds, lcIfds, flatCallback, lcCallback, flatCollab, lcCollab, flatCGNodes, lcCGNodes, lcCrossPhase });
        const diffFlows = lcFlows - flatFlows;
        const diffCollab = lcCollab - flatCollab;
        const flowStr = diffFlows !== 0 ? `${diffFlows > 0 ? '+' : ''}${diffFlows}` : '=';
        const collabStr = diffCollab !== 0 ? `${diffCollab > 0 ? '+' : ''}${diffCollab}` : '=';
        if (diffFlows !== 0 || diffCollab !== 0) {
            console.log(`  Flat: ${flatFlows} (IFDS=${flatIfds}, CB=${flatCallback}, Collab=${flatCollab}, CG=${flatCGNodes}) | LC: ${lcFlows} (IFDS=${lcIfds}, CB=${lcCallback}, Collab=${lcCollab}, CG=${lcCGNodes}, CP=${lcCrossPhase}) | Flows:${flowStr} Collab:${collabStr}`);
        } else {
            console.log(`  Both: ${flatFlows} flows, ${flatCollab} collab, CG=${flatCGNodes}/${lcCGNodes}`);
        }
    }
}

// Summary
console.log('\n\n=== ABLATION SUMMARY: Flat vs Lifecycle-Enhanced ===');
const withFlowDiff = results.filter(r => r.lcFlows !== r.flatFlows);
const withCollabDiff = results.filter(r => r.lcCollab !== r.flatCollab);
const lcMoreFlows = results.filter(r => r.lcFlows > r.flatFlows);
const lcMoreCollab = results.filter(r => r.lcCollab > r.flatCollab);
const flatMoreFlows = results.filter(r => r.flatFlows > r.lcFlows);

console.log(`Projects tested: ${results.length}`);
console.log(`Projects with different taint flows: ${withFlowDiff.length}`);
console.log(`Projects with different collab behaviors: ${withCollabDiff.length}`);
console.log(`LC has MORE flows: ${lcMoreFlows.length}`);
console.log(`Flat has MORE flows: ${flatMoreFlows.length}`);
console.log(`LC has MORE collab behaviors: ${lcMoreCollab.length}`);

// CG stats
const cgIncreases = results.filter(r => r.lcCGNodes > r.flatCGNodes);
const avgIncrease = cgIncreases.length > 0 ?
    cgIncreases.reduce((sum, r) => sum + (r.lcCGNodes - r.flatCGNodes) / r.flatCGNodes, 0) / cgIncreases.length * 100 : 0;
console.log(`Projects with CG increase: ${cgIncreases.length}/${results.length}`);
console.log(`Average CG increase: ${avgIncrease.toFixed(1)}%`);

// Total flows
const totalFlatFlows = results.reduce((s, r) => s + r.flatFlows, 0);
const totalLCFlows = results.reduce((s, r) => s + r.lcFlows, 0);
const totalFlatCollab = results.reduce((s, r) => s + r.flatCollab, 0);
const totalLCCollab = results.reduce((s, r) => s + r.lcCollab, 0);
console.log(`\nTotal flows: Flat=${totalFlatFlows}, LC=${totalLCFlows}`);
console.log(`Total collab: Flat=${totalFlatCollab}, LC=${totalLCCollab}`);

if (withCollabDiff.length > 0) {
    console.log('\nProjects with collab behavior differences:');
    withCollabDiff.forEach(r => console.log(`  ${r.proj}: Flat=${r.flatCollab}, LC=${r.lcCollab} (${r.lcCollab > r.flatCollab ? '+' : ''}${r.lcCollab - r.flatCollab})`));
}
