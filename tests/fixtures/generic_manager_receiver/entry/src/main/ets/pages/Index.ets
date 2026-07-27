import userAuth from '@kit.UserAuthenticationKit';

export function authenticate(
  auth: userAuth.UserAuthInstance,
): void {
  auth.on('result', {
    onResult(): void {
    },
  });
  auth.start();
}
