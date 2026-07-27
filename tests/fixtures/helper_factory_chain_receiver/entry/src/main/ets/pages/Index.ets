import audio from '@kit.AudioKit';

function getAudioManager() {
  return audio.getAudioManager();
}

export async function getVolumeGroup(): Promise<void> {
  const audioManager = getAudioManager();
  await audioManager
    .getVolumeManager()
    .getVolumeGroupManager(audio.DEFAULT_VOLUME_GROUP_ID);
}
