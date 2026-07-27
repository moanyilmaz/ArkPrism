import { request } from '@kit.BasicServicesKit';
const local = { create: () => 'local' };
export function execute(): void {
  local.create();
}
