#!/usr/bin/env node
const path = require('path');
const { spawnSync } = require('child_process');
const { findAppleDevelopmentIdentity } = require('./mac-signing-utils');

const projectDir = path.resolve(__dirname, '..');
const appPath = process.argv[2]
    ? path.resolve(process.argv[2])
    : path.join(projectDir, 'release', 'mac-arm64', 'Pika.app');

function run(command, args) {
    const result = spawnSync(command, args, { cwd: projectDir, stdio: 'inherit', env: process.env });
    if (result.status !== 0) process.exit(result.status || 1);
}

function output(command, args) {
    const result = spawnSync(command, args, { cwd: projectDir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return `${result.stdout || ''}${result.stderr || ''}`;
}

if (process.platform !== 'darwin') {
    console.error('[sign-local-mac-app] This script only runs on macOS.');
    process.exit(1);
}

const identity = process.env.PIKA_LOCAL_SIGN_IDENTITY
    ? { name: process.env.PIKA_LOCAL_SIGN_IDENTITY }
    : process.env.CSC_NAME
        ? { name: process.env.CSC_NAME }
        : findAppleDevelopmentIdentity();
if (!identity) {
    console.error('[sign-local-mac-app] No Apple Development signing identity was found.');
    process.exit(1);
}

run('/usr/bin/codesign', [
    '--force',
    '--deep',
    '--options',
    'runtime',
    '--entitlements',
    path.join(projectDir, 'assets', 'entitlements.mac.plist'),
    '--sign',
    identity.name,
    appPath,
]);

run('/usr/bin/codesign', ['--verify', '--deep', '--strict', '--verbose=2', appPath]);
const signature = output('/usr/bin/codesign', ['-dv', '--verbose=4', appPath]);
console.log(signature.replace(/\s+$/g, ''));

if (/Signature=adhoc/.test(signature) || !/Authority=Apple Development:/.test(signature)) {
    console.error('[sign-local-mac-app] App is not signed with Apple Development after signing.');
    process.exit(1);
}

console.log(`[sign-local-mac-app] Signed ${appPath} with ${identity.name}.`);
