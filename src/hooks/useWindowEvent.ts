import { useEffect, useRef } from 'react';

/**
 * Listens to an event on `window` (or `document`) for as long as the component is mounted. The handler
 * is always the latest one, so it may read props and state without re-adding the listener. Use it for
 * keyboard, resize, focus and similar events that belong to the page rather than to one element; an
 * event on an element is a prop (`onClick`, `onKeyDown`), not a listener.
 */
export function useWindowEvent<K extends keyof WindowEventMap>(type: K, handler: (event: WindowEventMap[K]) => void, target: 'window' | 'document' = 'window', options?: boolean | AddEventListenerOptions): void {
    const latest = useRef(handler);
    latest.current = handler;
    const capture = typeof options === 'boolean' ? options : options?.capture;
    useEffect(() => {
        const element: Window | Document = target === 'window' ? window : document;
        const listener = (event: Event) => latest.current(event as WindowEventMap[K]);
        element.addEventListener(type, listener, options);
        return () => element.removeEventListener(type, listener, capture);
        // `options` is a constant in practice; `capture` is what removal needs.
    }, [type, target, capture]);
}
