import { sim as telephonySim } from '@kit.TelephonyKit';
export function execute(): void {
  telephonySim.getSimAccountInfo();
}
