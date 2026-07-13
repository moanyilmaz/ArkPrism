/**
 * Debug IFDS on HapBench Aliasing/After.
 * Patches DataflowSolver.doSolve to add verbose logging.
 */
const { Scene, SceneConfig } = require('../dist/arkanalyzer');
const { runHapflowAnalysis } = require('../dist/hapflowRunner');

const TEST_DIR = 'D:/Projects/Argus-0703/hapflow_artifact/HapBench/Aliasing/After';
const SDK_PATH = 'E:/OpenHarmony_SDK/20/ets';

const sceneConfig = new SceneConfig();
sceneConfig.buildFromProjectDir(TEST_DIR);
const scene = new Scene();
scene.buildSceneFromProjectDir(sceneConfig);

// Print scene info
console.log('=== Scene Info ===');
console.log('Files:', scene.getFiles().map(f => f.getFilePath()).join(', '));

// Print methods and their CFGs
const methods = scene.getMethods();
console.log(`\nMethods: ${methods.length}`);
for (const m of methods) {
    const cfg = m.getCfg();
    const stmts = cfg ? cfg.getStmts() : [];
    console.log(`  ${m.getSignature().toString()}: ${stmts.length} stmts`);
    if (stmts.length < 20) {
        for (const s of stmts) {
            const methodSig = s.getCfg()?.getDeclaringMethod()?.getSignature()?.toString() || '?';
            console.log(`    [${methodSig}] ${s.toString().substring(0, 120)}`);
        }
    }
}

// Print DummyMain
const dummyMain = methods.find(m => m.getSignature().toString().includes('dummyMain'));
if (dummyMain) {
    const cfg = dummyMain.getCfg();
    const stmts = cfg ? [...cfg.getStmts()] : [];
    console.log(`\n=== DummyMain (${stmts.length} stmts) ===`);
    for (const s of stmts) {
        const children = [...(cfg?.getNextStmts(s) || [])];
        console.log(`  ${s.toString().substring(0, 120)}  -> [${children.map(c => c.toString().substring(0, 60)).join(', ')}]`);
    }
}

// Run analysis
console.log('\n=== Running Analysis ===');
const taintFlows = runHapflowAnalysis(scene, {
    sdkPath: SDK_PATH,
    noPta: true,
    noLifecycle: false,
    callbackAnalysis: true,
    ifdsTimeoutMs: 60000,
});

console.log(`\nTaint flows found: ${taintFlows.length}`);
