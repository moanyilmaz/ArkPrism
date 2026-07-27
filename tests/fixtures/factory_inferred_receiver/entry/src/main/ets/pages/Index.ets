import { audio } from '@kit.AudioKit';
import { media } from '@kit.MediaKit';
import { reminderAgentManager } from '@kit.ReminderAgentKit';

export async function inspectFactoryReceivers(): Promise<void> {
  const extractor = await media.createAVMetadataExtractor();
  await extractor.fetchMetadata();
  await extractor.fetchAlbumCover();

  const generator = await media.createAVImageGenerator();
  await generator.fetchFrameByTime(0, 0, {});

  const audioManager = audio.getAudioManager();
  audioManager.getAudioScene(() => {});

  await reminderAgentManager.publishReminder({});
}
