import userAuth from '@kit.UserAuthenticationKit';
export class Case {
  constructor(private auth: userAuth.UserAuthInstance) {}
  execute(): void { this.auth.on('result', { onResult(): void {} }); }
}
