import { request } from '@kit.BasicServicesKit';
export function execute(): void {
  request.agent.create();
}
