import deviceInfo from '@ohos.deviceInfo';
export function execute(): void {
  const value = deviceInfo.serial;
  console.info(String(value));
}
