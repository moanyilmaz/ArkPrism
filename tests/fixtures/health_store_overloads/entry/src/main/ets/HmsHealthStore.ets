import healthStore from '@hms.health.store';

export function readHealthData(): void {
  const request = {
    samplePointDataType: healthStore.DataType.HEART_RATE,
    startTime: 0,
    endTime: 0
  };
  healthStore.readData(request);
  const result = healthStore.readData(request);
  console.info(String(result));
}

export function readExerciseData(request: healthStore.ExerciseSequenceReadRequest): void {
  healthStore.readData(request, (data) => console.info(String(data)));
}

class LocalStore {
  readData(request: string): string {
    return request;
  }
}

export function rejectNonApiCalls(): void {
  const local = new LocalStore();
  local.readData('ordinary application method');
  const methodReference = healthStore.readData;
  console.info(String(methodReference));
  console.info('healthStore.readData(request)');
  // healthStore.readData(request);

  // Invalid arities must not become accepted by adding the one-argument overload.
  healthStore.readData();
  healthStore.readData({}, () => {}, 1);
}
