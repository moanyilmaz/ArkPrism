/**
 * 分析 2026-06-10 版本检出数量最多的前10个应用
 */

const fs = require('fs');
const path = require('path');

const OUTPUT_DIR = 'D:/argus-dataset/batch-results-1015-2026-06-10';

const top10 = [
    'Snake_NEXT-main',
    'legado-Harmony-main',
    'STUFFS_NEXT-master',
    'Wechat_HarmonyOS',
    'CommonAppDevelopment',
    'harmony-next-music-sharing',
    'harmonyProject-master',
    'harmonyos4me_ResponsiveLayout',
    'harmonyos_samples_network-query',
    'Dictionareow'
];

function loadReport(projectName) {
    const reportPath = path.join(OUTPUT_DIR, projectName, projectName, `${projectName}-arkprism-report.json`);
    if (fs.existsSync(reportPath)) {
        return JSON.parse(fs.readFileSync(reportPath, 'utf-8'));
    }
    return null;
}

function analyzeProject(projectName) {
    console.log('='.repeat(80));
    console.log(`【${projectName}】`);
    console.log('='.repeat(80));

    const report = loadReport(projectName);
    if (!report) {
        console.log('  报告文件不存在\n');
        return;
    }

    console.log(`基本统计:`);
    console.log(`  - 隐私API: ${report.privacyApiUsages?.length || 0}`);
    console.log(`  - 调用链: ${report.callChains?.length || 0}`);
    console.log(`  - 污点流: ${report.taintFlows?.length || 0}`);

    // 按类别统计
    const categoryCount = {};
    for (const api of report.privacyApiUsages || []) {
        const cat = api.profilingCategory || 'other';
        categoryCount[cat] = (categoryCount[cat] || 0) + 1;
    }

    console.log(`\n类别分布:`);
    for (const [cat, count] of Object.entries(categoryCount).sort((a, b) => b[1] - a[1])) {
        console.log(`  - ${cat}: ${count}`);
    }

    // 数据流统计
    const sinkTypes = {};
    let withSink = 0, withoutSink = 0;
    for (const chain of report.callChains || []) {
        const sinks = chain.dataSinks || [];
        if (sinks.length > 0) {
            withSink++;
            for (const sink of sinks) {
                sinkTypes[sink.sinkType] = (sinkTypes[sink.sinkType] || 0) + 1;
            }
        } else {
            withoutSink++;
        }
    }

    console.log(`\n数据流分析:`);
    console.log(`  - 有Sink: ${withSink}, 无Sink: ${withoutSink}`);
    console.log(`  - Sink类型:`);
    for (const [type, count] of Object.entries(sinkTypes).sort((a, b) => b[1] - a[1])) {
        console.log(`    * ${type}: ${count}`);
    }

    // 检测到的API详情 (前20个)
    console.log(`\nAPI详情 (前20个):`);
    const shownApis = new Set();
    for (let i = 0; i < report.privacyApiUsages?.length && shownApis.size < 20; i++) {
        const api = report.privacyApiUsages[i];
        const key = `${api.namespace}.${api.method}`;
        if (shownApis.has(key)) continue;
        shownApis.add(key);

        const chain = report.callChains?.find(c => c.apiUsageIndex === i);
        const hasSink = chain?.dataSinks?.length > 0;
        const sinkStr = hasSink ? '[有泄露]' : '[无泄露终点]';
        console.log(`  - ${api.namespace}.${api.method} ${sinkStr}`);
        console.log(`    ${api.file}`);
    }
    if (report.privacyApiUsages?.length > shownApis.size) {
        console.log(`  ... 还有 ${report.privacyApiUsages.length - shownApis.size} 个API`);
    }

    console.log('');
}

for (const projectName of top10) {
    analyzeProject(projectName);
}

console.log('='.repeat(80));
console.log('分析完成');
console.log('='.repeat(80));