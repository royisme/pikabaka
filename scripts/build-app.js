#!/usr/bin/env node
const path = require('path');
const { spawnSync } = require('child_process');
const {
    findAppleDevelopmentIdentity,
    hasNotarizationCredentials,
    shouldSelfSignLocalBuild,
    shouldPreferLocalDevelopmentSigning,
} = require('./mac-signing-utils');

require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });

const passthroughArgs = process.argv.slice(2);
const builderConfigArgs = [];
const buildEnv = { ...process.env };

if (process.platform === 'darwin') {
    const required = ['APPLE_ID', 'APPLE_APP_SPECIFIC_PASSWORD', 'APPLE_TEAM_ID'];
    const missing = required.filter((k) => !buildEnv[k]);
    const notarizationReady = hasNotarizationCredentials(buildEnv);

    if (notarizationReady) {
        console.log('[build-app] Apple notarization credentials detected (APPLE_ID / APPLE_TEAM_ID).');
    } else {
        console.warn(
            `[build-app] WARNING: Missing ${missing.join(', ')} in .env — notarization will be skipped for local builds.`
        );
    }

    if (shouldPreferLocalDevelopmentSigning({ env: buildEnv, args: passthroughArgs })) {
        const identity = findAppleDevelopmentIdentity();
        if (identity) {
            buildEnv.PIKA_LOCAL_SIGN_IDENTITY = identity.name;
            builderConfigArgs.push(
                '-c.mac.notarize=false',
                '-c.forceCodeSigning=false'
            );
            console.log(`[build-app] Local macOS build will be signed with ${identity.name}.`);
            console.log("[build-app] This keeps the app's TCC identity stable across rebuilds; notarization remains disabled for this local build.");
        } else {
            console.warn('[build-app] WARNING: No Apple Development signing identity found; electron-builder may fall back to ad-hoc signing.');
        }
    }
}

const builderBin = path.resolve(
    __dirname,
    '..',
    'node_modules',
    '.bin',
    process.platform === 'win32' ? 'electron-builder.cmd' : 'electron-builder'
);

const args = ['--publish', 'never', ...builderConfigArgs, ...passthroughArgs];
const result = spawnSync(builderBin, args, { stdio: 'inherit', env: buildEnv });
if (result.status === 0 && process.platform === 'darwin' && buildEnv.PIKA_LOCAL_SIGN_IDENTITY && shouldSelfSignLocalBuild(buildEnv)) {
    const signResult = spawnSync(process.execPath, ['scripts/sign-local-mac-app.js'], {
        stdio: 'inherit',
        cwd: path.resolve(__dirname, '..'),
        env: buildEnv,
    });
    process.exit(signResult.status ?? 1);
}
process.exit(result.status ?? 1);
