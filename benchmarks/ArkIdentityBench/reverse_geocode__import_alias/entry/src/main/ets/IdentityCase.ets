import { geoLocationManager as geo } from '@kit.LocationKit';
export function execute(): void {
  geo.getAddressesFromLocation();
}
