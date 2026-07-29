import { AbilityConstant, UIAbility, Want } from '@kit.AbilityKit';
import { identifier } from '@kit.AdsKit';

class TaskQueue {
  private ignored: Promise<string>;

  constructor(ignored: Promise<string>) {
    this.ignored = ignored;
  }

  then(callback: (value: string) => void): void {
    callback('constant');
  }
}
export default class EntryAbility extends UIAbility {
  onCreate(want: Want, launchParam: AbilityConstant.LaunchParam): void {
    this.execute();
  }

  private execute(): void {
    const queue = new TaskQueue(identifier.getOAID());
    queue.then((value) => {
      console.info('diagnostic', String(value));
    });
  }
}
