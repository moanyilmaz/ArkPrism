class LocalAuth { on(type: string, value: object): void {} }
export function execute(): void {
  new LocalAuth().on('result', {});
}
