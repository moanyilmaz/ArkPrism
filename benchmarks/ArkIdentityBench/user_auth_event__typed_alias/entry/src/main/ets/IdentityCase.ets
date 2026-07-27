import userAuth from '@kit.UserAuthenticationKit';
export function execute(auth: userAuth.UserAuthInstance): void {
  const alias = auth;
  alias.on('result', { onResult(): void {} });
}
