import { geoLocationManager } from '@kit.LocationKit';
export function execute(): void {
  const ref = geoLocationManager.getAddressesFromLocation;
  console.info(String(ref));
}
