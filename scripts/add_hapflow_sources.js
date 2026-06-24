/**
 * 为 hapflow_sources.json 添加缺失的 Source API
 * 基于 privacy_apis.json 中新增的 API
 */

const fs = require('fs');
const path = require('path');

// 加载文件
const privacyApis = JSON.parse(fs.readFileSync(
    path.join(__dirname, '..', 'config', 'privacy_apis.json'),
    'utf-8'
));

const sources = JSON.parse(fs.readFileSync(
    path.join(__dirname, '..', 'config', 'hapflow_sources.json'),
    'utf-8'
));

// 构建现有匹配
const existingSourceNames = new Set(sources.map(s => s.api_name));

// namespace 到 module 的映射
const namespaceToModule = {
    'deviceInfo': '@ohos.deviceInfo',
    'batteryInfo': '@ohos.battery',
    'sim': '@ohos.telephony.sim',
    'sms': '@ohos.telephony.sms',
    'contact': '@ohos.contact',
    'calendar': '@ohos.calendarManager',
    'wifiManager': '@ohos.wifiManager',
    'connection': '@ohos.net.connection',
    'geoLocationManager': '@ohos.geoLocationManager',
    'locationManager': '@ohos.location',
    'sensor': '@ohos.sensor',
    'pasteboard': '@ohos.pasteboard',
    'appAccount': '@ohos.account.appAccount',
    'osAccount': '@ohos.account.osAccount',
    'distributedAccount': '@ohos.account.distributedAccount',
    'distributedDeviceManager': '@ohos.distributedDeviceManager',
    'audio': '@ohos.multimedia.audio',
    'camera': '@ohos.multimedia.camera',
    'bundleManager': '@ohos.bundle',
    'access': '@ohos.wifiManager',
    'workout': '@kit.HealthServiceKit',
    'AuthenticationController': '@hms.core.authentication',
};

// profilingCategory 到 sensitivity 的映射
const categoryToSensitivity = {
    'device_identity': 'high',
    'location': 'high',
    'user_data.contacts': 'high',
    'user_data.calendar': 'high',
    'user_data.biometric': 'high',
    'user_data.clipboard': 'high',
    'user_data.media': 'high',
    'user_data.audio': 'high',
    'user_data.identifier': 'high',
    'user_data.oaid': 'high',
    'user_data.aaid': 'high',
    'network.wifi': 'medium',
    'network.connectivity': 'medium',
    'network.bluetooth': 'medium',
    'device_status.sensor': 'medium',
    'device_status.battery': 'low',
    'device_info': 'low',
    'app_environment': 'low',
    'other': 'low',
};

// 生成新的 Source 条目
const newSources = [];

for (const pkg of privacyApis) {
    for (const api of pkg.privacyApis) {
        const method = api.method;

        // 跳过已存在的
        if (existingSourceNames.has(method)) {
            continue;
        }

        // 判断是否为 Source（返回敏感数据的 API）
        const lowerMethod = method.toLowerCase();
        const isSource = (
            lowerMethod.includes('get') ||
            lowerMethod.includes('query') ||
            lowerMethod.includes('select') ||
            lowerMethod.includes('on') ||
            lowerMethod.includes('read') ||
            lowerMethod.includes('fetch') ||
            lowerMethod.includes('is') ||
            lowerMethod.includes('has') ||
            lowerMethod.includes('check') ||
            api.directCall === null ||
            lowerMethod.includes('version') ||
            lowerMethod.includes('info')
        );

        if (!isSource) {
            continue;
        }

        // 解析 namespace 和实际方法名
        let namespace = '';
        let actualMethod = method;
        if (method.includes('.')) {
            const parts = method.split('.');
            namespace = parts[0];
            actualMethod = parts.slice(1).join('.');
        }

        // 获取 module
        const module = namespaceToModule[namespace] || pkg.systemPackage;

        // 获取 sensitivity
        const sensitivity = categoryToSensitivity[api.profilingCategory] || 'medium';

        // 判断 source_type
        let sourceType = 'return';
        if (lowerMethod.includes('on(') || lowerMethod.includes('once(')) {
            sourceType = 'callback';
        }

        newSources.push({
            api_name: method,
            module: module,
            class: namespace ? '' : '',
            namespace: namespace || actualMethod.split('.')[0],
            parameters: [],
            returnType: 'Promise<unknown>',
            api_type: 'source',
            source_type: sourceType,
            tainted_param_index: sourceType === 'callback' ? 1 : -1,
            reason: `获取${api.profilingCategory || '敏感'}数据`,
            sensitivity: sensitivity
        });
    }
}

// 按 api_name 去重
const uniqueNewSources = [...new Map(newSources.map(item => [item.api_name, item])).values()];

console.log('=== 生成新的 Source 条目 ===');
console.log(`需要添加: ${uniqueNewSources.length} 个`);

// 合并到现有 sources
const mergedSources = [...sources, ...uniqueNewSources];

// 写入文件
const outputPath = path.join(__dirname, '..', 'config', 'hapflow_sources.json');
fs.writeFileSync(outputPath, JSON.stringify(mergedSources, null, 2), 'utf-8');

console.log('');
console.log(`写入: ${outputPath}`);
console.log(`原文件: ${sources.length} 条`);
console.log(`新增: ${uniqueNewSources.length} 条`);
console.log(`总计: ${mergedSources.length} 条`);

// 显示新增的条目
console.log('');
console.log('=== 新增的 Source 条目 ===');
for (const src of uniqueNewSources.slice(0, 30)) {
    console.log(`  ${src.api_name} (${src.source_type}, ${src.sensitivity})`);
}
if (uniqueNewSources.length > 30) {
    console.log(`  ... 还有 ${uniqueNewSources.length - 30} 个`);
}