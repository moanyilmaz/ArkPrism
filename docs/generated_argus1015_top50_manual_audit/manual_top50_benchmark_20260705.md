# ARGUS-1015 Top-50 Manual Benchmark Audit

Generated at: 2026-07-05T11:23:16.841Z

## Summary

| Metric | Automatic presence after hardening | Manual-corrected top50 |
|---|---:|---:|
| Projects | 50 | 50 |
| API usages | 1127 | 1127 |
| Call chains | 1127 | 1127 |
| Data sinks | 800 | 800 |
| Taint flows | 820 | 820 |
| Project-level namespace+method predicted | 438 | 438 |
| Gold methods | 413 | 438 |
| TP | 413 | 438 |
| FP* | 25 | 0 |
| FN | 0 | 0 |
| Precision | 94.29% | 100.00% |
| Recall | 100.00% | 100.00% |

Manual correction scope: only the top-50 high-output samples. It does not by itself prove full-dataset precision is 100%.

## Manual-Confirmed Remaining Benchmark Gaps

| Project | Key | Report evidence | Source evidence | Strategy | Classification |
|---|---|---|---|---|---|
| CommonAppDevelopment | `photoaccesshelper|createAsset` | `%3 = instanceinvoke helper.<@%unk/%unk: .createAsset()>(%2, 'jpg')` | 97:     const context = getContext(this) as common.UIAbilityContext; // 获取getPhotoAccessHelper需要的context<br>98:     const helper = photoAccessHelper.getPhotoAccessHelper(context); // 获取相册管理模块的实例<br>99:     const uri = await helper.createAsset(photoAccessHelper.PhotoType.IMAGE, 'jpg'); // 指定待创建的文件类型、后缀和创建选项，创建图片或视频资源<br>100:     const file = await fs.open(uri, fs.OpenMode.READ_WRITE \| fs.OpenMode.CREATE);<br>101:     await fs.write(file.fd, buffer); | .method | manual_true_positive_benchmark_gap |
| CommonAppDevelopment | `calendarmanager|getCalendar` | `%7 = instanceinvoke %6.<@%unk/%unk: .getCalendar()>(%5)` | 126:       this.calendarMgr = calendarManager.getCalendarManager(this.context);<br>127:       // 获取Calendar对象<br>128:       this.calendarMgr.getCalendar(this.myCalendarAccount).then((data: calendarManager.Calendar) => {<br>129:         this.calendar = data;<br>130:         // 设置日历配置信息 | .method | manual_true_positive_benchmark_gap |
| CommonAppDevelopment | `netquality|on` | `instanceinvoke geoLocationManager.<@%unk/%unk: .on()>('locationChange', requestInfo, locationChange)` | 315:       }<br>316:     };<br>317:     geoLocationManager.on('locationChange', requestInfo, locationChange);<br>318:   }<br>319:  | namespace.method | manual_true_positive_benchmark_gap |
| CommonAppDevelopment | `camera|createCameraInput` | `cameraInput = instanceinvoke cameraManager.<@%unk/%unk: .createCameraInput()>(cameraDevice)` | 178:     let cameraInput: camera.CameraInput \| undefined = undefined;<br>179:     try {<br>180:       cameraInput = cameraManager.createCameraInput(cameraDevice);<br>181:       logger.info(TAG, 'createCameraInputFn success');<br>182:     } catch (error) { | .method | manual_true_positive_benchmark_gap |
| Wechat_HarmonyOS | `deviceinfo|sdkApiVersion` | `%2 = deviceInfo.<@%unk/%unk: .sdkApiVersion>` | 50:     this.marketName = deviceInfo.marketName<br>51:     this.osFullName = deviceInfo.osFullName<br>52:     this.sdkApiVersion = `${deviceInfo.sdkApiVersion}`<br>53:     this.deviceType = deviceInfo.deviceType<br>54:     //利用@kit.ArkTs获取系统运行时间，返回值是毫秒 | namespace.method | manual_true_positive_benchmark_gap |
| legado-Harmony-main | `photoaccesshelper|createAsset` | `%2 = instanceinvoke helper.<@%unk/%unk: .createAsset()>(%1, 'jpg')` | 205:             let context = getContext();<br>206:             let helper = photoAccessHelper.getPhotoAccessHelper(context);<br>207:             let uri = await helper.createAsset(photoAccessHelper.PhotoType.IMAGE, 'jpg');<br>208:             let file = await fs.open(uri, fs.OpenMode.READ_WRITE \| fs.OpenMode.CREATE);<br>209:             await fs.write(file.fd, data); | .method | manual_true_positive_benchmark_gap |
| applications_settings | `audio|getVolumeGroupManager` | `%6 = instanceinvoke %5.<@%unk/%unk: .getVolumeGroupManager()>(groupId)` | 35:   if (!context) {<br>36:     GlobalContext.getContext().setObject(GlobalContext.globalKeyAudioVolumeGroupManager,<br>37:       getAudioManager().getVolumeManager().getVolumeGroupManager(groupId));<br>38:   }<br>39:   return GlobalContext.getContext().getObject(GlobalContext.globalKeyAudioVolumeGroupManager) as Audio.AudioVolumeGroupManager; | .method | manual_true_positive_benchmark_gap |
| harmonyos_samples_network-query | `netquality|on` | `instanceinvoke netQuality.<@%unk/%unk: .on()>('netQosChange', %AM1$onQosChange)` | 136:   onQosChange(): void {<br>137:     try {<br>138:       netQuality.on('netQosChange', (list: netQuality.NetworkQos[]) => {<br>139:         if (list.length > 0) {<br>140:           list.forEach(async (qos) => { | namespace.method | manual_true_positive_benchmark_gap |
| harmonyos_samples_network-query | `netquality|off` | `instanceinvoke netQuality.<@%unk/%unk: .off()>('netQosChange')` | 271:   aboutToDisappear(): void {<br>272:     try {<br>273:       netQuality.off('netQosChange');<br>274:     } catch (err) {<br>275:       let error = err as BusinessError; | namespace.method | manual_true_positive_benchmark_gap |
| harmonyos_samples_CustomCamera | `camera|createCameraInput` | `%2 = instanceinvoke %1.<@%unk/%unk: .createCameraInput()>(device)` | 70:       }<br>71:       // [Start cameraInput]<br>72:       this.cameraInput = this.cameraManager?.createCameraInput(device);<br>73:       await this.cameraInput?.open();<br>74:       // [End cameraInput] | .method | manual_true_positive_benchmark_gap |
| harmonyos_samples_CustomCamera | `camera|getSupportedCameras` | `cameraDevices = instanceinvoke %0.<@%unk/%unk: .getSupportedCameras()>()` | 141:   // [Start getCameraDevice]<br>142:   getCameraDevice(cameraPosition: camera.CameraPosition): camera.CameraDevice \| undefined {<br>143:     const cameraDevices = this.cameraManager?.getSupportedCameras();<br>144:     if (!cameraDevices) {<br>145:       Logger.error(TAG, `Failed to get camera device. cameraPosition: ${cameraPosition}}`); | .method | manual_true_positive_benchmark_gap |
| harmonyos_samples_CustomCamera | `photoaccesshelper|createAsset` | `%4 = instanceinvoke videoAccessHelper.<@%unk/%unk: .createAsset()>(%3, 'mp4', options)` | 261:     let videoAccessHelper: photoAccessHelper.PhotoAccessHelper = photoAccessHelper.getPhotoAccessHelper(this.context);<br>262:     try {<br>263:       this.videoUri = await videoAccessHelper.createAsset(photoAccessHelper.PhotoType.VIDEO, 'mp4', options);<br>264:       this.file = fileIo.openSync(this.videoUri, fileIo.OpenMode.READ_WRITE \| fileIo.OpenMode.CREATE);<br>265:     } catch (exception) { | .method | manual_true_positive_benchmark_gap |
| Photos | `photoaccesshelper|createAsset` | `%4 = instanceinvoke %3.<@%unk/%unk: .createAsset()>(displayName, albumUri)` | 51:   async createOne(displayName: string, albumUri: string): Promise<photoAccessHelper.PhotoAsset> {<br>52:     Log.info(TAG, 'createOne displayName:' + displayName + ' albumUri: ' + albumUri);<br>53:     let fileAsset = await this.userFileMgr.createAsset(displayName, albumUri);<br>54:     let album = await this.getUserAlbumItemByUri(albumUri);<br>55:     await album.addAssets([fileAsset]); | .method | manual_true_positive_benchmark_gap |
| Photos | `photoaccesshelper|getAssets` | `%1 = instanceinvoke %0.<@%unk/%unk: .getAssets()>(fetchOption)` | 198:     let fetchFileResult: photoAccessHelper.FetchResult = null;<br>199:     try {<br>200:       fetchFileResult = await this.userFileMgr.getAssets(fetchOption);<br>201:       Log.debug(TAG, 'deleteAll getPhotoAssets');<br>202:       let deleteAllGetAllObject = hiSysEventDataQueryTimedOut('deleteAllGetAllObject'); | .method | manual_true_positive_benchmark_gap |
| applications_systemui | `audio|getVolumeGroupManager` | `%4 = instanceinvoke %3.<@%unk/%unk: .getVolumeGroupManager()>(%1)` | 39:     this.mIsStart = true;<br>40: <br>41:     this.mAudioManager = await getAudioManager().getVolumeManager().getVolumeGroupManager(audio.DEFAULT_VOLUME_GROUP_ID);<br>42: <br>43:     this.getRingerMode(); | .method | manual_true_positive_benchmark_gap |
| legado-Harmony-master | `photoaccesshelper|createAsset` | `%2 = instanceinvoke helper.<@%unk/%unk: .createAsset()>(%1, 'jpg')` | 205:             let context = getContext();<br>206:             let helper = photoAccessHelper.getPhotoAccessHelper(context);<br>207:             let uri = await helper.createAsset(photoAccessHelper.PhotoType.IMAGE, 'jpg');<br>208:             let file = await fs.open(uri, fs.OpenMode.READ_WRITE \| fs.OpenMode.CREATE);<br>209:             await fs.write(file.fd, data); | .method | manual_true_positive_benchmark_gap |
| Camera_js | `photoaccesshelper|createAsset` | `%4 = instanceinvoke %3.<@%unk/%unk: .createAsset()>(fileName)` | 203:       Logger.info(TAG, 'savePicture start');<br>204:       let fileName = `${Date.now()}.jpg`;<br>205:       let fileAsset = await this.accessHelper.createAsset(fileName);<br>206:       let imgPhotoUri: string = fileAsset.uri;<br>207:       const fd = await fileAsset.open('rw'); | .method | manual_true_positive_benchmark_gap |
| Camera_js | `camera|getSupportedCameras` | `%1 = instanceinvoke %0.<@%unk/%unk: .getSupportedCameras()>()` | 499:    */<br>500:   isCameraSwitchSupportedFn(): boolean {<br>501:     return this.cameraManager.getSupportedCameras().length > 1;<br>502:   }<br>503:  | .method | manual_true_positive_benchmark_gap |
| Camera_js | `photoaccesshelper|getAssets` | `%8 = instanceinvoke phAccessHelper.<@%unk/%unk: .getAssets()>(fetchOptions)` | 176:     };<br>177:     let phAccessHelper = photoAccessHelper.getPhotoAccessHelper(GlobalContext.get().getCameraSettingContext());<br>178:     let fetchResult: photoAccessHelper.FetchResult<photoAccessHelper.PhotoAsset> = await phAccessHelper.getAssets(fetchOptions);<br>179:     let photoAsset: photoAccessHelper.PhotoAsset = await fetchResult.getFirstObject();<br>180:     this.imgThumbnail = await photoAsset.uri; | .method | manual_true_positive_benchmark_gap |
| AVCodec | `photoaccesshelper|createAsset` | `%4 = instanceinvoke helper.<@%unk/%unk: .createAsset()>(%2, 'mp4', %3)` | 327:             const context = this.getUIContext().getHostContext();<br>328:             let helper = photoAccessHelper.getPhotoAccessHelper(context);<br>329:             let uri = await helper.createAsset(photoAccessHelper.PhotoType.VIDEO, 'mp4', {<br>330:               title: `AVCodecVideo_${DATETIME.getDate()}_${DATETIME.getTime()}`<br>331:             }); | .method | manual_true_positive_benchmark_gap |
| AVCodec | `camera|createCameraInput` | `cameraInput = instanceinvoke cameraManager.<@%unk/%unk: .createCameraInput()>(%15)` | 246:     // Create the cameraInput object.<br>247:     try {<br>248:       cameraInput = cameraManager.createCameraInput(cameraDevices[0]);<br>249:     } catch (error) {<br>250:       let err = error as BusinessError; | .method | manual_true_positive_benchmark_gap |
| harmonyos_samples_graphic-creation | `camera|createCameraInput` | `%1 = instanceinvoke %0.<@%unk/%unk: .createCameraInput()>(camera)` | 92:   private async createCameraInputFn(camera: camera.CameraDevice) {<br>93:     try {<br>94:       this.cameraInput = this.cameraManager?.createCameraInput(camera)<br>95:       Logger.info(this.tag, `createCameraInputFn success: ${this.cameraInput}`)<br>96:     } catch (err) { | .method | manual_true_positive_benchmark_gap |
| com.example.myapplication2 | `sms|hasSmsCapability` | `%0 = instanceinvoke sms.<@%unk/%unk: .hasSmsCapability()>()` | 113:     try {<br>114:       let info = `[短信信息]\n`;<br>115:       info += `- 短信能力: ${sms.hasSmsCapability() ? '有' : '无'}\n`;<br>116:       info += `- 默认SIM卡ID: ${sms.getDefaultSmsSimId()}\n`;<br>117:       this.appendData(info); | namespace.method | manual_true_positive_benchmark_gap |
| com.example.myapplication2 | `sms|getDefaultSmsSimId` | `%5 = instanceinvoke sms.<@%unk/%unk: .getDefaultSmsSimId()>()` | 114:       let info = `[短信信息]\n`;<br>115:       info += `- 短信能力: ${sms.hasSmsCapability() ? '有' : '无'}\n`;<br>116:       info += `- 默认SIM卡ID: ${sms.getDefaultSmsSimId()}\n`;<br>117:       this.appendData(info);<br>118:     } catch (err) { | namespace.method | manual_true_positive_benchmark_gap |
| Exam | `pasteboard|getData` | `instanceinvoke %1.<@%unk/%unk: .getData()>(%AM8$%AM7$pasteBuilder)` | 143:         .onClick((_event: ClickEvent, result: PasteButtonOnClickResult) => {<br>144:           if (PasteButtonOnClickResult.SUCCESS === result) {<br>145:             pasteboard.getSystemPasteboard().getData((err: BusinessError, pasteData: pasteboard.PasteData) => {<br>146:               if (err) {<br>147:                 return; | .method | manual_true_positive_benchmark_gap |

## Project-Level Top50 Metrics

| Project | API usages | Detected methods | Auto gold | Auto TP | Auto FP* | Auto FN |
|---|---:|---:|---:|---:|---:|---:|
| CommonAppDevelopment | 128 | 34 | 30 | 30 | 4 | 0 |
| Wechat_HarmonyOS | 65 | 44 | 43 | 43 | 1 | 0 |
| legado-Harmony-main | 61 | 38 | 37 | 37 | 1 | 0 |
| Snake_NEXT-main | 50 | 19 | 19 | 19 | 0 | 0 |
| harmony-next-music-sharing | 48 | 41 | 41 | 41 | 0 | 0 |
| STUFFS_NEXT-master | 45 | 33 | 33 | 33 | 0 | 0 |
| applications_settings | 43 | 13 | 12 | 12 | 1 | 0 |
| harmonyos4me_ResponsiveLayout | 41 | 1 | 1 | 1 | 0 | 0 |
| harmonyos4me_ZUtils | 33 | 26 | 26 | 26 | 0 | 0 |
| harmonyos4me_MultiVideoApplication | 32 | 2 | 2 | 2 | 0 | 0 |
| harmony-arkts-chat-app-ui | 29 | 4 | 4 | 4 | 0 | 0 |
| harmonyos_samples_network-query | 26 | 14 | 12 | 12 | 2 | 0 |
| harmonyProject-master | 26 | 20 | 20 | 20 | 0 | 0 |
| harmonyos_samples_CustomCamera | 23 | 8 | 5 | 5 | 3 | 0 |
| Dictionareow | 22 | 2 | 2 | 2 | 0 | 0 |
| Photos | 22 | 3 | 1 | 1 | 2 | 0 |
| applications_systemui | 21 | 7 | 6 | 6 | 1 | 0 |
| Gramony | 19 | 6 | 6 | 6 | 0 | 0 |
| Homogram | 19 | 6 | 6 | 6 | 0 | 0 |
| harmonyos4me_readerkit_samplecode_arkts | 18 | 2 | 2 | 2 | 0 | 0 |
| UserAuthentication | 18 | 2 | 2 | 2 | 0 | 0 |
| Melotopia-HMOS | 17 | 3 | 3 | 3 | 0 | 0 |
| MultiVideoApplication | 17 | 1 | 1 | 1 | 0 | 0 |
| harmonyos4me_MultiDeviceCommunication | 14 | 2 | 2 | 2 | 0 | 0 |
| uitest | 14 | 1 | 1 | 1 | 0 | 0 |
| ChildrenEducation | 13 | 4 | 4 | 4 | 0 | 0 |
| legado-Harmony-master | 13 | 4 | 3 | 3 | 1 | 0 |
| siyuan-harmony | 13 | 6 | 6 | 6 | 0 | 0 |
| Spaceow | 13 | 3 | 3 | 3 | 0 | 0 |
| DistributedAuthentication | 12 | 5 | 5 | 5 | 0 | 0 |
| harmonyos_samples_continue-progress | 12 | 2 | 2 | 2 | 0 | 0 |
| HarmonyOS-Inno | 12 | 5 | 5 | 5 | 0 | 0 |
| harmonyos4me_HMRouter | 12 | 2 | 2 | 2 | 0 | 0 |
| Renameow | 12 | 3 | 3 | 3 | 0 | 0 |
| Wake-HarmonyOS | 12 | 7 | 7 | 7 | 0 | 0 |
| Aigis | 11 | 3 | 3 | 3 | 0 | 0 |
| Audio | 11 | 3 | 3 | 3 | 0 | 0 |
| Camera_js | 11 | 5 | 2 | 2 | 3 | 0 |
| MNUIKitDemo | 11 | 2 | 2 | 2 | 0 | 0 |
| SmartHome | 11 | 9 | 9 | 9 | 0 | 0 |
| Wlan | 11 | 10 | 10 | 10 | 0 | 0 |
| aloeplayer_ohos | 10 | 2 | 2 | 2 | 0 | 0 |
| AVCodec | 10 | 4 | 2 | 2 | 2 | 0 |
| FoldableAdaptation | 10 | 1 | 1 | 1 | 0 | 0 |
| harmonyos_samples_graphic-creation | 10 | 5 | 4 | 4 | 1 | 0 |
| harmonyos4me_transitions-collection | 10 | 1 | 1 | 1 | 0 | 0 |
| com.example.myapplication2 | 9 | 9 | 7 | 7 | 2 | 0 |
| Exam | 9 | 3 | 2 | 2 | 1 | 0 |
| harmonyos4me_accountkit-samplecode-clientdemo-arkts | 9 | 3 | 3 | 3 | 0 | 0 |
| LiveStreaming | 9 | 5 | 5 | 5 | 0 | 0 |
