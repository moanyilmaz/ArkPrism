import { geoLocationManager } from '@kit.LocationKit';
export function execute(): void {
  const value = geoLocationManager.getAddressesFromLocation();
  console.info(String(value));
}
