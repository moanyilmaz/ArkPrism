/**
 * Quick test: verify edgeKey fix lets IFDS explore inside onCreate.
 * Runs on HapBench Aliasing/After with verbose logging.
 */
const { Scene, SceneConfig } = require('../dist/arkanalyzer');
const { runHapflowAnalysis } = require('../dist/hapflowRunner');

const TEST_DIR = 'D:/Projects/Argus-0703/hapflow_artifact/HapBench/Aliasing/After';
const SDK_PATH = 'E:/OpenHarmony_SDK/20/ets';

const sceneConfig = new SceneConfig();
sceneConfig.buildFromProjectDir(TEST_DIR);
const scene = new Scene();
scene.buildSceneFromProjectDir(sceneConfig);

const taintFlows = runHapflowAnalysis(scene, {
    sdkPath: SDK_PATH,
    noPta: true,
    noLifecycle: false,
    callbackAnalysis: true,
    ifdsTimeoutMs: 60000,
});

console.log(`\nTaint flows found: ${taintFlows.length}`);
if (taintFlows.length > 0) {
    for (const flow of taintFlows) {
        console.log(`  Flow: ${JSON.stringify(flow).substring(0, 200)}`);
    }
}
