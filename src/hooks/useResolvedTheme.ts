import { useEffect, useState } from 'react';

type ResolvedTheme = 'light' | 'dark';

const getResolvedTheme = (): ResolvedTheme =>
    document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';

export const useResolvedTheme = (): ResolvedTheme => {
    const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>(() => getResolvedTheme());

    useEffect(() => {
        // Watch for data-theme attribute changes on <html> — catches both the
        // async IPC correction in main.tsx and user-triggered theme changes.
        const observer = new MutationObserver(() => {
            setResolvedTheme(getResolvedTheme());
        });
        observer.observe(document.documentElement, {
            attributes: true,
            attributeFilter: ['data-theme'],
        });

        // Also subscribe to the IPC event for redundancy.
        const unsubscribe = window.electronAPI?.onThemeChanged?.(({ resolved }) => {
            setResolvedTheme(resolved);
        });

        return () => {
            observer.disconnect();
            unsubscribe?.();
        };
    }, []);

    return resolvedTheme;
};
