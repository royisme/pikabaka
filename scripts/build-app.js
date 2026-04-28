#!/usr/bin/env node
const path = require('path');
const { spawnSync } = require('child_process');

require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });

if (process.platform === 'darwin') {
    const required = ['APPLE_ID', 'APPLE_APP_SPECIFIC_PASSWORD', 'APPLE_TEAM_ID'];
    const missing = required.filter((k) => !process.env[k]);
    if (missing.length) {
        console.warn(
            `[build-app] WARNING: Missing ${missing.join(', ')} in .env — notarization will be skipped or fail. ` +
                `App will be signed but Gatekeeper will quarantine it on download (users would need xattr -cr).`
        );
    } else {
        console.log('[build-app] Apple notarization credentials detected (APPLE_ID / APPLE_TEAM_ID).');
    }
}

const builderBin = path.resolve(
    __dirname,
    '..',
    'node_modules',
    '.bin',
    process.platform === 'win32' ? 'electron-builder.cmd' : 'electron-builder'
);

const args = ['--publish', 'never', ...process.argv.slice(2)];
const result = spawnSync(builderBin, args, { stdio: 'inherit', env: process.env });
process.exit(result.status ?? 1);
