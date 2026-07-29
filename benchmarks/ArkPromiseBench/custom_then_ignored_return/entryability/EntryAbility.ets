import { AbilityConstant, UIAbility, Want } from '@kit.AbilityKit';
import { identifier } from '@kit.AdsKit';

class IgnoringTaskQueue {
  then(callback: () => Promise<string>): Promise<string> {
    callback();
    return Promise.resolve('constant');
  }
}
export default class EntryAbility extends UIAbility {
  onCreate(want: Want, launchParam: AbilityConstant.LaunchParam): void {
    this.execute();
  }

  private execute(): void {
    const sensitive = identifier.getOAID();
    const queue = new IgnoringTaskQueue();
    const output = queue.then(() => sensitive);
    output.then((value) => {
      console.info('diagnostic', String(value));
    });
  }
}
