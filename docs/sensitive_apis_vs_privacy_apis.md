# sensitive_apis.json 与 privacy_apis.json 对比文档

## 一、概述

本文档详细对比 ArkPrism 项目中使用的两个敏感 API 配置文件：
- `sensitive_apis.json` - 当前正在使用的配置文件
- `privacy_apis.json` - 早期版本/备份配置文件

## 二、基本统计对比

| 指标 | sensitive_apis.json | privacy_apis.json |
|------|---------------------|-------------------|
| **systemPackage 数量** | 57 | 34 |
| **总 API 数量** | 822 | 193 |
| **直接调用 API (directCall=true)** | 554 | 142 |
| **间接调用 API (directCall=false)** | 257 | 29 |
| **常量访问 API (directCall=null)** | 11 | 22 |

## 三、文件结构对比

### 3.1 共同结构

两个文件都采用相同的 JSON 结构：

```json
[
  {
    "systemPackage": "@kit.ModuleName",
    "privacyApis": [
      {
        "namespace": "namespaceName",
        "method": "methodName",
        "permission": "ohos.permission.XXX",
        "profilingCategory": "category.subcategory",
        "directCall": true | false | null
      }
    ]
  }
]
```

### 3.2 字段说明

| 字段 | 类型 | 说明 |
|------|------|------|
| `systemPackage` | string | 系统包名，如 `@kit.BasicServicesKit`、`@ohos.account.osAccount` |
| `namespace` | string | API 命名空间，如 `osAccount`、`pasteboard` |
| `method` | string | API 方法名，如 `getOsAccountLocalId` |
| `permission` | string/null | 所需权限，如 `ohos.permission.MANAGE_LOCAL_ACCOUNTS` |
| `profilingCategory` | string | 分析类别，用于隐私画像分类 |
| `directCall` | boolean/null | 调用类型：`true`=直接调用，`false`=间接调用，`null`=常量访问 |

### 3.3 新增字段

`class` 字段（仅在 sensitive_apis.json 中少量使用）：
- 用于标识 API 所属的类名
- 例如：`osAccount.AccountManager.getOsAccountLocalId` 表示 `osAccount.AccountManager` 类的 `getOsAccountLocalId` 方法

## 四、systemPackage 模块对比

### 4.1 sensitive_apis.json 特有模块（27 个）

```
@kit.CalendarKit        - 日历
@kit.MediaKit           - 媒体
@kit.MediaLibraryKit    - 媒体库
@kit.ArkWeb             - Web组件
@kit.NotificationKit    - 通知
@kit.PushKit            - 推送
@kit.AccountKit         - 账户
@kit.IAPKit             - 应用内支付
@kit.HealthServiceKit   - 健康服务
@kit.MDMKit             - 移动设备管理
@kit.VisionKit          - 视觉
@kit.NearLinkKit        - 近场连接
@kit.UserAuthenticationKit - 用户认证
@kit.GameServiceKit     - 游戏服务
@kit.GraphicsAccelerateKit - 图形加速
@kit.InputKit           - 输入
@kit.DeviceSecurityKit  - 设备安全
@kit.CoreFileKit        - 文件核心
@kit.ScenarioFusionKit  - 场景融合
@kit.NetworkBoostKit    - 网络增强
@kit.RemoteCommunicationKit - 远程通信
@kit.AssetStoreKit      - 资产存储
@kit.HealthServiceKit   - 健康服务
@hms.health.store       - HMS健康存储
@ohos.data.rdb          - 关系型数据库
@ohos.bundle            - 应用Bundle
@ohos.reminderAgent     - 提醒代理
@system.geolocation     - 系统定位
```

### 4.2 privacy_apis.json 特有模块（4 个）

```
@ohos.batteryInfo           - 电池信息
@ohos.abilityAccessCtrl     - 权限控制
@kit.AbilityKit             - Ability能力
@kit.PerformanceAnalysisKit - 性能分析
```

## 五、profilingCategory 类别分布对比

### 5.1 sensitive_apis.json 类别分布（Top 15）

| 类别 | 数量 | 说明 |
|------|------|------|
| network.connectivity | 184 | 网络连接状态 |
| network.bluetooth | 105 | 蓝牙相关 |
| device_status.sensor | 91 | 传感器数据 |
| user_data.contacts | 77 | 联系人 |
| network.wifi | 69 | WiFi信息 |
| location | 52 | 位置信息 |
| user_data.account | 31 | 账户信息 |
| user_data.media | 27 | 媒体数据 |
| device_identity.hardware | 23 | 硬件标识 |
| user_data.audio | 19 | 音频数据 |
| user_data.clipboard | 19 | 剪贴板 |
| device_identity.software | 18 | 软件标识 |
| device_identity.device_info | 14 | 设备信息 |
| user_data.calendar | 11 | 日历 |
| device_identity.sim | 10 | SIM卡 |

### 5.2 privacy_apis.json 类别分布（Top 15）

| 类别 | 数量 | 说明 |
|------|------|------|
| user_data.account | 20 | 账户信息 |
| location | 19 | 位置信息 |
| network.wifi | 16 | WiFi信息 |
| device_status.battery | 14 | 电池状态 |
| device_identity.device_info | 14 | 设备信息 |
| network.bluetooth | 12 | 蓝牙相关 |
| app_environment | 12 | 应用环境 |
| user_data.clipboard | 9 | 剪贴板 |
| device_identity.sim | 8 | SIM卡 |
| media.camera | 8 | 摄像头 |
| device_status.audio | 8 | 音频状态 |
| device_identity.hardware | 7 | 硬件标识 |
| network.connectivity | 6 | 网络连接 |
| device_identity.software | 5 | 软件标识 |
| device_identity.ad_tracking | 4 | 广告追踪 |

### 5.3 差异分析

| 差异点 | sensitive_apis.json | privacy_apis.json |
|--------|---------------------|-------------------|
| **网络相关** | 358 (connectivity+bluetooth+wifi) | 40 |
| **传感器** | 91 | 0 |
| **联系人/日历** | 88 | 0 |
| **媒体** | 27 | 8 |

sensitive_apis.json 明显扩展了网络相关的 API 覆盖，并新增了传感器和联系人相关的隐私 API。

## 六、directCall 语义对比

### 6.1 directCall=true（直接调用）

**含义**：API 直接通过命名空间调用，无需先获取管理器实例。

**示例**：
```typescript
// 直接调用 - osAccount 是命名空间
let manager = osAccount.getAccountManager();
let id = manager.getOsAccountLocalId();  // indirectCall
let id = osAccount.getOsAccountLocalId();  // directCall (如果存在这种签名)
```

**敏感文件分布**：
- sensitive_apis.json: 554 (67.4%)
- privacy_apis.json: 142 (73.6%)

### 6.2 directCall=false（间接调用）

**含义**：需要先获取管理器/实例对象，然后通过实例调用。

**示例**：
```typescript
// 间接调用 - 需要先获取 AccountManager 实例
let manager = osAccount.getAccountManager();
manager.getOsAccountLocalId(callback);  // indirect call
```

**敏感文件分布**：
- sensitive_apis.json: 257 (31.3%)
- privacy_apis.json: 29 (15.0%)

### 6.3 directCall=null（常量访问）

**含义**：API 用于访问系统常量或配置，不涉及动态数据。

**敏感文件分布**：
- sensitive_apis.json: 11 (1.3%)
- privacy_apis.json: 22 (11.4%)

## 七、method 命名格式对比

### 7.1 sensitive_apis.json 命名格式

采用简洁的纯方法名：
```json
{
  "namespace": "osAccount",
  "method": "getOsAccountLocalId"
}
```

### 7.2 privacy_apis.json 命名格式

部分 API 使用完整的类.方法格式：
```json
{
  "namespace": "osAccount",
  "method": "osAccount.AccountManager.getOsAccountLocalId"
}
```

这种格式用于区分同名方法的不同实现。

## 八、@kit.BasicServicesKit 模块详细对比

### 8.1 sensitive_apis.json 中的内容

**包含的命名空间**：
- `deviceInfo` - 设备信息（UDID、序列号等）
- `SystemPasteboard` - 系统剪贴板
- `wallpaper` - 壁纸
- `deviceinfo` - 设备信息（品牌、型号等）

**API 数量**：约 100 个

### 8.2 privacy_apis.json 中的内容

**包含的命名空间**：
- `pasteboard` - 剪贴板
- `osAccount` - OS账户
- `appAccount` - 应用账户
- `distributedAccount` - 分布式账户
- `deviceInfo` - 设备信息

**API 数量**：约 50 个

### 8.3 主要差异

| 方面 | sensitive_apis.json | privacy_apis.json |
|------|---------------------|-------------------|
| **类名格式方法** | 无 | 有（如 `osAccount.AccountManager.getOsAccountLocalId`） |
| **UDID/序列号** | 有 | 无 |
| **壁纸 API** | 有 | 无 |

## 九、使用场景差异

### 9.1 sensitive_apis.json 的设计目标

1. **扩大覆盖范围**：支持更多 HarmonyOS 隐私敏感 API
2. **精细化分类**：通过 `profilingCategory` 实现更细粒度的隐私画像分析
3. **支持间接调用**：通过 `directCall=false` 识别通过管理器实例调用的 API
4. **支持新型 API**：涵盖 HMS、第三方服务等新型 API

### 9.2 privacy_apis.json 的设计目标

1. **基础覆盖**：提供核心隐私敏感 API 的覆盖
2. **简化匹配**：使用简单的命名匹配逻辑
3. **向后兼容**：保留早期的 API 格式

## 十、迁移建议

### 10.1 从 privacy_apis.json 迁移到 sensitive_apis.json

如果需要迁移，应注意以下变化：

1. **新增模块**：需要添加 27 个新的 systemPackage
2. **扩展 API**：新增约 629 个 API (822-193)
3. **调整 directCall**：新增的 API 需要设置适当的 directCall 值
4. **更新分类**：部分 API 的 profilingCategory 可能不同

### 10.2 混合使用

由于两个文件有部分重叠，可以考虑：
1. 以 sensitive_apis.json 为主
2. 补充 missing 的 privacy_apis.json 条目
3. 统一 method 命名格式

## 十一、结论

| 方面 | sensitive_apis.json 优势 | privacy_apis.json 优势 |
|------|-------------------------|------------------------|
| **覆盖范围** | ✅ 822 个 API | 193 个 API |
| **模块数量** | ✅ 57 个模块 | 34 个模块 |
| **网络分析** | ✅ 358 个网络 API | 40 个网络 API |
| **命名简洁性** | - 纯方法名 | ✅ 支持类.方法格式 |
| **兼容性** | - 新格式 | ✅ 旧项目可能使用 |

**推荐使用**：sensitive_apis.json 作为主配置文件，原因：
1. 覆盖范围更广
2. 网络相关 API 更多（对隐私分析很重要）
3. 更符合当前 HarmonyOS SDK 的 API 命名规范

---

*文档生成时间：2026-07-03*
*ArkPrism 项目*
