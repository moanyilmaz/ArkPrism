import { healthStore as health } from '@kit.HealthServiceKit';

export function readKitHealthData(request: health.SamplePointReadRequest): void {
  health.readData(request);
}
