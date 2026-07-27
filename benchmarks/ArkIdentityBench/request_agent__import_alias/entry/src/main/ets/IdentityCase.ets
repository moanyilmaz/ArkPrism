import { request as req } from '@kit.BasicServicesKit';
export function execute(): void {
  req.agent.create();
}
