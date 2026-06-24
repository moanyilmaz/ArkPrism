/**
 * 添加 Promise resolve Sink 检测
 */
const fs = require('fs');
const utilPath = 'D:/Projects/Argus/src/hapflow/Util.ts';
const taintPath = 'D:/Projects/Argus/src/hapflow/TaintAnalysis.ts';

// 1. 修改 Util.ts 添加导出
let utilContent = fs.readFileSync(utilPath, 'utf-8');
if (!utilContent.includes('RESOLVE_SINK_METHODS')) {
    const insertPoint = utilContent.indexOf('export const LOG_SINK_METHODS');
    if (insertPoint > 0) {
        utilContent = utilContent.slice(0, insertPoint) +
            'export const RESOLVE_SINK_METHODS = ["resolve"];\n' +
            utilContent.slice(insertPoint);
        fs.writeFileSync(utilPath, utilContent);
        console.log('✓ Util.ts updated - added RESOLVE_SINK_METHODS');
    }
} else {
    console.log('- Util.ts already has RESOLVE_SINK_METHODS');
}

// 2. 修改 TaintAnalysis.ts 导入并添加检测
let taintContent = fs.readFileSync(taintPath, 'utf-8');

// 添加导入
if (!taintContent.includes('RESOLVE_SINK_METHODS')) {
    taintContent = taintContent.replace(
        'getPossibleRelatedNodes, INTERNAL_PARAMETER_SOURCE, INTERNAL_SINK_METHOD_toString, LOG_SINK_METHODS,',
        'getPossibleRelatedNodes, INTERNAL_PARAMETER_SOURCE, INTERNAL_SINK_METHOD_toString, LOG_SINK_METHODS, RESOLVE_SINK_METHODS,'
    );
    console.log('✓ TaintAnalysis.ts - added RESOLVE_SINK_METHODS import');
} else {
    console.log('- TaintAnalysis.ts already imports RESOLVE_SINK_METHODS');
}

// 添加 resolve 检测逻辑
const targetCode = `const isSink = this.callSink(invokeExpr);
                if (isSink) {
                    const args = invokeExpr.getArgs();
                    for (const arg of args) {
                        if (ValueEqual(arg, currentVar)) {`;

const resolveCode = `const isSink = this.callSink(invokeExpr);
                // Also check for resolve() calls - Promise resolve is a data leakage endpoint
                let resolveSink = false;
                if (!isSink) {
                    const methodName = invokeExpr.getMethodSignature().getMethodSubSignature().getMethodName();
                    if (RESOLVE_SINK_METHODS.includes(methodName)) {
                        resolveSink = true;
                    }
                }
                if (isSink || resolveSink) {
                    const args = invokeExpr.getArgs();
                    for (const arg of args) {
                        if (ValueEqual(arg, currentVar)) {`;

if (taintContent.includes(targetCode) && !taintContent.includes('resolveSink')) {
    taintContent = taintContent.replace(targetCode, resolveCode);
    fs.writeFileSync(taintPath, taintContent);
    console.log('✓ TaintAnalysis.ts - added resolve sink detection');
} else if (taintContent.includes('resolveSink')) {
    console.log('- TaintAnalysis.ts already has resolve detection');
} else {
    console.log('- Could not find target code in TaintAnalysis.ts');
}

console.log('\nDone!');