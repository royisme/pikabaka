import { useSyncExternalStore } from 'react';

type ResolvedTheme = 'light' | 'dark';

const getResolvedTheme = (): ResolvedTheme =>
    document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';

function subscribe(notify: () => void): () => void {
    // Watch for data-theme attribute changes on <html> — catches both the
    // async IPC correction in main.tsx and user-triggered theme changes.
    const observer = new MutationObserver(notify);
    observer.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ['data-theme'],
    });

    // Also subscribe to the IPC event for redundancy.
    const unsubscribe = window.electronAPI?.onThemeChanged?.(() => {
        notify();
    });

    return () => {
        observer.disconnect();
        unsubscribe?.();
    };
}

export const useResolvedTheme = (): ResolvedTheme => {
    return useSyncExternalStore(subscribe, getResolvedTheme);
};
