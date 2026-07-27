import { geoLocationManager } from '@kit.LocationKit';
function helper(): void {
  geoLocationManager.getAddressesFromLocation();
}
export function execute(): void {
  helper();
}
