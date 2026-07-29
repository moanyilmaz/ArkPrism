import { AbilityConstant, UIAbility, Want } from '@kit.AbilityKit';
import { identifier } from '@kit.AdsKit';

export default class EntryAbility extends UIAbility {
  onCreate(want: Want, launchParam: AbilityConstant.LaunchParam): void {
    this.execute();
  }

  private execute(): void {
    identifier.getOAID().then((value) => {
      console.info('diagnostic', 'success');
    }, (error) => {
      console.info('diagnostic', String(error));
    });
  }
}
