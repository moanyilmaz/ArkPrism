import { media } from '@kit.MediaKit';
export function execute(receiver: media.AVMetadataExtractor): void {
  const ref = receiver.fetchMetadata;
  console.info(String(ref));
}
