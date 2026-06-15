#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');
const { findAppleDevelopmentIdentity } = require('./mac-signing-utils');

const projectDir = path.resolve(__dirname, '..');
const sourceApp = path.join(projectDir, 'release', 'mac-arm64', 'Pika.app');
const targetApp = '/Applications/Pika.app';
const skipBuild = process.argv.includes('--skip-build') || process.argv.includes('--') && process.argv.slice(process.argv.indexOf('--') + 1).includes('--skip-build');

function run(command, args, options = {}) {
    const result = spawnSync(command, args, { stdio: 'inherit', cwd: projectDir, env: process.env, ...options });
    if (result.status !== 0) process.exit(result.status || 1);
}

function output(command, args) {
    const result = spawnSync(command, args, { cwd: projectDir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return `${result.stdout || ''}${result.stderr || ''}`;
}

if (process.platform !== 'darwin') {
    console.error('[install-local-mac] This installer only runs on macOS.');
    process.exit(1);
}

const identity = findAppleDevelopmentIdentity();
if (!identity) {
    console.error('[install-local-mac] No Apple Development signing identity was found. Refusing to install an ad-hoc local build.');
    console.error('[install-local-mac] Install an Apple Development certificate in Keychain Access, then rerun this script.');
    process.exit(1);
}

if (!skipBuild) {
    run(process.execPath, ['scripts/build-app.js']);
}

if (!fs.existsSync(sourceApp)) {
    console.error(`[install-local-mac] Build output not found: ${sourceApp}`);
    process.exit(1);
}

run(process.execPath, ['scripts/sign-local-mac-app.js', sourceApp]);

try {
    execFileSync('/usr/bin/osascript', ['-e', 'tell application "Pika" to quit'], { stdio: 'ignore' });
} catch {
    // Pika was not running or did not respond; copying over a non-running app is still safe.
}

run('/usr/bin/ditto', [sourceApp, targetApp]);

run(process.execPath, ['scripts/sign-local-mac-app.js', targetApp]);

const signature = output('/usr/bin/codesign', ['-dv', '--verbose=4', targetApp]).replace(/\s+$/g, '');
console.log(signature);
if (/Signature=adhoc/.test(signature) || !/Authority=Apple Development:/.test(signature)) {
    console.error('[install-local-mac] Installed app is not signed with Apple Development; refusing to report success.');
    process.exit(1);
}

console.log('[install-local-mac] Installed /Applications/Pika.app with a stable Apple Development signature.');
console.log('[install-local-mac] If System Settings already showed Pika enabled but macOS still prompts, toggle Pika off/on once or run: tccutil reset ScreenCapture com.royisme.pika');
