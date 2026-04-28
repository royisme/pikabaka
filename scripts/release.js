#!/usr/bin/env node
//
// scripts/release.js — one-shot release publisher.
//
// Run this AFTER release-please has merged its release PR (which bumps
// package.json + creates the git tag + creates the empty GitHub Release).
// This script picks the version from package.json, builds the signed +
// notarized macOS artifacts, validates them, and uploads them to the
// matching GitHub Release.
//
// Pre-flight checks:
//   • Current branch is main, working tree clean, in sync with origin
//   • package.json version has a matching `vX.Y.Z` GitHub Release
// Pipeline:
//   • node scripts/build-app.js   (verify → vite → tsc → rust → pack →
//                                  sign → notarize → staple → dmg/zip)
//   • xcrun stapler validate     (assert .app is stapled)
//   • spctl -a -vvv              (assert Gatekeeper accepts)
//   • gh release upload --clobber  (idempotent — re-runs replace assets)
//
const path = require('path');
const fs = require('fs');
const { execSync, spawnSync } = require('child_process');

const projectDir = path.resolve(__dirname, '..');
process.chdir(projectDir);

function sh(cmd, opts = {}) {
    return execSync(cmd, { encoding: 'utf8', ...opts }).trim();
}

function step(title) {
    console.log(`\n━━━ ${title}`);
}

function fail(msg) {
    console.error(`\n✗ ${msg}`);
    process.exit(1);
}

step('Pre-flight: branch, working tree, remote sync');
const branch = sh('git rev-parse --abbrev-ref HEAD');
if (branch !== 'main') fail(`Must run on main, currently on "${branch}". Run: git checkout main && git pull`);

const dirty = sh('git status --porcelain');
if (dirty) fail(`Working tree not clean:\n${dirty}`);

sh('git fetch origin main --tags', { stdio: 'inherit' });
const localSha = sh('git rev-parse HEAD');
const remoteSha = sh('git rev-parse origin/main');
if (localSha !== remoteSha) fail(`Local main (${localSha.slice(0, 7)}) is out of sync with origin/main (${remoteSha.slice(0, 7)}). Run: git pull --ff-only`);

step('Read target version from package.json');
const pkg = JSON.parse(fs.readFileSync(path.join(projectDir, 'package.json'), 'utf8'));
const version = pkg.version;
const tag = `v${version}`;
const productName = pkg.build?.productName || 'Pika';
console.log(`  package.json version: ${version}`);
console.log(`  expected tag:         ${tag}`);

step(`Verify GitHub Release ${tag} exists`);
const releaseCheck = spawnSync('gh', ['release', 'view', tag], { stdio: 'pipe' });
if (releaseCheck.status !== 0) {
    fail(
        `GitHub Release ${tag} not found. Has release-please's release PR been merged?\n` +
            `  • Check open PRs: gh pr list --label "autorelease: pending"\n` +
            `  • Or list releases: gh release list`
    );
}

step('Verify the tag exists locally and points at origin/main');
try {
    const tagSha = sh(`git rev-list -n 1 ${tag}`);
    if (tagSha !== localSha) {
        console.warn(`  ⚠ tag ${tag} (${tagSha.slice(0, 7)}) does not point at HEAD (${localSha.slice(0, 7)}).`);
        console.warn('  This is OK if release-please tagged an earlier commit, but double-check before continuing.');
    }
} catch {
    fail(`Tag ${tag} missing locally. Run: git fetch origin --tags`);
}

step('Build: sign + notarize + staple (this is the slow step)');
const buildResult = spawnSync('node', ['scripts/build-app.js'], { stdio: 'inherit', env: process.env });
if (buildResult.status !== 0) {
    fail(
        'Build failed. If notarize specifically timed out, the signed .app is preserved at\n' +
            '  release/mac-arm64/Pika.app — retry just the notarize step with:\n' +
            '    pnpm run app:notarize'
    );
}

step('Validate: stapler + spctl on the .app');
const appPath = path.join(projectDir, 'release', 'mac-arm64', `${productName}.app`);
sh(`xcrun stapler validate "${appPath}"`, { stdio: 'inherit' });
const spctl = sh(`spctl -a -vvv "${appPath}" 2>&1`);
console.log(spctl);
if (!/accepted/.test(spctl) || !/Notarized Developer ID/.test(spctl)) {
    fail('spctl did not return "accepted / Notarized Developer ID". Refusing to upload.');
}

step('Locate dist artifacts');
const releaseDir = path.join(projectDir, 'release');
const artifactPatterns = [
    `${productName}-${version}-arm64.dmg`,
    `${productName}-${version}-arm64.dmg.blockmap`,
    `${productName}-${version}-arm64-mac.zip`,
    `${productName}-${version}-arm64-mac.zip.blockmap`,
];
const artifacts = artifactPatterns.map((name) => path.join(releaseDir, name));
const missing = artifacts.filter((p) => !fs.existsSync(p));
if (missing.length) fail(`Missing build artifacts:\n  ${missing.map((p) => path.relative(projectDir, p)).join('\n  ')}`);

artifacts.forEach((p) => {
    const sizeMB = (fs.statSync(p).size / (1024 * 1024)).toFixed(1);
    console.log(`  ✓ ${path.relative(projectDir, p)}  (${sizeMB} MB)`);
});

step(`Upload assets to GitHub Release ${tag} (idempotent, --clobber overwrites)`);
const uploadResult = spawnSync('gh', ['release', 'upload', tag, ...artifacts, '--clobber'], { stdio: 'inherit' });
if (uploadResult.status !== 0) fail(`gh release upload failed.`);

step('Done');
const releaseUrl = sh(`gh release view ${tag} --json url -q .url`);
console.log(`\n✓ Released ${tag}`);
console.log(`  ${releaseUrl}`);
console.log(`\n  Users now download Pika-${version}-arm64.dmg, mount, drag to Applications, and run.`);
console.log('  Gatekeeper validates the stapled .app offline — no xattr workaround needed.');
