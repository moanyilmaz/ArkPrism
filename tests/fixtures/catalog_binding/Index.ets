import radio from '@ohos.telephony.radio';
import appAccount from '@ohos.account.appAccount';
import photoAccessHelper from '@ohos.file.photoAccessHelper';
import sensor from '@ohos.sensor';

export function networkCallback() {
  radio.getNetworkState((error, data) => console.info(data));
}

export function networkPromise() {
  const pending = radio.getNetworkState(0);
  pending.then(data => console.info(data));
}

export function accountCallback() {
  const manager = appAccount.createAppAccountManager();
  manager.getAllAccounts((error, data) => console.info(data));
}

export function accountPromise() {
  const manager = appAccount.createAppAccountManager();
  const pending = manager.getAllAccounts('owner');
  pending.then(data => console.info(data));
}

export function thumbnailAlias(asset: photoAccessHelper.PhotoAsset) {
  const pending = asset.getThumbnail();
  pending.then(data => console.info(data));
}

export function dynamicSensor(id: sensor.SensorId) {
  sensor.on(id, data => console.info(JSON.stringify(data)));
}
