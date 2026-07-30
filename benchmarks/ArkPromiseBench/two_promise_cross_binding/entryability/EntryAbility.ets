import { AbilityConstant, UIAbility, Want } from '@kit.AbilityKit';
import { identifier } from '@kit.AdsKit';

export default class EntryAbility extends UIAbility {
  onCreate(want: Want, launchParam: AbilityConstant.LaunchParam): void {
    this.execute();
  }

  private execute(): void {
    const sensitive = identifier.getOAID();
    const independent = Promise.resolve('constant');
    sensitive.then((_value) => {
      console.info('diagnostic', 'source completed');
    });
    independent.then((value) => {
      console.info('diagnostic', String(value));
    });
  }
}
