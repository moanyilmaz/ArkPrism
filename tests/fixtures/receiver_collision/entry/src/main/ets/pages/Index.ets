import deviceManager from '@ohos.distributedDeviceManager';
import ble from '@kit.ConnectivityKit';
import osAccount from '@ohos.account.osAccount';

class CustomDialogController {
  close(): void {
  }
}

class GattClientManager {
  readCharacteristicValue(): void {
  }
}

class DistributedAccountModel {
  getOsAccountDistributedInfo(): void {
  }
}

export function invokeApplicationMethods(
  controller: CustomDialogController,
  wrapper: GattClientManager,
  accountModel: DistributedAccountModel,
): void {
  controller.close();
  wrapper.readCharacteristicValue();
  accountModel.getOsAccountDistributedInfo();
  deviceManager;
  ble;
  osAccount;
}
