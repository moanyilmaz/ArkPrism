import { sim } from '@kit.TelephonyKit';
export function execute(): void {
  const ref = sim.getSimAccountInfo;
  console.info(String(ref));
}
