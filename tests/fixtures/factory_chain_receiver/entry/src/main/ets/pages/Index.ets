import audio from '@kit.AudioKit';

export async function getVolumeGroup(): Promise<void> {
  const audioManager = audio.getAudioManager();
  await audioManager
    .getVolumeManager()
    .getVolumeGroupManager(audio.DEFAULT_VOLUME_GROUP_ID);
}
