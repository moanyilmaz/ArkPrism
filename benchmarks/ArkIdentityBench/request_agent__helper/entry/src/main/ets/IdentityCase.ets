import { request } from '@kit.BasicServicesKit';
function helper(): void {
  request.agent.create();
}
export function execute(): void {
  helper();
}
