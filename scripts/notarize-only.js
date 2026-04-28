#!/usr/bin/env node
//
// Retry notarization on an already-signed .app without re-running pack/sign.
// Use this when scripts/build-app.js fails at the notarize step (network
// timeout, Apple service flake, etc.) — it picks up the signed Pika.app left
// behind by electron-builder and runs only:
//   1. ditto-zip the .app for upload
//   2. xcrun notarytool submit --wait   (the slow + flaky step)
//   3. xcrun stapler staple <Pika.app>  (attaches the ticket)
//   4. ditto-zip the stapled .app → release/Pika-<ver>-arm64-mac.zip
//   5. hdiutil create UDZO dmg          → release/Pika-<ver>-arm64.dmg
//
// Steps 4–5 deliberately bypass electron-builder so we never re-sign the app
// (which would invalidate the freshly-stapled ticket).
//
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');

require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });

const projectDir = path.resolve(__dirname, '..');
const releaseDir = path.join(projectDir, 'release');
const appOutDir = path.join(releaseDir, 'mac-arm64');
const appPath = path.join(appOutDir, 'Pika.app');

if (!fs.existsSync(appPath)) {
    console.error(`[notarize-only] App not found: ${appPath}`);
    console.error(`[notarize-only] Run "node scripts/build-app.js" first to produce a signed .app.`);
    process.exit(1);
}

for (const k of ['APPLE_ID', 'APPLE_APP_SPECIFIC_PASSWORD', 'APPLE_TEAM_ID']) {
    if (!process.env[k]) {
        console.error(`[notarize-only] Missing ${k} in .env`);
        process.exit(1);
    }
}

const pkg = require(path.join(projectDir, 'package.json'));
const version = pkg.version;
const productName = pkg.build?.productName || pkg.name;

const uploadZip = path.join(releaseDir, `${productName}-notarize-upload.zip`);
const distZip = path.join(releaseDir, `${productName}-${version}-arm64-mac.zip`);
const distDmg = path.join(releaseDir, `${productName}-${version}-arm64.dmg`);

function run(cmd) {
    console.log(`\n$ ${cmd}`);
    execSync(cmd, { stdio: 'inherit' });
}

console.log('[notarize-only] Step 1/5: ditto-zip the signed .app for upload');
fs.rmSync(uploadZip, { force: true });
run(`ditto -c -k --sequesterRsrc --keepParent "${appPath}" "${uploadZip}"`);

console.log('\n[notarize-only] Step 2/5: submit to Apple notarytool (this is the slow step)');
run(
    `xcrun notarytool submit "${uploadZip}" ` +
        `--apple-id "${process.env.APPLE_ID}" ` +
        `--password "${process.env.APPLE_APP_SPECIFIC_PASSWORD}" ` +
        `--team-id "${process.env.APPLE_TEAM_ID}" ` +
        `--wait`
);

console.log('\n[notarize-only] Step 3/5: staple the notarization ticket onto the .app');
run(`xcrun stapler staple "${appPath}"`);
run(`xcrun stapler validate "${appPath}"`);

console.log('\n[notarize-only] Step 4/5: rebuild the distribution zip (stapled)');
fs.rmSync(distZip, { force: true });
run(`ditto -c -k --sequesterRsrc --keepParent "${appPath}" "${distZip}"`);

console.log('\n[notarize-only] Step 5/5: rebuild the dmg (UDZO compressed)');
fs.rmSync(distDmg, { force: true });
run(`hdiutil create -volname "${productName}" -srcfolder "${appPath}" -ov -format UDZO "${distDmg}"`);

console.log('\n[notarize-only] Cleanup intermediate upload zip');
fs.rmSync(uploadZip, { force: true });

console.log('\n[notarize-only] Done. Verify:');
console.log(`  xcrun stapler validate "${distDmg}"`);
console.log(`  spctl -a -vvv -t install "${distDmg}"`);
