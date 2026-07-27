import { request } from '@kit.BasicServicesKit';
export function execute(): void {
  const ref = request.agent.create;
  console.info(String(ref));
}
