import userAuth from '@kit.UserAuthenticationKit';
function helper(auth: userAuth.UserAuthInstance): void {
  auth.on('result', { onResult(): void {} });
}
export function execute(auth: userAuth.UserAuthInstance): void { helper(auth); }
