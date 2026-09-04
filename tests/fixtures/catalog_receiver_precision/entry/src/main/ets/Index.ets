import photoAccessHelper from '@ohos.file.photoAccessHelper';
import Bundle from '@ohos.bundle';

export function inspectAlbum(album: photoAccessHelper.Album): void {
  album.getAssets({} as photoAccessHelper.FetchOptions);
}

export async function inspectFetchedAlbum(
  albums: photoAccessHelper.FetchResult<photoAccessHelper.Album>,
): Promise<void> {
  const album = await albums.getFirstObject();
  album.getAssets({} as photoAccessHelper.FetchOptions);
}

export function inspectBundle(): void {
  Bundle.getBundleInfo(
    'com.example.application',
    Bundle.BundleFlag.GET_APPLICATION_INFO_WITH_PERMISSION,
    () => {},
  );
}
