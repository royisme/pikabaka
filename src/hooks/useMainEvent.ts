import { useEffect, useRef } from 'react';

/** A subscription the preload offers: it takes a callback and returns the function that unsubscribes. */
type Subscribe<T> = ((callback: (payload: T) => void) => () => void) | undefined;

/**
 * Follows an event stream from the main process (`window.electronAPI.onXxx`). This is what an effect is
 * for: connecting a component to a system outside React, and disconnecting when it goes. Components use
 * this hook instead of writing the effect themselves, so the pattern lives in one place: the handler is
 * always the latest one (it can read props and state without resubscribing), and the subscription is
 * made once per `subscribe` function.
 *
 * Pass the preload function itself (`window.electronAPI?.onMeetingStateChanged`), which is stable.
 */
export function useMainEvent<T>(subscribe: Subscribe<T>, handler: (payload: T) => void): void {
    const latest = useRef(handler);
    latest.current = handler;
    useEffect(() => subscribe?.((payload) => latest.current(payload)), [subscribe]);
}
