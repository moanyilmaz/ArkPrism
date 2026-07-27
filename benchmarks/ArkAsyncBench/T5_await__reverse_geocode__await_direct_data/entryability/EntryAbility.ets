import { AbilityConstant, UIAbility, Want } from '@kit.AbilityKit';
import { geoLocationManager } from '@kit.LocationKit';

export default class EntryAbility extends UIAbility {
  onCreate(want: Want, launchParam: AbilityConstant.LaunchParam): void {
    this.execute();
  }

  private async execute(): Promise<void> {
    const value = await geoLocationManager.getAddressesFromLocation({ latitude: 31.2, longitude: 121.5, maxItems: 1 });
    console.info('privacy', String(value));
  }
}
