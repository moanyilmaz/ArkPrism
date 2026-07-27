import { identifier } from '@kit.AdsKit';
const local = { getOAID: () => 'local' };
export function execute(): void {
  local.getOAID();
}
