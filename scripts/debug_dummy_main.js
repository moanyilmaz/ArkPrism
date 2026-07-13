/**
 * Debug: print DummyMain content and CG structure for Aliasing/After.
 */
const { Scene, SceneConfig } = require('../dist/arkanalyzer');
const { buildCallGraph } = require('../dist/callGraphBuilder');

const TEST_DIR = 'D:/Projects/Argus-0703/hapflow_artifact/HapBench/Aliasing/After';
const SDK_PATH = 'E:/OpenHarmony_SDK/20/ets';

const sceneConfig = new SceneConfig();
sceneConfig.buildFromProjectDir(TEST_DIR);
const scene = new Scene();
scene.buildSceneFromProjectDir(sceneConfig);

// Find DummyMain
const methods = scene.getMethods();
const dummyMain = methods.find(m => m.getSignature().toString().includes('dummyMain'));
if (dummyMain) {
    const cfg = dummyMain.getCfg();
    const stmts = cfg ? [...cfg.getStmts()] : [];
    console.log(`=== DummyMain (${stmts.length} stmts) ===`);
    for (const s of stmts) {
        const next = [...(cfg?.getNextStmts(s) || [])];
        console.log(`  ${s.toString().substring(0, 150)}`);
        if (next.length > 0) {
            console.log(`    -> ${next.map(c => c.toString().substring(0, 80)).join(' | ')}`);
        }
    }
} else {
    console.log('No DummyMain found!');
}

// Build the lifecycle-enhanced CG
const callGraph = buildCallGraph(scene);
console.log(`\n=== Call Graph ===`);
console.log(`Nodes: ${callGraph.getNodeCount()}`);

// Print all CG nodes
const cgNodes = callGraph.getNodes();
for (const node of cgNodes) {
    const methodSig = callGraph.getMethodByFuncID(node.getID());
    console.log(`  Node ${node.getID()}: ${methodSig}`);
}

// Print all CG edges
console.log('\n=== CG Edges ===');
for (const node of cgNodes) {
    const outEdges = callGraph.getOutEdges(node.getID());
    for (const edge of outEdges) {
        const srcSig = callGraph.getMethodByFuncID(edge.srcId);
        const tgtSig = callGraph.getMethodByFuncID(edge.tgtId);
        console.log(`  ${srcSig} -> ${tgtSig}`);
    }
}

// List ALL methods in scene
console.log('\n=== All Scene Methods ===');
for (const m of methods) {
    console.log(`  ${m.getSignature().toString()}`);
}
