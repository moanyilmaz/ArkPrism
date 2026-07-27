import { media } from '@kit.MediaKit';
export async function execute(): Promise<void> {
  const context = undefined as any;
  const receiver = await media.createAVMetadataExtractor();
  receiver.fetchMetadata();
}
