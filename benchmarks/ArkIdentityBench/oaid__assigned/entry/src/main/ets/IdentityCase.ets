import { identifier } from '@kit.AdsKit';
export function execute(): void {
  const value = identifier.getOAID();
  console.info(String(value));
}
