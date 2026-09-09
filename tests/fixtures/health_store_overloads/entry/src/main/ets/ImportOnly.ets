import healthStore from '@hms.health.store';

export function referenceOnly(): void {
  const read = healthStore.readData;
  console.info(String(read));
}
