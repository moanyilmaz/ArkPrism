/**
 * 合并敏感API列表脚本
 * 将 sensitive_arktsv1.json 和 sensitive_capiv1.json 合并到 privacy_apis.json
 *
 * 输出: config/privacy_apis_merged.json
 */

const fs = require('fs');
const path = require('path');

// 路径配置
const ARKTS_FILE = 'D:/EdgeDownload/sensitive_arktsv1.json';
const CAPI_FILE = 'D:/EdgeDownload/sensitive_capiv1.json';
const CURRENT_FILE = 'D:/Projects/Argus/config/privacy_apis.json';
const OUTPUT_FILE = 'D:/Projects/Argus/config/privacy_apis_merged.json';

// 加载文件
function loadJson(filePath) {
    console.log(`Loading: ${filePath}`);
    const content = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(content);
}

// API签名到隐私类别的映射
const CATEGORY_MAP = {
    // deviceinfo
    'deviceinfo': 'user_data.device_info',
    // identifiers
    'Identifiers.ICCID': 'user_data.iccid',
    'Identifiers.MAC': 'user_data.mac',
    'Identifiers.OAID': 'user_data.oaid',
    'Identifiers.AAID': 'user_data.aaid',
    'Identifiers.SN': 'user_data.sn',
    'Identifiers.UDID': 'user_data.udid',
    'Identifiers.ODID': 'user_data.odid',
    'Identifiers.diskSN': 'user_data.disk_sn',
    // contact
    'Contact information.Contact list': 'user_data.contacts',
    'Basic information.Calendar': 'user_data.calendar',
    // network
    'Network': 'user_data.network',
    'WiFi': 'user_data.wifi',
    // location
    'Location': 'user_data.location',
    // display
    'display': 'user_data.display',
    // timezone
    'timezone': 'user_data.timezone',
    // financial
    'Financial information.Asset information': 'user_data.financial',
    'Transaction information.Transaction records': 'user_data.transaction',
    // account
    'Basic information.Account information': 'user_data.account',
    // biometric
    'Special category data.biometric features': 'user_data.biometric',
    // sensor
    'Device information.sensor': 'user_data.sensor',
    // app environment
    'app_environment': 'app_environment',
    // user_data.clipboard (特殊处理)
    // user_data.photo (特殊处理)
    // user_data.media (特殊处理)
};

function getProfilingCategory(infomationCatagory) {
    if (!infomationCatagory) return 'other';
    return CATEGORY_MAP[infomationCatagory] || 'other';
}

// 从 ArkTS API 格式转换
function convertArkTsApi(api) {
    const apiSignature = api.api_signature || '';
    const apiKwd = api.api_kwd || '';
    const importKit = api.import_kit || '';
    const callCatagory = api.call_catagory || '直接调用';

    // 解析 namespace 和 method
    // 例如: "wifiManager.getDeviceMacAddress" -> namespace: "wifiManager", method: "getDeviceMacAddress"
    // 例如: "deviceInfo.serial" -> namespace: "deviceInfo", method: "serial"
    // 例如: "sim.getSimAccountInfo" -> namespace: "sim", method: "getSimAccountInfo"

    let namespace = '';
    let method = '';

    if (apiSignature.includes('.')) {
        const parts = apiSignature.split('.');
        namespace = parts[0];
        method = parts.slice(1).join('.');
    } else {
        namespace = apiKwd;
        method = apiKwd;
    }

    // 确定 directCall
    const directCall = callCatagory === '直接调用' ? true : false;

    // 获取权限
    let permission = api.permission || null;
    if (permission && permission.includes('；')) {
        permission = permission.split('；')[0].trim();
    }

    // 获取 profilingCategory
    const profilingCategory = getProfilingCategory(api.infomation_catagory);

    // 构建 namespace（处理 Kit 映射）
    let apiPackage = '';
    if (importKit === '@kit.TelephonyKit') {
        apiPackage = '@ohos.telephony';
    } else if (importKit === '@kit.ConnectivityKit') {
        apiPackage = '@ohos.wifiManager'; // 或 @ohos.bluetooth
    } else if (importKit === '@kit.NetworkKit') {
        apiPackage = '@ohos.net.ethernet';
    } else if (importKit === '@kit.AdsKit') {
        apiPackage = '@ohos.identifier.oaid';
    } else if (importKit === '@kit.PushKit') {
        apiPackage = '@ohos.push';
    } else if (importKit === '@kit.BasicServicesKit') {
        apiPackage = '@ohos.deviceInfo';
    } else if (importKit === '@kit.AssetStoreKit') {
        apiPackage = '@ohos.security.asset';
    } else if (importKit === '@kit.AccountKit') {
        apiPackage = '@hms.core.authentication';
    } else if (importKit === '@kit.CalendarKit') {
        apiPackage = '@ohos.calendarManager';
    } else if (importKit === '@kit.IAPKit') {
        apiPackage = '@iap';
    } else if (importKit === '@kit.ContactsKit') {
        apiPackage = '@ohos.contact';
    } else if (importKit === '@kit.UserAuthenticationKit') {
        apiPackage = '@ohos.userIAM.userAuth';
    } else if (importKit === '@kit.VisionKit') {
        apiPackage = '@kit.VisionKit';
    } else if (importKit === '@kit.SensorServiceKit') {
        apiPackage = '@ohos.sensor';
    } else {
        apiPackage = importKit;
    }

    return {
        directCall,
        namespace,
        method,
        apiPackage,
        permission,
        profilingCategory,
        descrip: api.descrip1 || api.descrip0 || ''
    };
}

// 从 C API 格式转换 (用于 NDK/原生API)
function convertCApi(api) {
    const label = api.label || '';
    const category = api.category || 'other';
    const kit = api.Kit || '';
    const descrip = api.descrip || '';

    // OH_* 格式转驼峰
    // OH_GetDeviceType -> getDeviceType
    const method = label.replace(/^OH_/, '').replace(/_([a-z])/g, (g) => g[1].toUpperCase());

    // namespace 映射
    let namespace = '';
    if (category === 'deviceinfo') {
        namespace = 'deviceInfo';
    } else if (category === 'WiFi') {
        namespace = 'wifiManager';
    } else if (category === 'Network' || category === 'Telephony') {
        namespace = 'telephony';
    } else if (category === 'Location') {
        namespace = 'location';
    } else if (category === 'display') {
        namespace = 'display';
    } else if (category === 'timezone') {
        namespace = 'timeService';
    } else {
        namespace = category;
    }

    // profilingCategory
    const profilingCategory = getProfilingCategory(category);

    // apiPackage
    let apiPackage = '';
    if (kit.includes('Basic Services')) {
        apiPackage = '@ohos.deviceInfo';
    } else if (kit.includes('Connectivity')) {
        apiPackage = '@ohos.wifiManager';
    } else if (kit.includes('Telephony')) {
        apiPackage = '@ohos.telephony';
    } else if (kit.includes('Location')) {
        apiPackage = '@ohos.location';
    } else if (kit.includes('ArkUI')) {
        apiPackage = '@ohos.display';
    } else {
        apiPackage = '@ohos.' + category;
    }

    return {
        directCall: true,
        namespace,
        method,
        apiPackage,
        permission: null,
        profilingCategory,
        descrip
    };
}

function main() {
    console.log('=== Sensitive API Merger ===\n');

    // 加载当前列表
    const currentApis = loadJson(CURRENT_FILE);
    console.log(`Current privacy_apis.json: ${currentApis.length} entries\n`);

    // 加载新 ArkTS API
    const arktsApis = loadJson(ARKTS_FILE);
    console.log(`sensitive_arktsv1.json: ${arktsApis.length} entries\n`);

    // 加载新 C API
    const capiApis = loadJson(CAPI_FILE);
    console.log(`sensitive_capiv1.json: ${capiApis.length} entries\n`);

    // 构建现有API集合（用于去重）
    const existingKeys = new Set();
    for (const entry of currentApis) {
        const apis = entry.privacyApis || [];
        for (const api of apis) {
            const key = `${api.namespace}.${api.method}`;
            existingKeys.add(key);
        }
    }
    console.log(`Existing unique APIs: ${existingKeys.size}\n`);

    // 转换并去重
    const newArkTsEntries = [];
    const seenArkTsKeys = new Set();

    for (const api of arktsApis) {
        const converted = convertArkTsApi(api);
        const key = `${converted.namespace}.${converted.method}`;

        if (existingKeys.has(key) || seenArkTsKeys.has(key)) {
            continue;
        }
        seenArkTsKeys.add(key);

        // 找到或创建对应的 package entry
        let entry = newArkTsEntries.find(e => e.systemPackage === converted.apiPackage);
        if (!entry) {
            entry = {
                systemPackage: converted.apiPackage,
                privacyApis: []
            };
            newArkTsEntries.push(entry);
        }

        entry.privacyApis.push({
            directCall: converted.directCall,
            namespace: converted.namespace,
            method: converted.method,
            permission: converted.permission,
            profilingCategory: converted.profilingCategory,
            descrip: converted.descrip
        });
    }

    const newCApiEntries = [];
    const seenCKeys = new Set();

    for (const api of capiApis) {
        const converted = convertCApi(api);
        const key = `${converted.namespace}.${converted.method}`;

        if (existingKeys.has(key) || seenCKeys.has(key)) {
            continue;
        }
        seenCKeys.add(key);

        let entry = newCApiEntries.find(e => e.systemPackage === converted.apiPackage);
        if (!entry) {
            entry = {
                systemPackage: converted.apiPackage,
                privacyApis: []
            };
            newCApiEntries.push(entry);
        }

        entry.privacyApis.push({
            directCall: converted.directCall,
            namespace: converted.namespace,
            method: converted.method,
            permission: converted.permission,
            profilingCategory: converted.profilingCategory,
            descrip: converted.descrip
        });
    }

    console.log(`=== 新增 ArkTS APIs ===`);
    console.log(`New entries: ${newArkTsEntries.length}`);
    let newArkTsCount = 0;
    for (const entry of newArkTsEntries) {
        console.log(`  ${entry.systemPackage}: ${entry.privacyApis.length} APIs`);
        newArkTsCount += entry.privacyApis.length;
    }
    console.log(`Total new ArkTS APIs: ${newArkTsCount}\n`);

    console.log(`=== 新增 C API (NDK) ===`);
    console.log(`New entries: ${newCApiEntries.length}`);
    let newCApiCount = 0;
    for (const entry of newCApiEntries) {
        console.log(`  ${entry.systemPackage}: ${entry.privacyApis.length} APIs`);
        newCApiCount += entry.privacyApis.length;
    }
    console.log(`Total new C APIs: ${newCApiCount}\n`);

    // 合并
    const merged = [...currentApis, ...newArkTsEntries, ...newCApiEntries];

    // 写入输出
    const outputDir = path.dirname(OUTPUT_FILE);
    if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
    }
    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(merged, null, 2), 'utf-8');
    console.log(`=== Merged output ===`);
    console.log(`Written to: ${OUTPUT_FILE}`);
    console.log(`Total entries: ${merged.length}`);
    console.log(`Total new APIs added: ${newArkTsCount + newCApiCount}`);
}

main();