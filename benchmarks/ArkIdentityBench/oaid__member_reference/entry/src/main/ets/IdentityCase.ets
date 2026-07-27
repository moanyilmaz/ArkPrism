import { identifier } from '@kit.AdsKit';
export function execute(): void {
  const ref = identifier.getOAID;
  console.info(String(ref));
}
