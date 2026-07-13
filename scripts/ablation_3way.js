/**
 * 3-way ablation: Flat vs Level 1 vs Level 2
 * Runs on projects with known collab/flow differences
 * Goal: isolate whether CG augmentation (L1) or CFG restructuring (L2) drives the improvements
 *
 * Key insight from code:
 *   - Flat mode: --no-lifecycle → basic CG + flat DummyMain
 *   - Level 1: --lifecycle-level 1 → lifecycle-enhanced CG + Level 1 DummyMain (ordered entry)
 *   - Level 2: --lifecycle-level 2 → lifecycle-enhanced CG + Level 2 DummyMain (sequential CFG)
 *
 * CG augmentation (augmentLifecycleEdges) is shared between L1 and L2.
 * Only difference is DummyMain CFG structure.
 */
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const DATASET = 'D:/argus-dataset/all-1015/ARGUS-successful-1015-samples-20260617';
const ARKPRISM = 'node dist/arkprism.js';
const CWD = 'D:/Projects/Argus-0703/ArkPrism';

// Projects with known differences (from full ablation)
const TARGET_PROJECTS = [
    // Collab behavior increases
    'legado-Harmony-main',
    'BikeTravel',
    'Aigis',
    'Application',
    'Snake_NEXT-main',
    'applications_settings',
    'CommonAppDevelopment',
    'QRCodeScan',
    'harmony-next-music-sharing',
    'aloeplayer_ohos',
    // Flow decrease projects
    'readmigo_harmony-app',
    'Wake-HarmonyOS',
    // Zero-diff control
    'AbilityFeature',
    'AbilityFeatureSystem',
];

function runConfig(projPath, args) {
    try {
        const out = execSync(
            `${ARKPRISM} "${projPath}" ${args}`,
            { cwd: CWD, timeout: 300000, encoding: 'utf8', stdio: ['pipe','pipe','pipe'] }
        );
        const flows = out.match(/Taint flows detected:\s*(\d+)/);
        const ifds = out.match(/flows=(\d+), edges/);
        const collab = out.match(/Collab\.\s+behaviors found:\s*(\d+)/);
        const cg = out.match(/CG ready \(nodes=(\d+)\)/);
        const edges = out.match(/totalEdges=(\d+)/);
        const cbFlows = out.match(/CB flows=(\d+)/);
        const blocks = out.match(/blocks[,\s]+(\d+)/i);
        return {
            flows: flows ? parseInt(flows[1]) : 0,
            ifds: ifds ? parseInt(ifds[1]) : 0,
            collab: collab ? parseInt(collab[1]) : 0,
            cgNodes: cg ? parseInt(cg[1]) : 0,
            edges: edges ? parseInt(edges[1]) : 0,
            cbFlows: cbFlows ? parseInt(cbFlows[1]) : 0,
        };
    } catch (e) {
        return null;
    }
}

const results = [];

for (const proj of TARGET_PROJECTS) {
    const projPath = path.join(DATASET, proj);
    if (!fs.existsSync(projPath)) {
        console.log(`${proj} - NOT FOUND, skipping`);
        continue;
    }

    console.log(`\n[${proj}]`);

    // Run all 3 configurations
    const flat = runConfig(projPath, '--no-pta --no-lifecycle --no-dot');
    const l1 = runConfig(projPath, '--no-pta --lifecycle-level 1 --no-dot');
    const l2 = runConfig(projPath, '--no-pta --lifecycle-level 2 --no-dot');

    if (!flat || !l1 || !l2) {
        console.log(`  FAILED: flat=${flat ? 'ok' : 'fail'} l1=${l1 ? 'ok' : 'fail'} l2=${l2 ? 'ok' : 'fail'}`);
        continue;
    }

    const entry = { proj, flat, l1, l2 };

    // Print comparison
    console.log(`  Flat: flows=${flat.flows} ifds=${flat.ifds} collab=${flat.collab} cg=${flat.cgNodes} edges=${flat.edges}`);
    console.log(`  L1:   flows=${l1.flows} ifds=${l1.ifds} collab=${l1.collab} cg=${l1.cgNodes} edges=${l1.edges}`);
    console.log(`  L2:   flows=${l2.flows} ifds=${l2.ifds} collab=${l2.collab} cg=${l2.cgNodes} edges=${l2.edges}`);

    // Key comparisons
    const cgSame = l1.cgNodes === l2.cgNodes;
    const l1VsFlatFlows = l1.flows - flat.flows;
    const l2VsFlatFlows = l2.flows - flat.flows;
    const l2VsL1Flows = l2.flows - l1.flows;
    const l1VsFlatCollab = l1.collab - flat.collab;
    const l2VsL1Collab = l2.collab - l1.collab;

    console.log(`  CG same L1/L2: ${cgSame}`);
    console.log(`  L1 vs Flat: flows ${l1VsFlatFlows>=0?'+':''}${l1VsFlatFlows}, collab ${l1VsFlatCollab>=0?'+':''}${l1VsFlatCollab}`);
    console.log(`  L2 vs L1:   flows ${l2VsL1Flows>=0?'+':''}${l2VsL1Flows}, collab ${l2VsL1Collab>=0?'+':''}${l2VsL1Collab}`);

    results.push(entry);
}

// Summary
console.log('\n\n=== 3-WAY ABLATION SUMMARY ===');
console.log('Project | Flat_Flows | L1_Flows | L2_Flows | Flat_Collab | L1_Collab | L2_Collab | CG_same | L2_vs_L1_Flows | L2_vs_L1_Collab');
console.log('---|---|---|---|---|---|---|---|---|---');

let l1AddsCollab = 0, l2AddsCollab = 0, l1ChangesFlows = 0, l2ChangesFlows = 0;
for (const r of results) {
    const cgSame = r.l1.cgNodes === r.l2.cgNodes;
    const l2VsL1F = r.l2.flows - r.l1.flows;
    const l2VsL1C = r.l2.collab - r.l1.collab;
    const l1VsFlatF = r.l1.flows - r.flat.flows;
    const l1VsFlatC = r.l1.collab - r.flat.collab;

    if (l1VsFlatC !== 0) l1AddsCollab++;
    if (l2VsL1C !== 0) l2AddsCollab++;
    if (l1VsFlatF !== 0) l1ChangesFlows++;
    if (l2VsL1F !== 0) l2ChangesFlows++;

    console.log(`${r.proj} | ${r.flat.flows} | ${r.l1.flows} | ${r.l2.flows} | ${r.flat.collab} | ${r.l1.collab} | ${r.l2.collab} | ${cgSame} | ${l2VsL1F} | ${l2VsL1C}`);
}

console.log(`\nL1 vs Flat: projects with flow changes = ${l1ChangesFlows}, collab changes = ${l1AddsCollab}`);
console.log(`L2 vs L1:   projects with flow changes = ${l2ChangesFlows}, collab changes = ${l2AddsCollab}`);
