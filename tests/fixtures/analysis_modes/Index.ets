import deviceInfo from '@ohos.deviceInfo';
import UIAbility from '@ohos.app.ability.UIAbility';

class Channel {
  send(value: string): void {}
}

class ActiveChannel extends Channel {
  send(value: string): void { console.info(value); }
}

class UnusedChannel extends Channel {
  send(value: string): void { console.warn(value); }
}

function makeChannel(): Channel { return new ActiveChannel(); }

function dispatch(channel: Channel, value: string): void {
  channel.send(value);
}

export class EntryAbility extends UIAbility {
  onCreate(): void {
    const channel = makeChannel();
    dispatch(channel, deviceInfo.udid);
  }
}
