import { geoLocationManager } from '@kit.LocationKit';
export function execute(): void {
  geoLocationManager.getAddressesFromLocation();
}
