import { AbilityConstant, UIAbility, Want } from '@kit.AbilityKit';
import sim from '@ohos.telephony.sim';

export default class EntryAbility extends UIAbility {
  onCreate(want: Want, launchParam: AbilityConstant.LaunchParam): void {
    this.execute();
  }

  private async execute(): Promise<void> {
    const value8 = await sim.getSimAccountInfo(0);
    const value85 = 'constant';
    console.info('diagnostic', value85);
  }
}
