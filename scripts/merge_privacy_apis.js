/**
 * Merge privacy_apis.json into existing hapflow_sources.json
 * - Keep all existing sources
 * - Add new sources from privacy_apis.json (especially selectContacts)
 */

const fs = require('fs');
const path = require('path');

function main() {
    const privacyPath = path.join(__dirname, '..', 'config', 'privacy_apis.json');
    const sourcesPath = path.join(__dirname, '..', 'config', 'hapflow_sources.json');
    const sourcesBackupPath = path.join(__dirname, '..', 'config', 'hapflow_sources.json.backup');

    // Load existing sources
    let existingSources = [];
    if (fs.existsSync(sourcesPath)) {
        existingSources = JSON.parse(fs.readFileSync(sourcesPath, 'utf-8'));
    }

    // Create key lookup for existing sources
    const existingKeys = new Set();
    existingSources.forEach(s => {
        const key = `${s.module}:${s.namespace}:${s.api_name}`;
        existingKeys.add(key);
    });

    console.log(`Existing sources: ${existingSources.length}`);

    // Load privacy APIs
    const privacy = JSON.parse(fs.readFileSync(privacyPath, 'utf-8'));

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

    function isSourceNamespace(namespace) {
        return SOURCE_NAMESPACES.has(namespace);
    }

    function isSourceMethod(methodName) {
        const lower = methodName.toLowerCase();
        return SOURCE_METHOD_PATTERNS.some(p => lower.startsWith(p) || lower.includes(p));
    }

    function categoryToReason(category, namespace, method) {
        const reasons = {
            'user_data.contacts': '返回联系人信息，包含姓名、电话等敏感个人数据',
            'user_data.calendar': '返回日历事件信息，包含用户日程安排',
            'user_data.location': '返回地理位置信息',
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
        };

        if (reasons[category]) return reasons[category];

        // Special handling for contact APIs
        if (namespace === 'contact') {
            return '返回联系人信息，包含姓名、电话等敏感个人数据';
        }

        return `API可能涉及敏感数据处理 (${namespace}.${method})`;
    }

    function sensitivityToString(category, namespace) {
        if (category?.startsWith('user_data.') && ['financial', 'health', 'biometric'].some(s => category.includes(s))) {
            return 'high';
        }
        if (category?.startsWith('location') || category?.startsWith('user_data.contacts') || namespace === 'contact') {
            return 'high';
        }
        if (category?.startsWith('user_data.')) {
            return 'medium';
        }
        return 'low';
    }

    const newSources = [];
    let addedCount = 0;

    Object.values(privacy).forEach(group => {
        if (!group.privacyApis) return;
        const module = group.systemPackage;

        group.privacyApis.forEach(api => {
            const key = `${module}:${api.namespace}:${api.method}`;
            const category = api.profilingCategory || 'unknown';

            // Skip if already exists
            if (existingKeys.has(key)) {
                return;
            }

            // Add if it's a source namespace or has source method pattern
            const isSource = isSourceNamespace(api.namespace) || isSourceMethod(api.method);

            if (isSource) {
                newSources.push({
                    api_name: api.method,
                    module: module,
                    class: '',
                    namespace: api.namespace,
                    parameters: [],
                    returnType: 'any',
                    api_type: 'source',
                    source_type: 'return',
                    tainted_param_index: -1,
                    reason: categoryToReason(category, api.namespace, api.method),
                    sensitivity: sensitivityToString(category, api.namespace)
                });
                addedCount++;
            }
        });
    });

    console.log(`New sources to add: ${addedCount}`);

    // Merge: existing + new
    const merged = [...existingSources, ...newSources];
    console.log(`Merged total: ${merged.length}`);

    // Backup original
    fs.writeFileSync(sourcesBackupPath, JSON.stringify(existingSources, null, 2), 'utf-8');
    console.log(`Backup saved to: ${sourcesBackupPath}`);

    // Write merged
    fs.writeFileSync(sourcesPath, JSON.stringify(merged, null, 2), 'utf-8');
    console.log(`Merged sources written to: ${sourcesPath}`);

    // Show added sources
    console.log('\nAdded sources:');
    newSources.slice(0, 20).forEach(s => {
        console.log(`  - ${s.namespace}.${s.api_name} (${s.module})`);
    });
    if (newSources.length > 20) {
        console.log(`  ... and ${newSources.length - 20} more`);
    }
}

main();