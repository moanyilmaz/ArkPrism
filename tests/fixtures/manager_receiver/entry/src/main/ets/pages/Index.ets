import media from '@kit.MediaKit';

export async function readMediaMetadata(): Promise<void> {
  const extractor: media.AVMetadataExtractor =
    await media.createAVMetadataExtractor();
  await extractor.fetchMetadata();
  await extractor.fetchAlbumCover();
}
