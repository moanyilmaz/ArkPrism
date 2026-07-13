/**
 * Quick 4-mode test on a single project.
 */
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const BASE_DIR = 'D:/argus-dataset/all-1015/ARGUS-successful-1015-samples-20260617';
const PROJECTS = ['Snake_NEXT-main', 'Wechat_HarmonyOS', 'Bluetooth'];

const RUNNER = path.join(__dirname, 'quick_4mode_single.js');
const runnerScript = `
const { Scene, SceneConfig } = require('../dist/arkanalyzer');
const { runHapflowAnalysis } = require('../dist/hapflowRunner');

const projectDir = process.argv[2];
const mode = process.argv[3];
const sdkPath = process.argv[4];

const sceneConfig = new SceneConfig();
sceneConfig.buildFromProjectDir(projectDir);
const scene = new Scene();
scene.buildSceneFromProjectDir(sceneConfig);

let opts;
switch (mode) {
    case 'hapflow-native':
        opts = { sdkPath, noPta: true, noLifecycle: true, callbackAnalysis: false, ifdsTimeoutMs: 180000 };
        break;
    case 'hapflow-cb':
        opts = { sdkPath, noPta: true, noLifecycle: true, callbackAnalysis: true, ifdsTimeoutMs: 180000 };
        break;
    case 'arkprism-lifecycle':
        opts = { sdkPath, noPta: true, noLifecycle: false, callbackAnalysis: false, ifdsTimeoutMs: 180000 };
        break;
    case 'arkprism-full':
        opts = { sdkPath, noPta: true, noLifecycle: false, callbackAnalysis: true, ifdsTimeoutMs: 180000 };
        break;
}

const taintFlows = runHapflowAnalysis(scene, opts);
console.log(JSON.stringify({ taintFlows: taintFlows.length }));
`;
fs.writeFileSync(RUNNER, runnerScript);

const modes = [
    { key: 'hapflow-native', label: 'HapFlow-native' },
    { key: 'hapflow-cb', label: 'HapFlow+CB' },
    { key: 'arkprism-lifecycle', label: 'ArkPrism-LC' },
    { key: 'arkprism-full', label: 'ArkPrism-full' },
];

for (const proj of PROJECTS) {
    const projectDir = path.join(BASE_DIR, proj);
    if (!fs.existsSync(projectDir)) {
        console.log(`[SKIP] ${proj} - not found`);
        continue;
    }

    const row = { project: proj };
    for (const mode of modes) {
        try {
            const output = execSync(
                `node "${RUNNER}" "${projectDir}" ${mode.key} "E:/OpenHarmony_SDK/20/ets"`,
                { timeout: 300000, maxBuffer: 10 * 1024 * 1024, stdio: ['pipe', 'pipe', 'pipe'] }
            );
            const stdout = output.toString().trim();
            const lines = stdout.split('\n');
            let jsonLine = '';
            for (let i = lines.length - 1; i >= 0; i--) {
                try { JSON.parse(lines[i]); jsonLine = lines[i]; break; } catch {}
            }
            row[mode.key] = jsonLine ? JSON.parse(jsonLine).taintFlows : -1;
        } catch (e) {
            row[mode.key] = -1;
        }
    }
    console.log(`${proj.padEnd(35)} HapNative=${String(row['hapflow-native']).padStart(5)} Hap+CB=${String(row['hapflow-cb']).padStart(5)} Ark-LC=${String(row['arkprism-lifecycle']).padStart(5)} Ark-Full=${String(row['arkprism-full']).padStart(5)}`);
}

try { fs.unlinkSync(RUNNER); } catch {}
