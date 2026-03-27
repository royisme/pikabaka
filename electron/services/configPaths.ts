/**
 * Centralised config paths for Pika.
 *
 * Config is stored in a platform-appropriate, upgrade-safe location:
 *   - macOS / Linux: ~/.config/pika/
 *   - Windows:       %APPDATA%\pika\  (C:\Users\xxx\AppData\Roaming\pika\)
 */

import fs from 'fs';
import os from 'os';
import path from 'path';

const CONFIG_DIR =
    process.platform === 'win32'
        ? path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'pika')
        : path.join(os.homedir(), '.config', 'pika');

/** Ensure ~/.config/pika/ exists (idempotent). */
function ensureConfigDir(): void {
    if (!fs.existsSync(CONFIG_DIR)) {
        fs.mkdirSync(CONFIG_DIR, { recursive: true });
    }
}

export function getConfigDir(): string {
    ensureConfigDir();
    return CONFIG_DIR;
}

export function getCredentialsJsonPath(): string {
    ensureConfigDir();
    return path.join(CONFIG_DIR, 'credentials.json');
}

export function getSettingsJsonPath(): string {
    ensureConfigDir();
    return path.join(CONFIG_DIR, 'settings.json');
}
