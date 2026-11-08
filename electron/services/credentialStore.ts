/**
 * credentialStore - the credential file on disk: secure-storage status, the encrypted read and write,
 * and error redaction. CredentialsManager owns the keys and the save/load rules.
 */

import fs from 'fs';
import { safeStorage } from 'electron';
import { isDeepStrictEqual } from 'node:util';
import type { StoredCredentials } from './CredentialsManager';

export type CredentialStorageStatus = { mode: 'encrypted' | 'plaintext' | 'locked'; reason?: string };

export class CredentialStorageError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'CredentialStorageError';
    }
}

export function availableStorageStatus(): CredentialStorageStatus {
    // Linux's basic_text backend uses a hardcoded password, not an OS secret store.
    try {
        if (safeStorage?.isEncryptionAvailable() &&
            !(process.platform === 'linux' && safeStorage.getSelectedStorageBackend() === 'basic_text')) {
            return { mode: 'encrypted' };
        }
    } catch { /* An unavailable keychain must not prevent loading the plaintext store. */ }
    return { mode: 'plaintext', reason: 'No operating-system secure storage is available on this system.' };
}

export function encryptedPath(jsonPath: string): string {
    return jsonPath.replace(/\.json$/, '.enc');
}

/** Storage errors may quote input (notably JSON errors); the values of every given store are redacted. */
export function storageError(error: unknown, ...stores: (StoredCredentials | undefined)[]): CredentialStorageError {
    let message = error instanceof SyntaxError ? 'The credential file is not valid JSON.'
        : error instanceof Error ? error.message : 'Credential storage failed.';
    const redact = (value: unknown, name = ''): void => {
        if (typeof value === 'string' && value && (/apiKey$/i.test(name) || name === 'headerValue')) {
            message = message.split(value).join('[redacted]');
        } else if (value && typeof value === 'object') {
            Object.entries(value).forEach(([key, entry]) => redact(entry, name === 'headers' ? 'headerValue' : key));
        }
    };
    stores.forEach(store => redact(store));
    return new CredentialStorageError(message);
}

export function readCredentials(file: string, encrypted: boolean): StoredCredentials {
    const data = encrypted ? safeStorage.decryptString(fs.readFileSync(file)) : fs.readFileSync(file, 'utf-8');
    const parsed = JSON.parse(data);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('The credential file must contain an object.');
    return parsed;
}

export function writeCredentials(file: string, encrypted: boolean, credentials: StoredCredentials): void {
    const data = JSON.stringify(credentials);
    const tmp = file + '.tmp';
    try {
        fs.writeFileSync(tmp, encrypted ? safeStorage.encryptString(data) : data, { mode: 0o600 });
        // Verify before publishing: an unverified .enc must never shadow the good plaintext.
        if (encrypted && !isDeepStrictEqual(readCredentials(tmp, true), JSON.parse(data))) {
            throw new Error('Encrypted credential verification failed.');
        }
        fs.renameSync(tmp, file);
    } finally {
        if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
    }
}
