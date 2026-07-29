import { AbilityConstant, UIAbility, Want } from '@kit.AbilityKit';
import { identifier } from '@kit.AdsKit';

export default class EntryAbility extends UIAbility {
  onCreate(want: Want, launchParam: AbilityConstant.LaunchParam): void {
    this.execute();
  }

  private execute(): void {
    const pending = identifier.getOAID();
    const alias = pending;
    alias.then((value) => {
      console.info('privacy', String(value));
    });
  }
}
