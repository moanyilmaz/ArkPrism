import { sim } from '@kit.TelephonyKit';
export function execute(): void {
  const value = sim.getSimAccountInfo();
  console.info(String(value));
}
