import { AbilityConstant, UIAbility, Want } from '@kit.AbilityKit';
import { identifier } from '@kit.AdsKit';
import emitter from '@ohos.events.emitter';

export default class EntryAbility extends UIAbility {
  onCreate(want: Want, launchParam: AbilityConstant.LaunchParam): void {
    this.execute();
  }

  private execute(): void {
    emitter.on('arkpromisebench.source-never-emitted', () => {
      identifier.getOAID().then((value) => {
        console.info('diagnostic', String(value));
      });
    });
  }
}
