import { AbilityConstant, UIAbility, Want } from '@kit.AbilityKit';
import { identifier } from '@kit.AdsKit';

function redact(value: string): string {
  void value;
  return 'redacted';
}
export default class EntryAbility extends UIAbility {
  onCreate(want: Want, launchParam: AbilityConstant.LaunchParam): void {
    this.execute();
  }

  private execute(): void {
    identifier.getOAID().then((value) => {
      console.info('diagnostic', redact(value));
    });
  }
}
