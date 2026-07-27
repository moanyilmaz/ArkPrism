import deviceInfo from '@ohos.deviceInfo';
export function execute(): void {
  const ref = deviceInfo;
  console.info('serial', String(ref));
}
