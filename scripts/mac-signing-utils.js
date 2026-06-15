const { execFileSync } = require('child_process');

function parseCodesigningIdentities(output) {
    return String(output || '')
        .split(/\r?\n/)
        .map((line) => {
            const match = line.match(/^\s*\d+\)\s+([A-Fa-f0-9]{40})\s+"([^"]+)"/);
            if (!match) return null;
            return { hash: match[1], name: match[2] };
        })
        .filter(Boolean);
}

function getCodesigningIdentities() {
    try {
        const output = execFileSync('/usr/bin/security', ['find-identity', '-v', '-p', 'codesigning'], {
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        return parseCodesigningIdentities(output);
    } catch (error) {
        return [];
    }
}

function findAppleDevelopmentIdentity(identities = getCodesigningIdentities()) {
    return identities.find((identity) => identity.name.startsWith('Apple Development:')) || null;
}

function shouldSelfSignLocalBuild(env = process.env) {
    return env.PIKA_SKIP_LOCAL_SELF_SIGN !== '1';
}

function hasNotarizationCredentials(env = process.env) {
    return Boolean(env.APPLE_ID && env.APPLE_APP_SPECIFIC_PASSWORD && env.APPLE_TEAM_ID);
}

function hasExplicitMacSigningArgs(args = []) {
    return args.some((arg) => /(?:^|[.=])mac\.(?:identity|type|notarize)\b/.test(arg) || arg === '--config.mac.identity');
}

function hasExplicitSigningEnv(env = process.env) {
    return Boolean(env.CSC_NAME || env.CSC_LINK || env.CSC_KEY_PASSWORD || env.CSC_IDENTITY_AUTO_DISCOVERY === 'false');
}

function shouldPreferLocalDevelopmentSigning({ env = process.env, args = [] } = {}) {
    return process.platform === 'darwin'
        && !hasNotarizationCredentials(env)
        && !hasExplicitSigningEnv(env)
        && !hasExplicitMacSigningArgs(args);
}

module.exports = {
    parseCodesigningIdentities,
    getCodesigningIdentities,
    findAppleDevelopmentIdentity,
    hasNotarizationCredentials,
    hasExplicitMacSigningArgs,
    hasExplicitSigningEnv,
    shouldPreferLocalDevelopmentSigning,
    shouldSelfSignLocalBuild,
};
