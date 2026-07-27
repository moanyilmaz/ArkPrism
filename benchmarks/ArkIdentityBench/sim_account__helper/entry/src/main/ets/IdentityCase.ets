import { sim } from '@kit.TelephonyKit';
function helper(): void {
  sim.getSimAccountInfo();
}
export function execute(): void {
  helper();
}
