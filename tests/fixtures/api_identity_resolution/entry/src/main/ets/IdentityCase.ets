import { request } from '@kit.BasicServicesKit';
import { identifier } from '@kit.AdsKit';
import userAuth from '@kit.UserAuthenticationKit';
import info from '@ohos.deviceInfo';
import legacyIdentifier from '@ohos.identifier.oaid';

export class IdentityCase {
  constructor(private auth: userAuth.UserAuthInstance) {}

  execute(): void {
    this.auth.on('result', { onResult(): void {} });
    request.agent.create();
    legacyIdentifier.getOAID();
    const serial =
      info
        .serial;
    const methodReference = identifier.getOAID;
    console.info(String(serial), String(methodReference));
  }
}
