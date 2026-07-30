import photoAccessHelper from '@ohos.file.photoAccessHelper';

export async function inspectTypedReceivers(
  helper: photoAccessHelper.PhotoAccessHelper,
  album: photoAccessHelper.Album,
  options: photoAccessHelper.FetchOptions,
): Promise<void> {
  await helper.getAssets(options);
  await album.getAssets(options);
}

export async function inspectSameNamedAlbum(
  item: photoAccessHelper.Album,
  options: photoAccessHelper.FetchOptions,
): Promise<void> {
  await item.getAssets(options);
}

export async function inspectSameNamedHelper(
  item: photoAccessHelper.PhotoAccessHelper,
  options: photoAccessHelper.FetchOptions,
): Promise<void> {
  await item.getAssets(options);
}
