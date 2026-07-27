import { sim } from '@kit.TelephonyKit';
const local = { getSimAccountInfo: () => 'local' };
export function execute(): void {
  local.getSimAccountInfo();
}
