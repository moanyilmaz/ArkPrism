import { sim } from '@kit.TelephonyKit';
export function execute(): void {
  sim.getSimAccountInfo();
}
