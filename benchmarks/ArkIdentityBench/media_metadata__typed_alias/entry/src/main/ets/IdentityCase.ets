import { media } from '@kit.MediaKit';
export function execute(receiver: media.AVMetadataExtractor): void {
  const alias = receiver;
  alias.fetchMetadata();
}
