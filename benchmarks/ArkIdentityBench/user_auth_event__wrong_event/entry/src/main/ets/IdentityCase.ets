import userAuth from '@kit.UserAuthenticationKit';
export function execute(auth: userAuth.UserAuthInstance): void {
  auth.on('progress', { onResult(): void {} });
}
