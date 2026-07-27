import userAuth from '@kit.UserAuthenticationKit';
export function execute(auth: userAuth.UserAuthInstance): void {
  auth.on('result', { onResult(): void {} });
}
