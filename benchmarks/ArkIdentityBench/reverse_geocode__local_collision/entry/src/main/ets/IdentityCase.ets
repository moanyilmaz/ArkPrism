import { geoLocationManager } from '@kit.LocationKit';
const local = { getAddressesFromLocation: () => 'local' };
export function execute(): void {
  local.getAddressesFromLocation();
}
