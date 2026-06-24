/**
 * 任务3: 分析检出数量最多的前10个应用
 * 检查是否存在误报漏报
 */

const fs = require('fs');
const path = require('path');

const OUTPUT_DIR = 'D:/argus-dataset/batch-results-1015-2026-06-23-final';
const DATASET_DIR = 'D:/argus-dataset/all-1015/ARGUS-successful-1015-samples-20260617';

// 前10个应用列表
const top10 = [
    'Snake_NEXT-main',
    'STUFFS_NEXT-master',
    'legado-Harmony-main',
    'Wechat_HarmonyOS',
    'harmonyos4me_ResponsiveLayout',
    'harmony-next-music-sharing',
    'harmonyProject-master',
    'Dictionareow',
    'harmonyos4me_MultiVideoApplication',
    'Contact'
];

// 加载报告
function loadReport(projectName) {
    const reportPath = path.join(OUTPUT_DIR, projectName, projectName, `${projectName}-arkprism-report.json`);
    if (fs.existsSync(reportPath)) {
        return JSON.parse(fs.readFileSync(reportPath, 'utf-8'));
    }
    return null;
}

// 分析单个应用
function analyzeProject(projectName) {
    console.log('='.repeat(80));
    console.log(`分析项目: ${projectName}`);
    console.log('='.repeat(80));

    const report = loadReport(projectName);
    if (!report) {
        console.log('  报告文件不存在');
        return;
    }

    console.log(`\n1. 基本统计:`);
    console.log(`   - 检测到的隐私API: ${report.privacyApiUsages?.length || 0}`);
    console.log(`   - 调用链: ${report.callChains?.length || 0}`);
    console.log(`   - 协同行为: ${report.multiSourceCollaborations?.length || 0}`);
    console.log(`   - 污点流: ${report.taintFlows?.length || 0}`);

    // 按类别统计
    const categoryCount = {};
    for (const api of report.privacyApiUsages || []) {
        const cat = api.profilingCategory || 'other';
        categoryCount[cat] = (categoryCount[cat] || 0) + 1;
    }

    console.log(`\n2. 按类别分布:`);
    for (const [cat, count] of Object.entries(categoryCount).sort((a, b) => b[1] - a[1])) {
        console.log(`   - ${cat}: ${count}`);
    }

    // 分析数据流
    const dataFlowStats = {
        withSink: 0,
        withoutSink: 0,
        sinkTypes: {}
    };

    for (const chain of report.callChains || []) {
        const sinks = chain.dataSinks || [];
        if (sinks.length > 0) {
            dataFlowStats.withSink++;
            for (const sink of sinks) {
                dataFlowStats.sinkTypes[sink.sinkType] = (dataFlowStats.sinkTypes[sink.sinkType] || 0) + 1;
            }
        } else {
            dataFlowStats.withoutSink++;
        }
    }

    console.log(`\n3. 数据流分析:`);
    console.log(`   - 有Sink的数据流: ${dataFlowStats.withSink}`);
    console.log(`   - 无Sink的数据流: ${dataFlowStats.withoutSink}`);
    console.log(`   - Sink类型分布:`);
    for (const [type, count] of Object.entries(dataFlowStats.sinkTypes)) {
        console.log(`     * ${type}: ${count}`);
    }

    // 列出所有检测到的API详情
    console.log(`\n4. 检测到的API详情:`);
    for (let i = 0; i < Math.min(20, report.privacyApiUsages?.length || 0); i++) {
        const api = report.privacyApiUsages[i];
        const chain = report.callChains?.find(c => c.apiUsageIndex === i);
        const hasSink = chain?.dataSinks?.length > 0;
        const sinkStr = hasSink ? '[有数据泄露]' : '[无泄露终点]';
        console.log(`   ${i+1}. ${api.namespace}.${api.method} ${sinkStr}`);
        console.log(`      文件: ${api.file}`);
    }
    if ((report.privacyApiUsages?.length || 0) > 20) {
        console.log(`   ... 还有 ${report.privacyApiUsages.length - 20} 个`);
    }

    console.log('');
}

// 执行分析
for (const projectName of top10) {
    analyzeProject(projectName);
}

console.log('\n' + '='.repeat(80));
console.log('分析完成');
console.log('='.repeat(80));