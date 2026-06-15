export const SPLITTER_STORAGE_KEY = 'pika_splitter_position';
export const SPLITTER_STORAGE_VERSION_KEY = 'pika_splitter_position_version';
export const SPLITTER_STORAGE_VERSION = 'chat-polish-v2';

export const DEFAULT_TRANSCRIPT_SPLIT = 28;
export const MIN_TRANSCRIPT_SPLIT = 20;
export const MAX_TRANSCRIPT_SPLIT = 65;

export const MIN_TRANSCRIPT_PANE_PX = 96;
export const MIN_CHAT_PANE_PX = 360;
export const SPLITTER_THICKNESS_PX = 6;

export interface SplitterStorageLike {
    getItem: (key: string) => string | null;
    setItem: (key: string, value: string) => void;
}

export interface SplitterBounds {
    minTranscriptSplit: number;
    maxTranscriptSplit: number;
    safeSplitterPosition: number;
    transcriptPanePx: number;
    chatPanePx: number;
}

export const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export const clampSplitterPosition = (value: unknown) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return DEFAULT_TRANSCRIPT_SPLIT;
    return clamp(parsed, MIN_TRANSCRIPT_SPLIT, MAX_TRANSCRIPT_SPLIT);
};

export const persistSplitterPosition = (storage: SplitterStorageLike, value: unknown) => {
    const next = clampSplitterPosition(value);
    storage.setItem(SPLITTER_STORAGE_KEY, String(next));
    storage.setItem(SPLITTER_STORAGE_VERSION_KEY, SPLITTER_STORAGE_VERSION);
    return next;
};

export const readStoredSplitterPosition = (storage: SplitterStorageLike) => {
    try {
        const storedVersion = storage.getItem(SPLITTER_STORAGE_VERSION_KEY);
        const stored = storedVersion === SPLITTER_STORAGE_VERSION ? storage.getItem(SPLITTER_STORAGE_KEY) : null;
        return persistSplitterPosition(storage, stored === null ? DEFAULT_TRANSCRIPT_SPLIT : stored);
    } catch {
        return DEFAULT_TRANSCRIPT_SPLIT;
    }
};

export const calculateSplitterBounds = (contentHeight: number, splitterPosition: unknown): SplitterBounds => {
    if (!Number.isFinite(contentHeight) || contentHeight <= 0) {
        const safeSplitterPosition = clampSplitterPosition(splitterPosition);
        return {
            minTranscriptSplit: MIN_TRANSCRIPT_SPLIT,
            maxTranscriptSplit: MAX_TRANSCRIPT_SPLIT,
            safeSplitterPosition,
            transcriptPanePx: 0,
            chatPanePx: 0,
        };
    }

    const availableHeight = Math.max(0, contentHeight - SPLITTER_THICKNESS_PX);
    const transcriptMinLimit = (MIN_TRANSCRIPT_PANE_PX / contentHeight) * 100;
    const requestedChatLimit = ((availableHeight - MIN_CHAT_PANE_PX) / contentHeight) * 100;

    const maxTranscriptSplit = clamp(
        Math.max(transcriptMinLimit, requestedChatLimit),
        transcriptMinLimit,
        MAX_TRANSCRIPT_SPLIT,
    );
    const minTranscriptSplit = clamp(transcriptMinLimit, MIN_TRANSCRIPT_SPLIT, maxTranscriptSplit);
    const safeSplitterPosition = clamp(clampSplitterPosition(splitterPosition), minTranscriptSplit, maxTranscriptSplit);
    const transcriptPanePx = (safeSplitterPosition / 100) * contentHeight;
    const chatPanePx = Math.max(0, contentHeight - transcriptPanePx - SPLITTER_THICKNESS_PX);

    return {
        minTranscriptSplit,
        maxTranscriptSplit,
        safeSplitterPosition,
        transcriptPanePx,
        chatPanePx,
    };
};
