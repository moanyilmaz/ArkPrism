import { appAccount } from '@kit.BasicServicesKit';
import legacyAppAccount from '@ohos.account.appAccount';

export function exerciseAppAccountOverloads(): void {
  const kitManager = appAccount.createAppAccountManager();
  kitManager.getAllAccounts();
  kitManager.getAllAccounts(() => {});

  const legacyManager: legacyAppAccount.AppAccountManager =
    legacyAppAccount.createAppAccountManager();
  legacyManager.getAllAccounts();
  legacyManager.getAllAccounts(() => {});
}
