/**
 * Focused ablation: Only test projects that have >0 flows
 * Compare Flat (no lifecycle) vs Lifecycle-enhanced (Level 2)
 */
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const DATASET = 'D:/argus-dataset/all-1015/ARGUS-successful-1015-samples-20260617';
const ARKPRISM = 'node dist/arkprism.js';
const CWD = 'D:/Projects/Argus-0703/ArkPrism';

// Use projects from the 66-project annotated dataset
const PROJECTS = [
    'legado-Harmony-main',
    'ArkTSDistributedMusicPlayer',
    'BikeTravel',
    'Aigis',
    'aloeplayer_ohos',
    'AccessibilityExtAbility',
    'AbilityFeature',
    'AbilityFeatureSystem',
    'AdaptiveCapabilities',
    'applications_launcher',
    'Application',
    'harmonyos-WeChat',
    'SepWeather',
    'WeatherMind',
    'weatherApp-ArkTS',
    'Snake_NEXT-main',
    // More projects likely to have flows
    'Chat_Demo',
    'FluentRead',
    'LazyChat',
    'MyNotes',
    'OpenHarmoneyWeather',
    'TodoList_HarmonyOS',
    'harmony-Notes',
    'DailyLife_HarmonyOS',
    'HealthyDiet_HarmonyOS',
    'Shopping_HarmonyOS',
    'Travel_HarmonyOS',
    'Music_HarmonyOS',
    'Movie_HarmonyOS',
    'News_HarmonyOS',
    'Game_HarmonyOS',
    'Education_HarmonyOS',
    'Finance_HarmonyOS',
    'Social_HarmonyOS',
];

console.log(`Testing ${PROJECTS.length} projects...`);

const results = [];

for (let i = 0; i < PROJECTS.length; i++) {
    const proj = PROJECTS[i];
    const projPath = path.join(DATASET, proj);
    if (!fs.existsSync(projPath)) {
        console.log(`\n[${i+1}/${PROJECTS.length}] ${proj} - NOT FOUND, skipping`);
        continue;
    }
    console.log(`\n[${i+1}/${PROJECTS.length}] ${proj}`);

    let flatFlows = -1, lcFlows = -1;
    let flatIfds = -1, lcIfds = -1;
    let flatCollab = -1, lcCollab = -1;
    let flatCGNodes = -1, lcCGNodes = -1;

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
        const collab1 = out1.match(/Collab\.\s+behaviors found:\s*(\d+)/);
        flatCollab = collab1 ? parseInt(collab1[1]) : 0;
        const cg1 = out1.match(/CG ready \(nodes=(\d+)\)/);
        flatCGNodes = cg1 ? parseInt(cg1[1]) : 0;
    } catch (e) {
        console.log(`  FLAT FAILED: ${e.message?.substring(0, 60)}`);
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
        const collab2 = out2.match(/Collab\.\s+behaviors found:\s*(\d+)/);
        lcCollab = collab2 ? parseInt(collab2[1]) : 0;
        const cg2 = out2.match(/CG ready \(nodes=(\d+)\)/);
        lcCGNodes = cg2 ? parseInt(cg2[1]) : 0;
    } catch (e) {
        console.log(`  LC FAILED: ${e.message?.substring(0, 60)}`);
    }

    if (flatFlows >= 0 || lcFlows >= 0) {
        results.push({ proj, flatFlows, lcFlows, flatIfds, lcIfds, flatCollab, lcCollab, flatCGNodes, lcCGNodes });
        const diffFlows = lcFlows - flatFlows;
        const diffCollab = lcCollab - flatCollab;
        const flowStr = diffFlows !== 0 ? `${diffFlows > 0 ? '+' : ''}${diffFlows}` : '=';
        const collabStr = diffCollab !== 0 ? `${diffCollab > 0 ? '+' : ''}${diffCollab}` : '=';
        console.log(`  Flat: ${flatFlows} (IFDS=${flatIfds}, Collab=${flatCollab}, CG=${flatCGNodes}) | LC: ${lcFlows} (IFDS=${lcIfds}, Collab=${lcCollab}, CG=${lcCGNodes}) | Flows:${flowStr} Collab:${collabStr}`);
    }
}

// Summary
console.log('\n\n=== FOCUSED ABLATION SUMMARY ===');
const withFlowDiff = results.filter(r => r.lcFlows !== r.flatFlows);
const withCollabDiff = results.filter(r => r.lcCollab !== r.flatCollab);
console.log(`Projects tested: ${results.length}`);
console.log(`Projects with different taint flows: ${withFlowDiff.length}`);
console.log(`Projects with different collab behaviors: ${withCollabDiff.length}`);

const totalFlatFlows = results.reduce((s, r) => s + r.flatFlows, 0);
const totalLCFlows = results.reduce((s, r) => s + r.lcFlows, 0);
const totalFlatCollab = results.reduce((s, r) => s + r.flatCollab, 0);
const totalLCCollab = results.reduce((s, r) => s + r.lcCollab, 0);
console.log(`Total flows: Flat=${totalFlatFlows}, LC=${totalLCFlows}`);
console.log(`Total collab: Flat=${totalFlatCollab}, LC=${totalLCCollab}`);

if (withCollabDiff.length > 0) {
    console.log('\nProjects with collab behavior differences:');
    withCollabDiff.forEach(r => console.log(`  ${r.proj}: Flat=${r.flatCollab}, LC=${r.lcCollab} (${r.lcCollab > r.flatCollab ? '+' : ''}${r.lcCollab - r.flatCollab})`));
}

// CG stats
const validCG = results.filter(r => r.flatCGNodes > 0 && r.lcCGNodes > 0);
const avgCGIncrease = validCG.length > 0 ?
    validCG.reduce((sum, r) => sum + (r.lcCGNodes - r.flatCGNodes) / r.flatCGNodes, 0) / validCG.length * 100 : 0;
console.log(`\nAverage CG node increase: ${avgCGIncrease.toFixed(1)}%`);
