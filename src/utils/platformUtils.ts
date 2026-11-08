function normalizePlatform(p: string): string {
  if (p === 'darwin' || p.startsWith('mac')) return 'darwin';
  if (p === 'win32' || p.startsWith('win')) return 'win32';
  if (p.includes('linux')) return 'linux';
  return p;
}

const platform = normalizePlatform(
  window.electronAPI?.platform ?? navigator.platform?.toLowerCase() ?? ''
);

export const isMac = platform === 'darwin';
export const isWindows = platform === 'win32';

export function getModifierSymbol(modifier: 'commandorcontrol' | 'ctrl' | 'control' | 'cmd' | 'command' | 'meta' | 'alt' | 'option' | 'shift'): string {
    const m = modifier.toLowerCase();
    if (m === 'commandorcontrol' || m === 'cmd' || m === 'command' || m === 'meta' || m === 'ctrl' || m === 'control') {
        return isMac ? '⌘' : 'Ctrl';
    }
    if (m === 'alt' || m === 'option') {
        return isMac ? '⌥' : 'Alt';
    }
    if (m === 'shift') {
        return isMac ? '⇧' : 'Shift';
    }
    return modifier;
}
