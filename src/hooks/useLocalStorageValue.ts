import { useCallback, useSyncExternalStore } from 'react';

// localStorage is an external store: components read it with useSyncExternalStore, so a change made
// anywhere (another window through the `storage` event, or this one through `setLocalStorageValue`)
// reaches every component that shows it, with no copy in state and no effect.

const EVENT = 'pika-local-storage';

function read(key: string): string | null {
    try {
        return localStorage.getItem(key);
    } catch {
        return null;
    }
}

export function setLocalStorageValue(key: string, value: string | null): void {
    try {
        if (value === null) localStorage.removeItem(key);
        else localStorage.setItem(key, value);
    } catch {
        // Storage can be unavailable; the value then simply is not kept.
    }
    window.dispatchEvent(new CustomEvent(EVENT, { detail: key }));
}

/** The string stored under `key` (null when none) and a setter. */
export function useLocalStorageValue(key: string): [string | null, (value: string | null) => void] {
    const subscribe = useCallback(
        (notify: () => void) => {
            const onStorage = (event: StorageEvent) => { if (event.key === key || event.key === null) notify(); };
            const onLocal = (event: Event) => { if ((event as CustomEvent<string>).detail === key) notify(); };
            window.addEventListener('storage', onStorage);
            window.addEventListener(EVENT, onLocal);
            return () => {
                window.removeEventListener('storage', onStorage);
                window.removeEventListener(EVENT, onLocal);
            };
        },
        [key]
    );
    const value = useSyncExternalStore(subscribe, () => read(key));
    const set = useCallback((next: string | null) => setLocalStorageValue(key, next), [key]);
    return [value, set];
}
