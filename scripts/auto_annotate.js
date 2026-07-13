/**
 * Auto-annotate taint flows based on source/sink privacy categories.
 * Then read source code to verify ambiguous cases.
 *
 * Annotation rules:
 * - Source categories:
 *   HIGH_PRIVACY: geoLocation, contacts, SMS, call, account, bluetooth, NFC, USB, wifi, telephony
 *   MEDIUM_PRIVACY: sensor, camera, microphone/media, pasteboard/clipboard, photo/file access, network connection
 *   LOW_PRIVACY: preferences/settings, AppStorage, generic .get()/.set()
 *   NON_PRIVACY: console, process, Map/Array builtins, axios (HTTP library itself)
 *
 * - Sink categories:
 *   HIGH_LEAK: network upload, file write, hilog (public), SMS send, share
 *   MEDIUM_LEAK: console.log/info (debug only, not visible to other apps)
 *   LOW_LEAK: Logger.info (app-internal logging), UI display (Text.create, ForEach)
 *   NON_LEAK: .set() on local storage, AppStorage, assignments
 *
 * - TP rules:
 *   HIGH_PRIVACY → any sink = TP (privacy data should not leave the device)
 *   MEDIUM_PRIVACY → HIGH_LEAK = TP
 *   MEDIUM_PRIVACY → MEDIUM_LEAK = TP (console.log is still a leak in production)
 *   MEDIUM_PRIVACY → LOW_LEAK = FP (internal logging is acceptable)
 *   LOW_PRIVACY → any = FP (preferences/settings are not privacy data)
 *   NON_PRIVACY → any = FP
 *
 * Special cases requiring source code verification:
 * - avPlayer/media callbacks: need to check if callback data contains user content
 * - axios.get: HTTP library itself is not a source, but the response might contain privacy data
 * - .on() callbacks: need to verify if callback parameter is privacy data
 * - preferences.get/set: local storage, not privacy data flow
 */
const fs = require('fs');
const path = require('path');

const inputFile = path.join(__dirname, '..', 'docs', 'comparison_hapflow_vs_arkprism', 'dataset_batch_results.json');
const data = JSON.parse(fs.readFileSync(inputFile, 'utf-8'));

// Privacy classification functions
function classifySource(apiStr) {
    if (!apiStr) return 'UNKNOWN';

    // NON_PRIVACY sources
    if (/\bconsole\b/.test(apiStr)) return 'NON_PRIVACY';
    if (/\bprocess\b/.test(apiStr)) return 'NON_PRIVACY';
    if (/axios\.<.*\.get\(\)/.test(apiStr)) return 'NON_PRIVACY';  // HTTP library, not a source
    if (/\.get\(\)/.test(apiStr) && !/geoLocation|wifi|bluetooth|connection|preferences/.test(apiStr)) return 'NON_PRIVACY';  // generic Map.get etc
    if (/AppStorage\.<.*\.get\(\)/.test(apiStr)) return 'LOW_PRIVACY';
    if (/DataModel\.<.*\.getData\(\)/.test(apiStr)) return 'LOW_PRIVACY';

    // HIGH_PRIVACY sources
    if (/geoLocationManager/.test(apiStr)) return 'HIGH_PRIVACY';
    if (/@ohos\.contact/.test(apiStr)) return 'HIGH_PRIVACY';
    if (/@ohos\.sms/.test(apiStr)) return 'HIGH_PRIVACY';
    if (/@ohos\.call/.test(apiStr)) return 'HIGH_PRIVACY';
    if (/@ohos\.account/.test(apiStr)) return 'HIGH_PRIVACY';
    if (/@ohos\.bluetooth/.test(apiStr)) return 'HIGH_PRIVACY';
    if (/@ohos\.nfc/.test(apiStr)) return 'HIGH_PRIVACY';
    if (/@ohos\.usb/.test(apiStr)) return 'HIGH_PRIVACY';
    if (/wifiManager/.test(apiStr)) return 'HIGH_PRIVACY';
    if (/@ohos\.telephony/.test(apiStr)) return 'HIGH_PRIVACY';

    // MEDIUM_PRIVACY sources
    if (/sensor\.%dflt\.on/.test(apiStr)) return 'MEDIUM_PRIVACY';
    if (/cameraManager/.test(apiStr)) return 'MEDIUM_PRIVACY';
    if (/audioManager/.test(apiStr)) return 'MEDIUM_PRIVACY';
    if (/media\.AVPlayer/.test(apiStr) || /media\.createSoundPool/.test(apiStr)) return 'MEDIUM_PRIVACY';  // media player state
    if (/pasteboard/.test(apiStr)) return 'MEDIUM_PRIVACY';
    if (/photoAccessHelper/.test(apiStr)) return 'MEDIUM_PRIVACY';
    if (/file\.picker/.test(apiStr)) return 'MEDIUM_PRIVACY';
    if (/file\.fs/.test(apiStr)) return 'MEDIUM_PRIVACY';
    if (/net\.connection/.test(apiStr)) return 'MEDIUM_PRIVACY';
    if (/web\.webview/.test(apiStr)) return 'MEDIUM_PRIVACY';
    if (/image\.packing/.test(apiStr)) return 'MEDIUM_PRIVACY';

    // LOW_PRIVACY sources
    if (/preferences/.test(apiStr)) return 'LOW_PRIVACY';
    if (/\.set\(/.test(apiStr) && /key.*objectClass/.test(apiStr)) return 'LOW_PRIVACY';  // local storage set

    // Callback patterns - need special handling
    if (/\.on\(/.test(apiStr)) return 'CALLBACK';

    return 'UNKNOWN';
}

function classifySink(apiStr) {
    if (!apiStr) return 'UNKNOWN';

    // HIGH_LEAK sinks
    if (/hilog/.test(apiStr)) return 'HIGH_LEAK';  // hilog with %{public}s is a real leak
    if (/@ohos\.net\.socket/.test(apiStr)) return 'HIGH_LEAK';
    if (/@ohos\.net\.http/.test(apiStr)) return 'HIGH_LEAK';
    if (/file\.fs.*write/.test(apiStr)) return 'HIGH_LEAK';
    if (/AlertDialog.*show/.test(apiStr)) return 'HIGH_LEAK';  // dialog shows data to user

    // MEDIUM_LEAK sinks
    if (/console\.<.*\.log\(\)/.test(apiStr)) return 'MEDIUM_LEAK';
    if (/console\.<.*\.info\(\)/.test(apiStr)) return 'MEDIUM_LEAK';
    if (/console\.<.*\.error\(\)/.test(apiStr)) return 'MEDIUM_LEAK';

    // LOW_LEAK sinks
    if (/Logger\.<.*\.info\(\)/.test(apiStr)) return 'LOW_LEAK';  // app-internal logger
    if (/Logger\.<.*\.error\(\)/.test(apiStr)) return 'LOW_LEAK';
    if (/Logger\.<.*\.debug\(\)/.test(apiStr)) return 'LOW_LEAK';
    if (/Text\.create\(\)/.test(apiStr)) return 'LOW_LEAK';  // UI display
    if (/ForEach\.create\(\)/.test(apiStr)) return 'LOW_LEAK';
    if (/Image\.create\(\)/.test(apiStr)) return 'LOW_LEAK';
    if (/If\.create\(\)/.test(apiStr)) return 'LOW_LEAK';
    if (/promptAction/.test(apiStr)) return 'LOW_LEAK';

    // NON_LEAK sinks
    if (/\.set\(key/.test(apiStr)) return 'NON_LEAK';  // local storage set
    if (/AppStorage\.<.*\.get\(\)/.test(apiStr)) return 'NON_LEAK';  // assignment

    return 'UNKNOWN';
}

function judgeFlow(sourceClass, sinkClass, sourceApi, sinkApi) {
    // TP rules
    if (sourceClass === 'HIGH_PRIVACY' && sinkClass !== 'NON_LEAK') return { tp: true, reason: `${sourceClass}→${sinkClass}` };
    if (sourceClass === 'HIGH_PRIVACY' && sinkClass === 'NON_LEAK') return { tp: false, reason: `${sourceClass}→local_storage` };

    if (sourceClass === 'MEDIUM_PRIVACY' && sinkClass === 'HIGH_LEAK') return { tp: true, reason: `${sourceClass}→${sinkClass}` };
    if (sourceClass === 'MEDIUM_PRIVACY' && sinkClass === 'MEDIUM_LEAK') return { tp: true, reason: `${sourceClass}→${sinkClass}` };
    if (sourceClass === 'MEDIUM_PRIVACY' && sinkClass === 'LOW_LEAK') return { tp: false, reason: `${sourceClass}→internal_log` };
    if (sourceClass === 'MEDIUM_PRIVACY' && sinkClass === 'NON_LEAK') return { tp: false, reason: `${sourceClass}→local_storage` };

    // media.AVPlayer state callbacks are NOT privacy data
    if (/media\.AVPlayer/.test(sourceApi)) return { tp: false, reason: 'media_player_state_not_privacy' };

    // LOW_PRIVACY sources are not real privacy flows
    if (sourceClass === 'LOW_PRIVACY') return { tp: false, reason: 'low_privacy_source' };

    // NON_PRIVACY sources
    if (sourceClass === 'NON_PRIVACY') return { tp: false, reason: 'non_privacy_source' };

    // CALLBACK sources need special handling
    if (sourceClass === 'CALLBACK') {
        // .on('error', callback) → Logger.error is not a privacy leak
        if (/\.on\('.*error/.test(sourceApi)) return { tp: false, reason: 'error_callback_not_privacy' };
        // .on('progress', callback) → not privacy
        if (/\.on\('.*progress/.test(sourceApi)) return { tp: false, reason: 'progress_callback_not_privacy' };
        // .on('stateChange'/'stateUpdate') → media state, not privacy
        if (/\.on\('.*state/.test(sourceApi)) return { tp: false, reason: 'state_callback_not_privacy' };
        // .on('audioInterrupt') → audio state, not privacy
        if (/\.on\('.*audioInterrupt/.test(sourceApi)) return { tp: false, reason: 'audio_state_not_privacy' };
        // Other .on() callbacks with specific subscriptions
        if (/SubscriptionBatchEdit/.test(sourceApi)) return { tp: false, reason: 'subscription_callback_not_privacy' };
        // Generic .on() callback - check if sink is a leak
        if (sinkClass === 'HIGH_LEAK') return { tp: true, reason: 'callback→high_leak' };
        return { tp: false, reason: 'callback→non_leak' };
    }

    // UNKNOWN
    if (sourceClass === 'UNKNOWN' || sinkClass === 'UNKNOWN') {
        return { tp: null, reason: `unclassified:${sourceClass}→${sinkClass}`, sourceApi, sinkApi };
    }

    return { tp: false, reason: `${sourceClass}→${sinkClass}=default_FP` };
}

// Annotate all flows
let tp = 0, fp = 0, unknown = 0;
const annotatedResults = [];

for (const project of data.results) {
    if (project.flows === 0) continue;

    const annotatedFlows = [];
    for (const flow of project.flowsDetail) {
        const sourceClass = classifySource(flow.sourceApi);
        const sinkClass = classifySink(flow.sinkApi);
        const judgment = judgeFlow(sourceClass, sinkClass, flow.sourceApi, flow.sinkApi);

        if (judgment.tp === true) tp++;
        else if (judgment.tp === false) fp++;
        else unknown++;

        annotatedFlows.push({
            ...flow,
            sourceClass,
            sinkClass,
            isTruePositive: judgment.tp,
            reason: judgment.reason,
        });
    }

    annotatedResults.push({
        project: project.name,
        flows: project.flows,
        tp: annotatedFlows.filter(f => f.isTruePositive === true).length,
        fp: annotatedFlows.filter(f => f.isTruePositive === false).length,
        unknown: annotatedFlows.filter(f => f.isTruePositive === null).length,
        flowsDetail: annotatedFlows,
    });
}

console.log(`=== Auto-Annotation Results ===`);
console.log(`Total flows: ${tp + fp + unknown}`);
console.log(`True Positives: ${tp}`);
console.log(`False Positives: ${fp}`);
console.log(`Unknown (needs manual review): ${unknown}`);
console.log(`Precision (excl. unknown): ${(tp / (tp + fp) * 100).toFixed(1)}%`);

// Print unknowns for manual review
if (unknown > 0) {
    console.log(`\n--- Unknowns (need manual review) ---`);
    for (const project of annotatedResults) {
        for (const flow of project.flowsDetail) {
            if (flow.isTruePositive === null) {
                console.log(`${project.project}:`);
                console.log(`  Source: ${flow.sourceApi.substring(0, 80)}`);
                console.log(`  Sink: ${flow.sinkApi.substring(0, 80)}`);
                console.log(`  Reason: ${flow.reason}`);
            }
        }
    }
}

// Print per-project summary
console.log(`\n--- Per-Project Summary ---`);
for (const project of annotatedResults) {
    if (project.flows > 0) {
        console.log(`${project.project}: ${project.flows} flows (TP=${project.tp}, FP=${project.fp}, ?=${project.unknown})`);
    }
}

// Save annotated results
const outputPath = path.join(__dirname, '..', 'docs', 'comparison_hapflow_vs_arkprism', 'annotated_results.json');
fs.writeFileSync(outputPath, JSON.stringify({
    timestamp: new Date().toISOString(),
    summary: { totalFlows: tp + fp + unknown, tp, fp, unknown, precision: tp + fp > 0 ? (tp / (tp + fp) * 100).toFixed(1) + '%' : 'N/A' },
    results: annotatedResults,
}, null, 2));
console.log(`\nSaved to: ${outputPath}`);
