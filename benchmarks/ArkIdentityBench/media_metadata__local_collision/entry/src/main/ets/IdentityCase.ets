import { media } from '@kit.MediaKit';
class LocalReceiver { fetchMetadata(): void {} }
export function execute(): void {
  new LocalReceiver().fetchMetadata();
}
