import { AbilityConstant, UIAbility, Want } from '@kit.AbilityKit';
import { identifier } from '@kit.AdsKit';

export default class EntryAbility extends UIAbility {
  onCreate(want: Want, launchParam: AbilityConstant.LaunchParam): void {
    this.execute();
  }

  private execute(): void {
    identifier.getOAID()
      .then((value) => {
        const alias = value;
        return Promise.resolve(alias);
      })
      .then((value) => {
        console.info('privacy', String(value));
      });
  }
}
