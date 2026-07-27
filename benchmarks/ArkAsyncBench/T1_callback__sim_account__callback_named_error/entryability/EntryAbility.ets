import { AbilityConstant, UIAbility, Want } from '@kit.AbilityKit';
import sim from '@ohos.telephony.sim';

export default class EntryAbility extends UIAbility {
  onCreate(want: Want, launchParam: AbilityConstant.LaunchParam): void {
    this.execute();
  }

  private async execute(): Promise<void> {
    const handler = (error, value) => {
      console.info('diagnostic', String(error));
    };
    sim.getSimAccountInfo(0, handler);
  }
}
