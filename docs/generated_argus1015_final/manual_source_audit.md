# ARGUS-1015 High-Result Manual Source Audit

Generated for the paper-style ARGUS-1015 analysis. This is a purposive manual audit, not a full human ground truth set. Samples were selected from the projects with high privacy API usage, high taint-flow count, and high sink count, while covering demo applications, a large multi-module application, a system-settings application, and a utility library.

## Selection

| Project | Files | Methods | ArkPrism APIs | Sinks | Taint flows | Selection reason |
|---|---:|---:|---:|---:|---:|---|
| Wechat_HarmonyOS | 59 | 475 | 57 | 65 | 43 | Highest API usage and high sink count |
| CommonAppDevelopment | 1620 | 10757 | 54 | 44 | 205 | Largest project and highest taint-flow count |
| legado-Harmony-main | 360 | 3576 | 52 | 77 | 53 | High API usage and highest sink count among selected projects |
| Snake_NEXT-main | 45 | 441 | 50 | 40 | 63 | High API usage and second-highest taint-flow count |
| applications_settings | 163 | 2200 | 41 | 7 | 44 | System-settings style project with real device/network controls |
| harmonyos4me_ZUtils | 107 | 798 | 29 | 26 | 29 | Utility library with concentrated identity and clipboard wrappers |

## Manual Evidence

| Project | Source evidence | Sensitive API family | Manual judgment |
|---|---|---|---|
| Wechat_HarmonyOS | `entry/src/main/ets/pages/sensor.ets:13` uses `sensor.on(sensor.SensorId.ACCELEROMETER, ...)`; `sensor.ets:22` uses `sensor.off(sensor.SensorId.ACCELEROMETER)`; additional sensor calls appear for uncalibrated accelerometer, ambient light, barometer, and heart rate. | Sensor status | Real sensitive API usage exists. Repeated demo pages explain the high API count. |
| Wechat_HarmonyOS | `entry/src/main/ets/pages/camera.ets:19` uses `cameraManager.getSupportedCameras()`. | Camera metadata | Real sensitive API usage exists. |
| Wechat_HarmonyOS | `entry/src/main/ets/pages/Account.ets:31` uses `accountManager.getOsAccountLocalId(...)`; `entry/src/main/ets/pages/OAID.ets:51` and `:88` use `identifier.getOAID(...)`. | Account and advertising/device identifier | Real sensitive API usage exists. |
| Wechat_HarmonyOS | `entry/src/main/ets/pages/network_info.ets:4` and `:26` use `connection.getDefaultNet()`; `network_info.ets:9` and `:31` use `connection.getNetCapabilities(...)`. | Network connectivity | Real sensitive API usage exists. |
| CommonAppDevelopment | `product/entry/src/main/ets/view/HelperView.ets:106` and `:148` use `connection.hasDefaultNetSync()`. | Network connectivity | Real sensitive API usage exists. |
| CommonAppDevelopment | `feature/imagecompression/src/main/ets/view/ImageCompression.ets:141` uses `helper.createAsset(...)`; `ImageCompression.ets:441` uses `HELPER.createAsset(...)`. | Media/photo library write | Real sensitive API usage exists. |
| CommonAppDevelopment | `feature/photopickandsave/src/main/ets/components/SavePictureFromWeb.ets:51` uses `request.downloadFile(...)`; `feature/videotrimmer/src/main/ets/uploadanddownload/RequestDownload.ets:72` uses `request.agent.create(...)`. | Network download/request agent | Real sensitive API usage exists. The high taint-flow count is plausible because this sample has many callbacks, UI updates, and module wrappers. |
| legado-Harmony-main | `entry/src/main/ets/common/utils/utils.ets:7` uses `pasteboard.getSystemPasteboard().getUnifiedDataSync()`; `entry/src/main/ets/pages/Clipboard.ets:17` uses `pasteboard.getSystemPasteboard()`; `Clipboard.ets:19` uses `systemPasteboard.getData(...)`. | Clipboard | Real sensitive API usage exists. |
| legado-Harmony-main | `entry/src/main/ets/pages/sensor.ets:13` uses `sensor.on(sensor.SensorId.ACCELEROMETER, ...)`; `sensor.ets:22` uses `sensor.off(sensor.SensorId.ACCELEROMETER)`. | Sensor status | Real sensitive API usage exists. |
| legado-Harmony-main | `entry/src/main/ets/pages/Account.ets:18` uses `accountManager.getOsAccountLocalId(...)`; `Account.ets:45` uses `appAccountManager.getAllAccounts(...)`; `Account.ets:62` uses `accountAbility.getOsAccountDistributedInfo(...)`. | Account and distributed account info | Real sensitive API usage exists. |
| Snake_NEXT-main | `entry/src/main/ets/pages/camera.ets:19` uses `cameraManager.getSupportedCameras()`. | Camera metadata | Real sensitive API usage exists. |
| Snake_NEXT-main | `entry/src/main/ets/pages/network_info.ets:4` and `:26` use `connection.getDefaultNet()`; `network_info.ets:9` and `:31` use `connection.getNetCapabilities(...)`. | Network connectivity | Real sensitive API usage exists. |
| Snake_NEXT-main | `entry/src/main/ets/pages/OAID.ets:51` and `:88` use `identifier.getOAID(...)`; `entry/src/main/ets/pages/bluetooth.ets:11` uses `access.enableBluetooth()`; `bluetooth.ets:18` uses `access.getState()`. | Device identifier and Bluetooth | Real sensitive API usage exists. |
| Snake_NEXT-main | `entry/src/main/ets/pages/Clipboard.ets:12` uses `pasteboard.getSystemPasteboard()`; `Clipboard.ets:14` uses `systemPasteboard.getData(...)`. | Clipboard | Real sensitive API usage exists. |
| applications_settings | `product/phone/src/main/ets/pages/aboutDevice.ets:116` uses `deviceInfo.productModel`; `:122` uses `deviceInfo.manufacture`; `:128` uses `deviceInfo.serial`; `:134` uses `deviceInfo.displayVersion`. | Hardware/software device identity | Real sensitive API usage exists. |
| applications_settings | `product/phone/src/main/ets/model/locationServicesImpl/LocationService.ts:46` uses `geolocation.isLocationEnabled()`; `product/phone/src/main/ets/model/wifiImpl/WifiModel.ts:312` uses `wifi.scan()`. | Location and Wi-Fi | Real sensitive API usage exists. |
| applications_settings | `product/phone/src/main/ets/model/volumeControlImpl/VolumeControlModel.ts:28` uses `Audio.getAudioManager()`; `:50` uses `getVolumeManager().on('volumeChange', ...)`; `product/phone/src/main/ets/model/bluetoothImpl/BluetoothModel.ts:110`, `:112`, and `:114` use `bluetoothManager.getProfileInstance(...)`. | Audio and Bluetooth | Real sensitive API usage exists. |
| harmonyos4me_ZUtils | `zutils/src/main/ets/utils/IdentUtil.ets:14` returns `deviceInfo.brand`; `:24` uses `deviceInfo.osFullName` and `deviceInfo.displayVersion`; `:34` returns `deviceInfo.marketName`. | Device identity | Real sensitive API usage exists. |
| harmonyos4me_ZUtils | `zutils/src/main/ets/utils/IdentUtil.ets:43` uses `identifier.getOAID()`; `:44` uses `AAID.getAAID()`. | Advertising identifier | Real sensitive API usage exists. |
| harmonyos4me_ZUtils | `zutils/src/main/ets/utils/IdentUtil.ets:49-77` logs many `deviceInfo` fields, including `manufacture`, `productModel`, `serial`, `displayVersion`, `osFullName`, and `udid`. | Hardware/software device identity | Real sensitive API usage exists and is concentrated in a reusable utility wrapper. |
| harmonyos4me_ZUtils | `zutils/src/main/ets/utils/CopyUtil.ets:19` uses `pasteboard.getSystemPasteboard()`; `CopyUtil.ets:20` uses `systemPasteboard.setData(...)`. | Clipboard | Real sensitive API usage exists. |

## Interpretation

The manually audited high-result samples contain concrete source-level sensitive API evidence. Their high counts are not caused by arbitrary string matches alone. However, the audit also shows two important threats to validity:

1. Several projects are capability-demo applications with many independent pages for sensors, camera, account, OAID, network, Bluetooth, and clipboard APIs. This makes API and sink counts naturally high.
2. Some high-result projects share similar demo-page templates, for example `Wechat_HarmonyOS`, `Snake_NEXT-main`, and `legado-Harmony-main`. Paper conclusions should therefore report ARGUS-1015 as a large benchmark corpus, while acknowledging that part of the high-count tail contains non-independent code patterns.

This manual audit supports using the automated presence and qualified benchmarks as scalable labels, but it should not be described as a complete human ground truth for all 1015 projects.
