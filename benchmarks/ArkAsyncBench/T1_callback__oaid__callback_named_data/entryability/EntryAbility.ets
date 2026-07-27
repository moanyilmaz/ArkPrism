import { AbilityConstant, UIAbility, Want } from '@kit.AbilityKit';
import { identifier } from '@kit.AdsKit';

export default class EntryAbility extends UIAbility {
  onCreate(want: Want, launchParam: AbilityConstant.LaunchParam): void {
    this.execute();
  }

  private async execute(): Promise<void> {
    const handler = (error, value) => {
      console.info('privacy', String(value));
    };
    identifier.getOAID(handler);
  }
}
