/**
 * Debug: run VirtualDispatch1 with both HapFlow original and our code
 */
const { Scene, SceneConfig, DummyMainCreater, PointerAnalysis, PointerAnalysisConfig } = require('../dist/arkanalyzer');
const { TaintAnalysisChecker } = require('../dist/hapflow/TaintAnalysis');
const { TaintAnalysisSolver } = require('../dist/hapflow/TaintAnalysisSolver');

const TEST_DIR = 'D:/Projects/Argus-0703/hapflow_artifact/HapBench/General Language Features/VirtualDispatch1';
const SDK_PATH = 'D:/Projects/Argus-0703/hapflow_artifact/sdk/default/openharmony/ets';

const sdks = [{ name: "ohosSdk", path: SDK_PATH, moduleName: "" }];

const config = new SceneConfig();
config.buildConfig(TEST_DIR, TEST_DIR, sdks);
config.buildFromProjectDir(TEST_DIR);
const scene = new Scene();
scene.buildSceneFromProjectDir(config);
scene.inferTypes();

// Print methods
console.log('=== Methods ===');
for (const m of scene.getMethods()) {
    console.log(`  ${m.getSignature().toString()}`);
}

const creater = new DummyMainCreater(scene);
creater.createDummyMain();
const dummyMain = creater.getDummyMain();

// Print DummyMain
const cfg = dummyMain.getCfg();
const stmts = [...cfg.getStmts()];
console.log(`\n=== DummyMain (${stmts.length} stmts) ===`);
for (const s of stmts) {
    console.log(`  ${s.toString().substring(0, 150)}`);
}

// Run PTA
const ptaConfig = PointerAnalysisConfig.create(1, "./out");
const pta = PointerAnalysis.pointerAnalysisForWholeProject(scene, ptaConfig);

// Configure taint analysis
const problem = new TaintAnalysisChecker(
    [...dummyMain.getCfg().getBlocks()][0].getStmts()[dummyMain.getParameters().length],
    dummyMain,
    pta
);
problem.addSinksFromJson("D:/Projects/Argus-0703/hapflow_artifact/hapflow/tests/resources/sinks.json");
problem.addSourcesFromJson("D:/Projects/Argus-0703/hapflow_artifact/hapflow/tests/resources/sources.json");

console.log(`\nSources: ${problem.getSources().size}, Sinks: ${problem.getSinks().length}`);

const solver = new TaintAnalysisSolver(problem, scene, pta);
solver.solve();

const outcome = problem.getOutcome();
console.log(`\nTaint flows: ${outcome.length}`);
for (const o of outcome) {
    console.log(`  Source: ${o.getSource()?.toString()?.substring(0, 80)}`);
    console.log(`  Sink: ${o.getSink()?.toString()?.substring(0, 80)}`);
}
