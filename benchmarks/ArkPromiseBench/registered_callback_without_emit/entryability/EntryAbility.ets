import { AbilityConstant, UIAbility, Want } from '@kit.AbilityKit';
import { identifier } from '@kit.AdsKit';
import emitter from '@ohos.events.emitter';

export default class EntryAbility extends UIAbility {
  onCreate(want: Want, launchParam: AbilityConstant.LaunchParam): void {
    this.execute();
  }

  private execute(): void {
    const pending = identifier.getOAID();
    emitter.on('arkpromisebench.never-emitted', () => {
      pending.then((value) => {
        console.info('diagnostic', String(value));
      });
    });
  }
}
