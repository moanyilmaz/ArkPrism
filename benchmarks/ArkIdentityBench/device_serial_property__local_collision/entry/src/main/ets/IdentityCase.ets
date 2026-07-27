import deviceInfo from '@ohos.deviceInfo';
const local = { serial: () => 'local' };
export function execute(): void {
  local.serial();
}
