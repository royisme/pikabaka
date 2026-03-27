import { useRef, useCallback } from 'react';

/**
 * useStreamBuffer — Batches high-frequency streaming tokens into
 * requestAnimationFrame-paced React state updates.
 *
 * Instead of calling setMessages() on every token (50-100/sec),
 * tokens are accumulated in a ref buffer and flushed to React
 * state at most once per animation frame (~60fps).
 *
 * Usage:
 *   const { appendToken, getBufferedContent, reset } = useStreamBuffer();
 *
 *   // In token callback:
 *   appendToken(token, (accumulatedContent) => {
 *     setMessages(prev => prev.map(msg =>
 *       msg.id === targetId ? { ...msg, content: accumulatedContent } : msg
 *     ));
 *   });
 */
export function useStreamBuffer() {
    const bufferRef = useRef<string>('');
    const rafIdRef = useRef<number | null>(null);

    /**
     * Append a token to the buffer and schedule a batched flush.
     * The flush callback receives the full accumulated content so far.
     */
    const appendToken = useCallback((token: string, onFlush: (content: string) => void) => {
        bufferRef.current += token;

        // Only schedule one RAF — subsequent tokens within the same
        // frame just append to the buffer without scheduling another.
        if (rafIdRef.current === null) {
            rafIdRef.current = requestAnimationFrame(() => {
                rafIdRef.current = null;
                onFlush(bufferRef.current);
            });
        }
    }, []);

    /**
     * Get the current buffered content (useful for final commit on stream done).
     */
    const getBufferedContent = useCallback(() => bufferRef.current, []);

    /**
     * Reset the buffer (call when starting a new stream or on cleanup).
     */
    const reset = useCallback(() => {
        bufferRef.current = '';
        if (rafIdRef.current !== null) {
            cancelAnimationFrame(rafIdRef.current);
            rafIdRef.current = null;
        }
    }, []);

    return { appendToken, getBufferedContent, reset };
}
