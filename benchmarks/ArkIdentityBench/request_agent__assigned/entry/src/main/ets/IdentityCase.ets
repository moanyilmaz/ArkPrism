import { request } from '@kit.BasicServicesKit';
export function execute(): void {
  const value = request.agent.create();
  console.info(String(value));
}
