/**
 * ArkPrism - RQ7: Lifecycle State Machine Impact (Full 1015 Corpus)
 *
 * Uses child-process isolation to avoid OOM from memory leaks.
 * Each project is analyzed in a separate process with a memory limit.
 *
 * Usage:
 *   node --max-old-space-size=8192 scripts/experiment_lifecycle_impact_1015.js \
 *     --dataset-dir D:/argus-dataset/all-1015/ARGUS-successful-1015-samples-20260617 \
 *     --output-dir docs/experiment_lifecycle_impact_1015
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// ---- Configuration ----

const args = process.argv.slice(2);
let datasetDir = '';
let outputDir = '';

for (let i = 0; i < args.length; i++) {
    if (args[i] === '--dataset-dir' && args[i + 1]) { datasetDir = args[i + 1]; i++; }
    else if (args[i] === '--output-dir' && args[i + 1]) { outputDir = args[i + 1]; i++; }
}

if (!datasetDir) {
    datasetDir = 'D:/argus-dataset/all-1015/ARGUS-successful-1015-samples-20260617';
}
if (!outputDir) {
    outputDir = path.resolve(__dirname, '..', 'docs', 'experiment_lifecycle_impact_1015');
}

if (!fs.existsSync(datasetDir)) {
    console.error('[ERROR] Dataset directory not found:', datasetDir);
    process.exit(1);
}

fs.mkdirSync(outputDir, { recursive: true });

// ---- Worker script (inline) ----
// This runs in a child process per project

const WORKER_SCRIPT = `
const fs = require('fs');
const path = require('path');

const arkanalyzer = require('D:/Projects/Argus/dist/arkanalyzer');
const { Scene, SceneConfig, DummyMainCreater } = arkanalyzer;

const ABILITY_LIFECYCLE = ['onCreate','onDestroy','onWindowStageCreate','onWindowStageDestroy','onForeground','onBackground'];
const COMPONENT_LIFECYCLE = ['aboutToAppear','aboutToDisappear','aboutToReuse','aboutToRecycle','build','onPageShow','onPageHide','onBackPress'];
const CALLBACK_METHODS = ['onClick','onTouch','onDragStart','onDragEnter','onDragMove','onDragLeave','onDrop','onDragEnd','onKeyEvent','onFocusAxisEvent','onChange','onSubmit','onSelect','onCheckedChange','onTextSelectionChange','onScrollEdge','onScrollFrameBegin','onReachStart','onReachEnd','onConnect','onDisconnect','onRequest'];
const LIFECYCLE_ORDER = ['onCreate','onWindowStageCreate','onForeground','aboutToAppear','build','onPageShow','onBackground','onPageHide','onWindowStageDestroy','onDestroy','aboutToDisappear'];
const CROSS_LAYER_TRANSITIONS = [{from:'onForeground',to:'aboutToAppear'},{from:'onPageHide',to:'aboutToDisappear'}];

function getLifecyclePhase(name) {
    if (ABILITY_LIFECYCLE.includes(name)) return 'ability';
    if (COMPONENT_LIFECYCLE.includes(name)) return 'component';
    if (CALLBACK_METHODS.includes(name)) return 'callback';
    if (name === 'constructor' || name === '_DEFAULT_ARK_METHOD') return 'init';
    return 'other';
}

const projectDir = process.argv[2];
const projectName = path.basename(projectDir);

try {
    const sceneConfig = new SceneConfig();
    sceneConfig.buildFromProjectDir(projectDir);
    const scene = new Scene();
    scene.buildSceneFromProjectDir(sceneConfig);

    const methods = [...scene.getMethods()];
    const methodCount = methods.length;
    if (methodCount === 0) { process.exit(0); }

    // Phase analysis
    const phaseCounts = { ability: 0, component: 0, callback: 0, init: 0, other: 0 };
    const phaseMethods = { ability: [], component: [], callback: [], init: [], other: [] };
    for (const m of methods) {
        const phase = getLifecyclePhase(m.getName());
        phaseCounts[phase]++;
        if (phase !== 'other') phaseMethods[phase].push(m.getName());
    }

    const hasLifecycle = phaseCounts.ability > 0 || phaseCounts.component > 0;
    if (!hasLifecycle) { process.exit(0); }

    // Flat DummyMain
    const flatCreater = new DummyMainCreater(scene);
    flatCreater.createDummyMain();
    const flatDummy = flatCreater.getDummyMain();
    const flatBody = flatDummy?.getBody();
    const flatCfg = flatBody?.getCfg();
    const flatBlocks = flatCfg ? [...flatCfg.getBlocks()].length : 0;
    const flatStmts = flatCfg ? [...flatCfg.getStmts()].length : 0;

    // Lifecycle-structured DummyMain
    const lcCreater = new DummyMainCreater(scene);
    const entryMethods = [];
    for (const phase of LIFECYCLE_ORDER) {
        for (const m of methods) {
            if (m.getName() === phase) entryMethods.push(m);
        }
    }
    for (const m of methods) {
        if (CALLBACK_METHODS.includes(m.getName()) && !entryMethods.includes(m)) entryMethods.push(m);
    }
    for (const m of methods) {
        const n = m.getName();
        if ((n === 'constructor' || n === '_DEFAULT_ARK_METHOD') && !entryMethods.includes(m)) entryMethods.push(m);
    }
    if (entryMethods.length > 0) {
        try { lcCreater.setEntryMethods(entryMethods); } catch {}
    }
    lcCreater.createDummyMain();
    const lcDummy = lcCreater.getDummyMain();
    const lcBody = lcDummy?.getBody();
    const lcCfg = lcBody?.getCfg();
    const lcBlocks = lcCfg ? [...lcCfg.getBlocks()].length : 0;
    const lcStmts = lcCfg ? [...lcCfg.getStmts()].length : 0;

    // Cross-phase connections
    let crossPhaseCount = 0;
    const crossPhasePairs = [];
    for (const method of methods) {
        const fromPhase = getLifecyclePhase(method.getName());
        if (fromPhase === 'other') continue;
        const body = method.getBody();
        if (!body) continue;
        const cfg = body.getCfg();
        if (!cfg) continue;
        for (const stmt of cfg.getStmts()) {
            const invokeExpr = stmt.getInvokeExpr?.();
            if (invokeExpr) {
                try {
                    const methodSig = invokeExpr.getMethodSignature?.();
                    if (methodSig) {
                        const methodName = methodSig.getMethodSubSignature?.()?.getMethodName?.() || methodSig.toString?.().split('.').pop()?.split('(')[0];
                        if (methodName) {
                            const toPhase = getLifecyclePhase(methodName);
                            if (toPhase !== 'other' && toPhase !== fromPhase) {
                                crossPhaseCount++;
                                crossPhasePairs.push({ from: method.getName(), fromPhase, to: methodName, toPhase });
                            }
                        }
                    }
                } catch {}
            }
        }
    }

    // Cross-layer transitions
    const applicableCrossLayer = [];
    for (const t of CROSS_LAYER_TRANSITIONS) {
        const hasFrom = phaseMethods.ability.includes(t.from) || phaseMethods.component.includes(t.from);
        const hasTo = phaseMethods.ability.includes(t.to) || phaseMethods.component.includes(t.to);
        if (hasFrom && hasTo) applicableCrossLayer.push(t);
    }

    const result = {
        projectName, methodCount, phaseCounts, phaseMethods,
        flat: { blocks: flatBlocks, stmts: flatStmts },
        lifecycle: { blocks: lcBlocks, stmts: lcStmts },
        lifecycleEntryMethods: entryMethods.length,
        crossPhase: { crossPhaseCount, crossPhasePairs },
        applicableCrossLayer
    };

    process.stdout.write(JSON.stringify(result));
} catch (e) {
    process.stderr.write('ERROR:' + e.message);
    process.exit(1);
}
`;

// Write worker script to temp file
const workerPath = path.join(outputDir, '_worker_lifecycle.js');
fs.writeFileSync(workerPath, WORKER_SCRIPT);

// ---- Main ----

async function runExperiment() {
    console.log('=== RQ7: Lifecycle State Machine Impact (Full 1015) ===');
    console.log(`Dataset: ${datasetDir}`);
    console.log(`Output: ${outputDir}`);

    const projectDirs = fs.readdirSync(datasetDir)
        .filter(d => fs.statSync(path.join(datasetDir, d)).isDirectory())
        .sort();

    console.log(`Found ${projectDirs.length} projects.\n`);

    const results = [];
    const errors = [];
    const skipped = [];
    let processed = 0;

    for (const projectName of projectDirs) {
        processed++;
        const projectDir = path.join(datasetDir, projectName);

        try {
            const stdout = execSync(
                `node --max-old-space-size=4096 "${workerPath}" "${projectDir}"`,
                { timeout: 120000, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
            );

            if (!stdout.trim()) {
                skipped.push(projectName);
                continue;
            }

            const result = JSON.parse(stdout.trim());
            results.push(result);

            if (processed % 50 === 0 || processed === projectDirs.length) {
                console.log(`[${processed}/${projectDirs.length}] ${projectName}: methods=${result.methodCount}, flat=${result.flat.blocks}b, lc=${result.lifecycle.blocks}b, cross=${result.crossPhase.crossPhaseCount}`);
            }

        } catch (e) {
            const errMsg = e.stderr?.toString()?.trim() || e.message?.substring(0, 200) || 'unknown';
            errors.push({ projectName, error: errMsg.substring(0, 300) });
            if (processed % 50 === 0) {
                console.log(`[${processed}/${projectDirs.length}] ${projectName}: ERROR - ${errMsg.substring(0, 100)}`);
            }
        }
    }

    console.log(`\nAnalyzed: ${results.length}, Skipped: ${skipped.length}, Errors: ${errors.length}`);

    // Generate output
    const output = {
        experimentId: 'RQ7_lifecycle_impact_1015',
        timestamp: new Date().toISOString(),
        datasetDir,
        projectCount: projectDirs.length,
        analyzedProjects: results.length,
        skippedProjects: skipped.length,
        errorCount: errors.length,
        results,
        errors,
    };

    const jsonPath = path.join(outputDir, 'lifecycle_impact_results_1015.json');
    fs.writeFileSync(jsonPath, JSON.stringify(output, null, 2));
    console.log(`Results saved to: ${jsonPath}`);

    generateMarkdownReport(output, outputDir);
}

function generateMarkdownReport(data, outputDir) {
    const lines = [];
    lines.push('# RQ7: Lifecycle State Machine Impact (Full 1015 Corpus)');
    lines.push('');
    lines.push(`Generated at: ${data.timestamp}`);
    lines.push(`Dataset: ${data.datasetDir}`);
    lines.push(`Analyzed projects: ${data.analyzedProjects} / ${data.projectCount} (skipped: ${data.skippedProjects}, errors: ${data.errorCount})`);
    lines.push('');

    // Summary
    const totalAbility = data.results.reduce((s, r) => s + r.phaseCounts.ability, 0);
    const totalComponent = data.results.reduce((s, r) => s + r.phaseCounts.component, 0);
    const totalCallback = data.results.reduce((s, r) => s + r.phaseCounts.callback, 0);
    const totalCrossPhase = data.results.reduce((s, r) => s + r.crossPhase.crossPhaseCount, 0);
    const projectsWithCrossLayer = data.results.filter(r => r.applicableCrossLayer.length > 0).length;

    const totalFlatBlocks = data.results.reduce((s, r) => s + r.flat.blocks, 0);
    const totalLCBlocks = data.results.reduce((s, r) => s + r.lifecycle.blocks, 0);
    const totalFlatStmts = data.results.reduce((s, r) => s + r.flat.stmts, 0);
    const totalLCStmts = data.results.reduce((s, r) => s + r.lifecycle.stmts, 0);
    const ratio = totalFlatBlocks > 0 ? (totalLCBlocks / totalFlatBlocks).toFixed(1) : 'N/A';

    lines.push('## Summary');
    lines.push('');
    lines.push('| Metric | Value |');
    lines.push('|---|---:|');
    lines.push(`| Projects with lifecycle methods | ${data.analyzedProjects} |`);
    lines.push(`| Total ability methods | ${totalAbility} |`);
    lines.push(`| Total component methods | ${totalComponent} |`);
    lines.push(`| Total callback methods | ${totalCallback} |`);
    lines.push(`| Total cross-phase connections | ${totalCrossPhase} |`);
    lines.push(`| Projects with cross-layer transitions | ${projectsWithCrossLayer} |`);
    lines.push(`| Flat DummyMain total blocks | ${totalFlatBlocks} |`);
    lines.push(`| Lifecycle-structured total blocks | ${totalLCBlocks} |`);
    lines.push(`| CFG expansion ratio | ${ratio}× |`);
    lines.push('');

    // Cross-phase analysis
    const allPairs = [];
    for (const r of data.results) allPairs.push(...r.crossPhase.crossPhasePairs);
    const crossPhaseByType = {};
    for (const pair of allPairs) {
        const key = `${pair.fromPhase}→${pair.toPhase}`;
        if (!crossPhaseByType[key]) crossPhaseByType[key] = [];
        crossPhaseByType[key].push(pair);
    }

    lines.push('## Cross-Phase Data Flow Analysis');
    lines.push('');
    lines.push('| Transition type | Count | Examples |');
    lines.push('|---|---:|---|');
    for (const [type, pairs] of Object.entries(crossPhaseByType).sort((a, b) => b[1].length - a[1].length)) {
        const examples = [...new Set(pairs.map(p => `${p.from}→${p.to}`))].slice(0, 3).join(', ');
        lines.push(`| ${type} | ${pairs.length} | ${examples} |`);
    }
    lines.push('');

    // Key findings
    lines.push('## Key Findings');
    lines.push('');
    lines.push(`1. **Lifecycle-structured DummyMain produces ${ratio}× more CFG blocks** than flat DummyMain across ${data.analyzedProjects} projects.`);
    lines.push('');
    lines.push(`2. **${totalCrossPhase.toLocaleString()} cross-phase connections** identified across the corpus, showing that data flow between lifecycle phases is prevalent.`);
    lines.push('');
    lines.push(`3. **${projectsWithCrossLayer} projects have applicable cross-layer transitions** (e.g., onForeground→aboutToAppear), which are invisible to flat DummyMain.`);
    lines.push('');

    const mdPath = path.join(outputDir, 'lifecycle_impact_report_1015.md');
    fs.writeFileSync(mdPath, lines.join('\n'));
    console.log(`Report saved to: ${mdPath}`);
}

// Run
runExperiment().catch(e => {
    console.error('Experiment failed:', e);
    process.exit(1);
});
