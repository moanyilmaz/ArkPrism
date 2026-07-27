import { AbilityConstant, UIAbility, Want } from '@kit.AbilityKit';
import sim from '@ohos.telephony.sim';

export default class EntryAbility extends UIAbility {
  onCreate(want: Want, launchParam: AbilityConstant.LaunchParam): void {
    this.execute();
  }

  private async execute(): Promise<void> {
    const pending = sim.getSimAccountInfo(0);
    pending.then((value) => {
      const alias = value;
      console.info('privacy', String(alias));
    });
  }
}
