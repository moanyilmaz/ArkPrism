/**
 * Ablation: Level 1 vs Level 2 lifecycle DummyMain
 * Runs both levels on each project and compares taint flow counts.
 */
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const DATASET = 'D:/argus-dataset/all-1015/ARGUS-successful-1015-samples-20260617';
const ARKPRISM = 'node dist/arkprism.js';
const CWD = 'D:/Projects/Argus-0703/ArkPrism';
const MAX_PROJECTS = 30; // Limit for speed

// Get project list
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

    let l1Flows = -1, l2Flows = -1;
    let l1Ifds = -1, l2Ifds = -1;
    let l1Callback = -1, l2Callback = -1;
    let l1Collab = -1, l2Collab = -1;
    let l2CrossPhase = 0;

    // Level 1
    try {
        const out1 = execSync(
            `${ARKPRISM} "${projPath}" --no-pta --lifecycle-level 1 --no-dot`,
            { cwd: CWD, timeout: 300000, encoding: 'utf8', stdio: ['pipe','pipe','pipe'] }
        );
        const m1 = out1.match(/Taint flows detected:\s*(\d+)/);
        l1Flows = m1 ? parseInt(m1[1]) : 0;
        const ifds1 = out1.match(/flows=(\d+), edges/);
        l1Ifds = ifds1 ? parseInt(ifds1[1]) : 0;
        const cb1 = out1.match(/Callback analysis complete:.*flows=(\d+)/);
        l1Callback = cb1 ? parseInt(cb1[1]) : 0;
        const collab1 = out1.match(/Collab\.\s+behaviors found:\s*(\d+)/);
        l1Collab = collab1 ? parseInt(collab1[1]) : 0;
    } catch (e) {
        console.log(`  L1 FAILED: ${e.message?.substring(0, 80)}`);
    }

    // Level 2
    try {
        const out2 = execSync(
            `${ARKPRISM} "${projPath}" --no-pta --lifecycle-level 2 --no-dot`,
            { cwd: CWD, timeout: 300000, encoding: 'utf8', stdio: ['pipe','pipe','pipe'] }
        );
        const m2 = out2.match(/Taint flows detected:\s*(\d+)/);
        l2Flows = m2 ? parseInt(m2[1]) : 0;
        const ifds2 = out2.match(/flows=(\d+), edges/);
        l2Ifds = ifds2 ? parseInt(ifds2[1]) : 0;
        const cb2 = out2.match(/Callback analysis complete:.*flows=(\d+)/);
        l2Callback = cb2 ? parseInt(cb2[1]) : 0;
        const collab2 = out2.match(/Collab\.\s+behaviors found:\s*(\d+)/);
        l2Collab = collab2 ? parseInt(collab2[1]) : 0;
        const cp = out2.match(/(\d+) cross-phase edges/);
        l2CrossPhase = cp ? parseInt(cp[1]) : 0;
    } catch (e) {
        console.log(`  L2 FAILED: ${e.message?.substring(0, 80)}`);
    }

    if (l1Flows >= 0 || l2Flows >= 0) {
        results.push({ proj, l1Flows, l2Flows, l1Ifds, l2Ifds, l1Callback, l2Callback, l1Collab, l2Collab, l2CrossPhase });
        const diff = l2Flows - l1Flows;
        const diffStr = diff > 0 ? `+${diff}` : diff < 0 ? `${diff}` : '=';
        console.log(`  L1: ${l1Flows} (IFDS=${l1Ifds}, CB=${l1Callback}, Collab=${l1Collab}) | L2: ${l2Flows} (IFDS=${l2Ifds}, CB=${l2Callback}, Collab=${l2Collab}, CP=${l2CrossPhase}) | ${diffStr}`);
    }
}

// Summary
console.log('\n\n=== ABLATION SUMMARY ===');
console.log('Project | L1_Flows | L2_Flows | Diff | L1_IFDS | L2_IFDS | L1_Collab | L2_Collab | CrossPhase');
console.log('---|---|---|---|---|---|---|---|---');
results.forEach(r => {
    const diff = r.l2Flows - r.l1Flows;
    console.log(`${r.proj} | ${r.l1Flows} | ${r.l2Flows} | ${diff > 0 ? '+' : ''}${diff} | ${r.l1Ifds} | ${r.l2Ifds} | ${r.l1Collab} | ${r.l2Collab} | ${r.l2CrossPhase}`);
});

// Stats
const withDiff = results.filter(r => r.l2Flows !== r.l1Flows);
const l2More = results.filter(r => r.l2Flows > r.l1Flows);
const l1More = results.filter(r => r.l1Flows > r.l2Flows);
const l2CollabMore = results.filter(r => r.l2Collab > r.l1Collab);
console.log(`\nProjects with different flow counts: ${withDiff.length}/${results.length}`);
console.log(`L2 has MORE flows: ${l2More.length}`);
console.log(`L1 has MORE flows: ${l1More.length}`);
console.log(`L2 has MORE collab behaviors: ${l2CollabMore.length}`);

if (withDiff.length > 0) {
    console.log('\nProjects with differences:');
    withDiff.forEach(r => console.log(`  ${r.proj}: L1=${r.l1Flows}, L2=${r.l2Flows}, IFDS L1=${r.l1Ifds}/L2=${r.l2Ifds}, Collab L1=${r.l1Collab}/L2=${r.l2Collab}`));
}
