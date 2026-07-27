const assert = require('assert');

const aliases = require('../config/package_aliases.json');

for (const [sourcePackage, targets] of Object.entries(aliases)) {
  assert.ok(Array.isArray(targets) && targets.length > 0, `${sourcePackage} has no aliases`);
  assert.strictEqual(new Set(targets).size, targets.length, `${sourcePackage} has duplicate aliases`);
  for (const targetPackage of targets) {
    assert.ok(aliases[targetPackage], `${targetPackage} has no reverse alias entry`);
    assert.ok(
      aliases[targetPackage].includes(sourcePackage),
      `${sourcePackage} -> ${targetPackage} is not symmetric`,
    );
  }
}

const requiredMigrations = [
  ['@ohos.identifier.oaid', '@kit.AdsKit'],
  ['@ohos.calendarManager', '@kit.CalendarKit'],
  ['@ohos.multimedia.camera', '@kit.CameraKit'],
  ['@ohos.file.photoAccessHelper', '@kit.MediaLibraryKit'],
  ['@ohos.net.http', '@kit.NetworkKit'],
  ['@ohos.userIAM.userAuth', '@kit.UserAuthenticationKit'],
];
for (const [legacyPackage, kitPackage] of requiredMigrations) {
  assert.ok(aliases[legacyPackage].includes(kitPackage));
}

console.log(`Package aliases verified: ${Object.keys(aliases).length} package entries.`);
