/**
 * Debug: check DummyMain, CG nodes, and RTA entry points
 */
const { Scene, SceneConfig } = require('../dist/arkanalyzer');
const { LifecycleModeler } = require('../dist/lifecycleModeler');
const { buildLifecycleDummyMain } = require('../dist/lifecycleDummyMain');

const TEST_DIR = 'D:/Projects/Argus-0703/hapflow_artifact/HapBench/Aliasing/After';
const SDK_PATH = 'E:/OpenHarmony_SDK/20/ets';

const sceneConfig = new SceneConfig();
sceneConfig.buildFromProjectDir(TEST_DIR);
const scene = new Scene();
scene.buildSceneFromProjectDir(sceneConfig);

// Step 1: Build DummyMain
const lifecycleModeler = new LifecycleModeler(scene);
const lifecycleModel = lifecycleModeler.buildModel();
const { dummyMain } = buildLifecycleDummyMain(scene, lifecycleModel);

// Step 2: Print DummyMain CFG
const cfg = dummyMain.getCfg();
if (cfg) {
    const stmts = [...cfg.getStmts()];
    console.log(`=== DummyMain CFG (${stmts.length} stmts) ===`);
    for (const s of stmts) {
        console.log(`  ${s.toString().substring(0, 150)}`);
    }
}

// Step 3: Entry points used by buildCallGraph
const entryPoints = [
    ...lifecycleModel.entryMethodsByLayer.ability,
    ...lifecycleModel.entryMethodsByLayer.component,
    ...lifecycleModel.entryMethodsByLayer.callback,
];
console.log(`\n=== Entry Points for RTA (${entryPoints.length}) ===`);
for (const ep of entryPoints) {
    console.log(`  ${ep.getSignature().toString()}`);
}
for (const method of scene.getMethods()) {
    const name = method.getName();
    if (name === 'constructor' || name === '_DEFAULT_ARK_METHOD') {
        console.log(`  [legacy] ${method.getSignature().toString()}`);
    }
}

// Step 4: Try RTA with different entry point sets
console.log('\n=== RTA experiments ===');

// A: lifecycle entries only
try {
    const cg1 = scene.makeCallGraphRTA(entryPoints.map(m => m.getSignature()));
    console.log(`RTA with lifecycle entries: ${cg1.getNodeNum()} nodes`);
} catch(e) {
    console.log(`RTA with lifecycle entries failed: ${e.message?.substring(0, 100)}`);
}

// B: all methods as entry
const allSigs = scene.getMethods().map(m => m.getSignature());
try {
    const cg2 = scene.makeCallGraphRTA(allSigs);
    console.log(`RTA with ALL methods: ${cg2.getNodeNum()} nodes`);
} catch(e) {
    console.log(`RTA with ALL methods failed: ${e.message?.substring(0, 100)}`);
}

// C: CHA with all methods
try {
    const cg3 = scene.makeCallGraphCHA(allSigs);
    console.log(`CHA with ALL methods: ${cg3.getNodeNum()} nodes`);
} catch(e) {
    console.log(`CHA with ALL methods failed: ${e.message?.substring(0, 100)}`);
}

// D: RTA with just onCreate + constructor + statInit
const keySigs = entryPoints.map(m => m.getSignature());
for (const m of scene.getMethods()) {
    const n = m.getName();
    if (n === 'constructor' || n === '%statInit' || n === '%instInit') {
        if (!keySigs.some(s => s.toString() === m.getSignature().toString())) {
            keySigs.push(m.getSignature());
        }
    }
}
try {
    const cg4 = scene.makeCallGraphRTA(keySigs);
    console.log(`RTA with lifecycle+init entries: ${cg4.getNodeNum()} nodes`);
} catch(e) {
    console.log(`RTA with lifecycle+init entries failed: ${e.message?.substring(0, 100)}`);
}
