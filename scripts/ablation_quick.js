/**
 * Quick ablation: Test 30 known projects with flows
 * Compare flat vs lifecycle-enhanced CG
 */
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const DATASET = 'D:/argus-dataset/all-1015/ARGUS-successful-1015-samples-20260617';
const ARKPRISM = 'node dist/arkprism.js';
const CWD = 'D:/Projects/Argus-0703/ArkPrism';

// Known projects with flows (from previous experiments)
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
    'SepWeather',
    'WeatherMind',
    'Snake_NEXT-main',
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
];

console.log(`Testing ${PROJECTS.length} projects...`);

const results = [];
const startTime = Date.now();

for (let i = 0; i < PROJECTS.length; i++) {
    const proj = PROJECTS[i];
    const projPath = path.join(DATASET, proj);
    if (!fs.existsSync(projPath)) {
        console.log(`\n[${i+1}/${PROJECTS.length}] ${proj} - NOT FOUND`);
        continue;
    }
    console.log(`\n[${i+1}/${PROJECTS.length}] ${proj}`);

    let flatCG = 0, lcCG = 0, flatCollab = 0, lcCollab = 0;
    let flatFlows = 0, lcFlows = 0, lcCrossPhase = 0;

    // Flat mode
    try {
        const out1 = execSync(
            `${ARKPRISM} "${projPath}" --no-pta --no-lifecycle --no-dot`,
            { cwd: CWD, timeout: 300000, encoding: 'utf8', stdio: ['pipe','pipe','pipe'] }
        );
        const cg1 = out1.match(/CG ready \(nodes=(\d+)\)/);
        flatCG = cg1 ? parseInt(cg1[1]) : 0;
        const c1 = out1.match(/Collab\.\s+behaviors found:\s*(\d+)/);
        flatCollab = c1 ? parseInt(c1[1]) : 0;
        const f1 = out1.match(/Taint flows detected:\s*(\d+)/);
        flatFlows = f1 ? parseInt(f1[1]) : 0;
    } catch (e) {
        console.log(`  FLAT FAILED`);
    }

    // Lifecycle-enhanced mode
    try {
        const out2 = execSync(
            `${ARKPRISM} "${projPath}" --no-pta --lifecycle-level 2 --no-dot`,
            { cwd: CWD, timeout: 300000, encoding: 'utf8', stdio: ['pipe','pipe','pipe'] }
        );
        const cg2 = out2.match(/CG ready \(nodes=(\d+)\)/);
        lcCG = cg2 ? parseInt(cg2[1]) : 0;
        const c2 = out2.match(/Collab\.\s+behaviors found:\s*(\d+)/);
        lcCollab = c2 ? parseInt(c2[1]) : 0;
        const f2 = out2.match(/Taint flows detected:\s*(\d+)/);
        lcFlows = f2 ? parseInt(f2[1]) : 0;
        const cp = out2.match(/(\d+) cross-phase edges/);
        lcCrossPhase = cp ? parseInt(cp[1]) : 0;
    } catch (e) {
        console.log(`  LC FAILED`);
    }

    const cgPct = flatCG > 0 ? ((lcCG - flatCG) / flatCG * 100).toFixed(1) : 'N/A';
    const diffCollab = lcCollab - flatCollab;
    const diffFlows = lcFlows - flatFlows;

    results.push({ proj, flatCG, lcCG, flatCollab, lcCollab, flatFlows, lcFlows, lcCrossPhase });
    console.log(`  CG ${flatCG}→${lcCG} (+${cgPct}%), Collab ${flatCollab}→${lcCollab} (${diffCollab>0?'+':''}${diffCollab}), Flows ${flatFlows}→${lcFlows} (${diffFlows>0?'+':''}${diffFlows}), CP=${lcCrossPhase}`);
}

// Summary
console.log('\n\n=== QUICK ABLATION SUMMARY ===');
const valid = results.filter(r => r.flatCG > 0 && r.lcCG > 0);
const withFlows = valid.filter(r => r.lcFlows > 0 || r.flatFlows > 0);
const withCollabDiff = valid.filter(r => r.lcCollab !== r.flatCollab);
const withFlowDiff = valid.filter(r => r.lcFlows !== r.flatFlows);

console.log(`Projects tested: ${valid.length}`);
console.log(`Projects with flows: ${withFlows.length}`);
console.log(`Projects with different collab: ${withCollabDiff.length}`);
console.log(`Projects with different flows: ${withFlowDiff.length}`);

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
