import deviceInfo from '@ohos.deviceInfo';
import settings from '@ohos.settings';
import sensor from '@ohos.sensor';
import http from '@ohos.net.http';
import pasteboard from '@ohos.pasteboard';
import fs from '@ohos.file.fs';

export class Cases {
  filePositive() {
    const id = deviceInfo.udid;
    fs.writeSync(1, id);
  }
  fileDescriptorNegative() {
    const fd = deviceInfo.sdkApiVersion;
    fs.writeSync(fd, 'public');
  }
  private readId(): string { return deviceInfo.udid; }
  repeatedCallsPositive() {
    const first = this.readId();
    console.info(first);
    const second = this.readId();
    console.warn(second);
  }
  fieldPositive() {
    const id = deviceInfo.udid;
    console.info(id);
  }
  fieldKilled() {
    let id = deviceInfo.udid;
    id = 'public';
    console.info(id);
  }
  settingsPositive() {
    const name = settings.getValueSync(undefined, 'device_name', '');
    console.info(name);
  }
  sensorPositive() {
    sensor.on(sensor.SensorId.PEDOMETER, (data: sensor.PedometerResponse) => {
      console.info(data.steps);
    });
  }
  sensorNegative() {
    sensor.on(sensor.SensorId.PEDOMETER, (data: sensor.PedometerResponse) => {
      console.info('public');
    });
  }
  httpPositive() {
    const id = deviceInfo.udid;
    const client: http.HttpRequest = http.createHttp();
    client.request('https://example.invalid/' + id);
  }
  httpFactoryNegative() {
    const id = deviceInfo.udid;
    http.createHttp();
  }
  pasteboardErrorNegative() {
    const board = pasteboard.getSystemPasteboard();
    board.getData((err, data) => { console.info(err); });
  }
}
