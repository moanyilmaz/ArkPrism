import userAuth from '@kit.UserAuthenticationKit';
export function execute(auth: userAuth.UserAuthInstance): void {
  const ref = auth.on;
  console.info(String(ref));
}
