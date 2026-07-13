/**
 * Debug: run full analysis on Snake_NEXT-main with verbose IFDS logging
 */
const { Scene, SceneConfig } = require('../dist/arkanalyzer');
const { runHapflowAnalysis } = require('../dist/hapflowRunner');

const PROJECT_DIR = 'D:/argus-dataset/all-1015/ARGUS-successful-1015-samples-20260617/Snake_NEXT-main';
const SDK_PATH = 'E:/OpenHarmony_SDK/20/ets';

const sceneConfig = new SceneConfig();
sceneConfig.buildFromProjectDir(PROJECT_DIR);
const scene = new Scene();
scene.buildSceneFromProjectDir(sceneConfig);

const taintFlows = runHapflowAnalysis(scene, {
    sdkPath: SDK_PATH,
    noPta: true,
    noLifecycle: false,
    callbackAnalysis: false,  // Disable callback to see IFDS-only results
    ifdsTimeoutMs: 180000,
});

console.log(`\nIFDS-only taint flows: ${taintFlows.length}`);
