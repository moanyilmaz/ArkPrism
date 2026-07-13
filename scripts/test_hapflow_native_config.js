/**
 * Test: Run HapBench Aliasing/After with HapFlow original config
 * - Use HapFlow original sources.json + sinks.json
 * - Enable PTA k=1
 * - No inferTypes (broken in our version)
 */
const { Scene, SceneConfig } = require('../dist/arkanalyzer');
const { DummyMainCreater, PointerAnalysis, PointerAnalysisConfig } = require('../dist/arkanalyzer');
const { TaintAnalysisChecker } = require('../dist/hapflow/TaintAnalysis');
const { TaintAnalysisSolver } = require('../dist/hapflow/TaintAnalysisSolver');

const TEST_DIR = 'D:/Projects/Argus-0703/hapflow_artifact/HapBench/Aliasing/After';
const SDK_PATH = 'D:/Projects/Argus-0703/hapflow_artifact/sdk/default/openharmony/ets';

const sdks = [{
    "name": "ohosSdk",
    "path": SDK_PATH,
    "moduleName": ""
}];

// Build scene exactly like HapFlow original
const config = new SceneConfig();
config.buildConfig(TEST_DIR, TEST_DIR, sdks);
config.buildFromProjectDir(TEST_DIR);
const scene = new Scene();
scene.buildSceneFromProjectDir(config);
scene.inferTypes();

// Create DummyMain exactly like HapFlow original
const creater = new DummyMainCreater(scene);
creater.createDummyMain();
const dummyMain = creater.getDummyMain();

// Run PTA k=1
const ptaConfig = PointerAnalysisConfig.create(1, "./out");
const pta = PointerAnalysis.pointerAnalysisForWholeProject(scene, ptaConfig);

// Configure taint analysis with HapFlow original source/sink
const problem = new TaintAnalysisChecker(
    [...dummyMain.getCfg().getBlocks()][0].getStmts()[dummyMain.getParameters().length],
    dummyMain,
    pta
);
problem.addSinksFromJson("D:/Projects/Argus-0703/hapflow_artifact/hapflow/tests/resources/sinks.json");
problem.addSourcesFromJson("D:/Projects/Argus-0703/hapflow_artifact/hapflow/tests/resources/sources.json");

console.log(`Sources: ${problem.getSources().size}, Sinks: ${problem.getSinks().length}`);

// Run solver
const solver = new TaintAnalysisSolver(problem, scene, pta);
solver.solve();

const outcome = problem.getOutcome();
console.log(`Taint flows: ${outcome.length}`);
