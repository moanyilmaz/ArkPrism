/**
 * Convert privacy_apis.json to hapflow_sources.json and hapflow_sinks.json
 *
 * Sources: APIs that return sensitive user data (user_data.* categories)
 * Sinks: APIs that transmit or log sensitive data (network, storage operations)
 */

const fs = require('fs');
const path = require('path');

// Source categories: APIs that return sensitive data
const SOURCE_CATEGORIES = new Set([
    'user_data.account',
    'user_data.transaction',
    'user_data.calendar',
    'user_data.contacts',
    'user_data.sn',
    'user_data.udid',
    'user_data.odid',
    'user_data.disk_sn',
    'user_data.clipboard',
    'user_data.health',
    'user_data.oaid',
    'user_data.audio',
    'user_data.media',
    'user_data.mac',
    'user_data.aaid',
    'user_data.financial',
    'user_data.iccid',
    'user_data.biometric',
    'location',
    'device_info',
    'network.wifi',
    'network.bluetooth',
]);

// Sink categories: APIs that transmit or persist data
const SINK_CATEGORIES = new Set([
    'user_data.transaction',
    'network.connectivity',
    'user_data.calendar',
    'user_data.contacts',
    'user_data.media',
]);

// Method name patterns that indicate sinks
const SINK_METHOD_PATTERNS = [
    'send', 'post', 'upload', 'write', 'set', 'publish',
    'log', 'print', 'console', 'share', 'transmit',
    'setData', 'setText', 'insert', 'add', 'save'
];

// Namespaces that are likely sources (return sensitive data)
const SOURCE_NAMESPACES = new Set([
    'contact', 'geoLocationManager', 'pasteboard', 'bluetooth',
    'wifi', 'audio', 'media', 'calendar', 'rdb', 'distributed',
    'file', 'statfs', 'app', 'bundleManager', 'deviceInfo'
]);

// Method name patterns that indicate sources (query/get/fetch data)
const SOURCE_METHOD_PATTERNS = [
    'select', 'query', 'get', 'fetch', 'read', 'list',
    'obtain', 'acquire', 'retrieve', 'find', 'search'
];

function isSourceCategory(category) {
    return SOURCE_CATEGORIES.has(category) || category.startsWith('user_data.');
}

function isSinkCategory(category) {
    if (SINK_CATEGORIES.has(category)) return true;
    return category.startsWith('network.');
}

function isSourceNamespace(namespace) {
    return SOURCE_NAMESPACES.has(namespace);
}

function isSourceMethod(methodName) {
    const lower = methodName.toLowerCase();
    return SOURCE_METHOD_PATTERNS.some(p => lower.startsWith(p) || lower.includes(p));
}

function isSinkMethod(methodName) {
    const lower = methodName.toLowerCase();
    return SINK_METHOD_PATTERNS.some(p => lower.includes(p));
}

function categoryToReason(category) {
    const reasons = {
        'user_data.contacts': '返回联系人信息，包含姓名、电话等敏感个人数据',
        'user_data.calendar': '返回日历事件信息，包含用户日程安排',
        'user_data.location': '返回用户地理位置信息',
        'user_data.media': '返回媒体文件信息或内容',
        'user_data.clipboard': '返回剪贴板内容，可能包含敏感数据',
        'user_data.account': '返回用户账户信息',
        'user_data.transaction': '返回应用内购买交易记录',
        'location': '返回地理位置信息',
        'device_info': '返回设备标识信息',
        'network.wifi': '返回WiFi网络信息',
        'network.bluetooth': '返回蓝牙设备信息',
        'user_data.health': '返回健康运动数据',
        'user_data.biometric': '返回生物特征数据',
        'user_data.audio': '返回音频信息或录音',
        'network.connectivity': '发送网络数据，属于数据传输操作',
        'user_data.media': '写入或读取媒体文件，属于数据持久化操作',
    };
    return reasons[category] || `API属于${category}类别，可能涉及敏感数据处理`;
}

function sensitivityToString(category) {
    if (category.startsWith('user_data.') && ['financial', 'health', 'biometric'].some(s => category.includes(s))) {
        return 'high';
    }
    if (category.startsWith('location') || category.startsWith('user_data.contacts')) {
        return 'high';
    }
    if (category.startsWith('user_data.')) {
        return 'medium';
    }
    return 'low';
}

function convertApiToSource(api, module) {
    return {
        api_name: api.method,
        module: module,
        class: '',
        namespace: api.namespace,
        parameters: [],
        returnType: 'any',
        api_type: 'source',
        source_type: 'return',
        tainted_param_index: -1,
        reason: categoryToReason(api.profilingCategory || 'unknown'),
        sensitivity: sensitivityToString(api.profilingCategory || 'unknown')
    };
}

function convertApiToSink(api, module) {
    return {
        api_name: api.method,
        module: module,
        class: '',
        namespace: api.namespace,
        parameters: [{
            name: 'data',
            type: 'any'
        }],
        returnType: 'void',
        api_type: 'sink',
        source_type: null,
        tainted_param_index: 0,
        reason: categoryToReason(api.profilingCategory || 'unknown'),
        is_sink: 'yes'
    };
}

function main() {
    const privacyPath = path.join(__dirname, '..', 'config', 'privacy_apis.json');
    const sourcesPath = path.join(__dirname, '..', 'config', 'hapflow_sources.json');
    const sinksPath = path.join(__dirname, '..', 'config', 'hapflow_sinks.json');

    const privacy = JSON.parse(fs.readFileSync(privacyPath, 'utf-8'));

    const sources = [];
    const sinks = [];
    const sourceSet = new Set();
    const sinkSet = new Set();

    Object.values(privacy).forEach(group => {
        if (!group.privacyApis) return;
        const module = group.systemPackage;

        group.privacyApis.forEach(api => {
            const key = `${module}:${api.namespace}:${api.method}`;
            const category = api.profilingCategory || 'unknown';

            // Add as source if:
            // 1. It's a source category (user_data.*, location, etc.)
            // 2. It's a source namespace (contact, geoLocationManager, etc.)
            // 3. It has a source method pattern (select, query, get, etc.)
            // 4. directCall is false (callback-based API)
            const isSource = isSourceCategory(category) ||
                             isSourceNamespace(api.namespace) ||
                             isSourceMethod(api.method) ||
                             api.directCall === false;

            if (isSource) {
                if (!sourceSet.has(key)) {
                    sources.push(convertApiToSource(api, module));
                    sourceSet.add(key);
                }
            }

            // Add as sink if it matches sink criteria
            if (isSinkCategory(category) || isSinkMethod(api.method)) {
                if (!sinkSet.has(key)) {
                    sinks.push(convertApiToSink(api, module));
                    sinkSet.add(key);
                }
            }
        });
    });

    // Add common sinks that might be missed
    const commonSinks = [
        { method: 'console.log', namespace: 'console', reason: '向控制台输出数据' },
        { method: 'console.info', namespace: 'console', reason: '向控制台输出数据' },
        { method: 'console.warn', namespace: 'console', reason: '向控制台输出警告' },
        { method: 'console.error', namespace: 'console', reason: '向控制台输出错误' },
        { method: 'resolve', namespace: 'Promise', reason: 'Promise resolve 回调可能向外传输数据' },
        { method: 'reject', namespace: 'Promise', reason: 'Promise reject 回调可能向外传输数据' },
        { method: 'postMessage', namespace: 'window', reason: '向其他窗口发送消息' },
        { method: 'setAppShareData', namespace: 'app', reason: '设置应用分享数据' },
    ];

    commonSinks.forEach(sink => {
        const key = `common:${sink.namespace}:${sink.method}`;
        if (!sinkSet.has(key)) {
            sinks.push({
                api_name: sink.method,
                module: 'common',
                class: '',
                namespace: sink.namespace,
                parameters: [{ name: 'data', type: 'any' }],
                returnType: 'void',
                api_type: 'sink',
                source_type: null,
                tainted_param_index: 0,
                reason: sink.reason,
                is_sink: 'yes'
            });
            sinkSet.add(key);
        }
    });

    // Write outputs
    fs.writeFileSync(sourcesPath, JSON.stringify(sources, null, 2), 'utf-8');
    fs.writeFileSync(sinksPath, JSON.stringify(sinks, null, 2), 'utf-8');

    console.log('Conversion complete:');
    console.log(`  Sources: ${sources.length}`);
    console.log(`  Sinks: ${sinks.length}`);

    // Show category distribution
    const categoryCount = {};
    sources.forEach(s => {
        const reason = s.reason;
        categoryCount[reason] = (categoryCount[reason] || 0) + 1;
    });
    console.log('\nTop source categories:');
    Object.entries(categoryCount)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .forEach(([reason, count]) => {
            console.log(`  ${count}: ${reason}`);
        });
}

main();