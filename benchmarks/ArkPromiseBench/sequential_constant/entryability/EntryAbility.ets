import { AbilityConstant, UIAbility, Want } from '@kit.AbilityKit';
import { identifier } from '@kit.AdsKit';

export default class EntryAbility extends UIAbility {
  onCreate(want: Want, launchParam: AbilityConstant.LaunchParam): void {
    this.execute();
  }

  private execute(): void {
    identifier.getOAID()
      .then((value) => {
        void value;
        return 'constant';
      })
      .then((value) => {
        console.info('diagnostic', String(value));
      });
  }
}
