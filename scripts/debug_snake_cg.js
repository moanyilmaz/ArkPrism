/**
 * Debug: check CG and IFDS on a real project (Snake_NEXT-main)
 */
const { Scene, SceneConfig } = require('../dist/arkanalyzer');
const { buildCallGraph } = require('../dist/callGraphBuilder');
const { LifecycleModeler } = require('../dist/lifecycleModeler');
const { buildLifecycleDummyMain } = require('../dist/lifecycleDummyMain');
const { ClassHierarchyAnalysis } = require('../dist/arkanalyzer');

const PROJECT_DIR = 'D:/argus-dataset/all-1015/ARGUS-successful-1015-samples-20260617/Snake_NEXT-main';

const sceneConfig = new SceneConfig();
sceneConfig.buildFromProjectDir(PROJECT_DIR);
const scene = new Scene();
scene.buildSceneFromProjectDir(sceneConfig);

// Build lifecycle model and DummyMain
const lifecycleModeler = new LifecycleModeler(scene);
const lifecycleModel = lifecycleModeler.buildModel();

console.log(`=== Lifecycle Model ===`);
console.log(`Abilities: ${lifecycleModel.abilities.length}, Components: ${lifecycleModel.components.length}, Callbacks: ${lifecycleModel.callbacks.length}`);
console.log(`Entry methods: ability=${lifecycleModel.entryMethodsByLayer.ability.length}, component=${lifecycleModel.entryMethodsByLayer.component.length}, callback=${lifecycleModel.entryMethodsByLayer.callback.length}`);

const { dummyMain } = buildLifecycleDummyMain(scene, lifecycleModel);

// Print DummyMain
const cfg = dummyMain.getCfg();
if (cfg) {
    const stmts = [...cfg.getStmts()];
    console.log(`\n=== DummyMain (${stmts.length} stmts) ===`);
    // Print first 30 stmts
    for (let i = 0; i < Math.min(30, stmts.length); i++) {
        console.log(`  [${i}] ${stmts[i].toString().substring(0, 120)}`);
    }
    if (stmts.length > 30) console.log(`  ... and ${stmts.length - 30} more`);
}

// Build CG
const callGraph = buildCallGraph(scene);
console.log(`\n=== CG: ${callGraph.getNodeNum()} nodes ===`);

// Check: does CG have onCreate?
const methods = scene.getMethods();
let onCreateInCG = false;
let cgMethodSigs = new Set();
const nodes = callGraph.getNodes();
for (const node of nodes) {
    const sig = callGraph.getMethodByFuncID(node.getID());
    if (sig) cgMethodSigs.add(sig.toString());
}

for (const m of methods) {
    const sig = m.getSignature().toString();
    const inCG = cgMethodSigs.has(sig);
    if (m.getName().includes('onCreate') || m.getName().includes('aboutToAppear') || m.getName().includes('build') || m.getName().includes('onClick')) {
        console.log(`  ${inCG ? 'IN' : 'NOT IN'} CG: ${sig.substring(0, 100)}`);
        if (m.getName().includes('onCreate')) onCreateInCG = true;
    }
}

// Total methods in scene vs CG
console.log(`\nScene methods: ${methods.length}, CG methods: ${cgMethodSigs.size}`);
