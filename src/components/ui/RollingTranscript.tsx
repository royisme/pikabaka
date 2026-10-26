import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Languages, TriangleAlert } from 'lucide-react';
import type { TranscriptDisplayMode, TranscriptSegment } from '../../lib/transcriptSegments';
import { rowSlot, transcriptRowParts, type RowSlot } from '../../lib/transcriptRow';
import { countNewRows, isNearBottom, nextTranscriptScroll } from '../../lib/answerScroll';
import { nextAnnouncement } from '../../lib/transcriptAnnounce';

interface TranscriptNotesProps {
    segments: TranscriptSegment[];
    partialText?: string;
    displayMode?: TranscriptDisplayMode;
    translationOn?: boolean;
    partialSpeakerLabel?: string;
    onTranslateSegment?: (segment: TranscriptSegment) => void;
}

function isOwnSpeech(segment: TranscriptSegment): boolean {
    return segment.speaker === 'user';
}

function formatTime(ts: number): string {
    return new Date(ts).toLocaleTimeString(undefined, {
        hour: 'numeric',
        minute: '2-digit',
    });
}

/** The reserved line above the source text; 20px, the height of one line of translation. */
function SlotLine({ slot, onRetry }: { slot: RowSlot; onRetry?: () => void }) {
    if (!slot || slot.kind === 'translation') return null;
    return (
        <div className="flex min-h-[20px] items-center gap-2 text-[11px] overlay-text-muted">
            {slot.kind === 'live' && <span>◦ Live</span>}
            {slot.kind === 'translating' && (
                <span>{slot.elapsedSeconds === null ? 'Translating' : `Translating · ${slot.elapsedSeconds}s`}</span>
            )}
            {slot.kind === 'failed' && (
                <>
                    <TriangleAlert className="h-3 w-3 text-state-danger" aria-hidden="true" />
                    <span className="text-state-danger">Translation failed</span>
                    {onRetry && (
                        <button
                            type="button"
                            onClick={onRetry}
                            className="rounded-full border border-border-subtle px-2 py-0.5 text-[11px] overlay-text-secondary hover:text-text-primary"
                        >
                            Retry
                        </button>
                    )}
                </>
            )}
        </div>
    );
}

const TranscriptNotes: React.FC<TranscriptNotesProps> = ({
    segments,
    partialText,
    displayMode = 'both',
    translationOn = false,
    partialSpeakerLabel = 'Interviewer',
    onTranslateSegment,
}) => {
    const containerRef = useRef<HTMLDivElement>(null);
    // Following is read from scroll events, not measured after a render: by then new content has
    // already grown the list and the reader would look as if they had scrolled up.
    const followingRef = useRef(true);
    const [rowsWhenFollowStopped, setRowsWhenFollowStopped] = useState<number | null>(null);
    const [expandedId, setExpandedId] = useState<string | null>(null);

    const hasContent = segments.length > 0 || !!partialText;

    const partialLabel = useMemo(() => partialSpeakerLabel.trim() || 'Interviewer', [partialSpeakerLabel]);

    // One tick per second, and only while some translation is pending, so a slow one can show its elapsed time.
    const hasPending = segments.some((segment) => segment.translationState === 'pending');
    const [now, setNow] = useState(() => Date.now());
    useEffect(() => {
        if (!hasPending) return;
        setNow(Date.now());
        const timer = window.setInterval(() => setNow(Date.now()), 1000);
        return () => window.clearInterval(timer);
    }, [hasPending]);

    const slotContext = { mode: displayMode, translationOn, now };

    // Screen readers hear each finished translation once. The list itself is not a live region.
    const announcedRef = useRef<Set<string> | null>(null);
    const [announcement, setAnnouncement] = useState('');
    useEffect(() => {
        const first = announcedRef.current === null;
        const announced = (announcedRef.current ??= new Set<string>());
        const next = nextAnnouncement(segments, announced);
        if (!next) return;
        next.keys.forEach((key) => announced.add(key));
        // What is already on screen when the list first appears is not read out.
        if (!first) setAnnouncement(next.text);
    }, [segments]);

    const newestOtherIndex = useMemo(() => {
        for (let i = segments.length - 1; i >= 0; i--) {
            if (!isOwnSpeech(segments[i])) return i;
        }
        return -1;
    }, [segments]);

    const contentSignature = segments.reduce(
        (acc, s) => acc + s.sourceText.length + (s.translatedText?.length ?? 0), 0);

    useLayoutEffect(() => {
        const el = containerRef.current;
        if (el && nextTranscriptScroll({ following: followingRef.current, contentChanged: true }) === 'pin') {
            el.scrollTop = el.scrollHeight;
        }
    }, [segments.length, contentSignature, partialText, expandedId]);

    const handleScroll = () => {
        const el = containerRef.current;
        if (!el) return;
        const near = isNearBottom(el);
        followingRef.current = near;
        setRowsWhenFollowStopped((stopped) => (near ? null : stopped ?? segments.length));
    };

    // Enter on the focused list opens or closes the newest other-party row. The arrow, Page and
    // Home/End keys are the browser's own for a focused scroller; reaching the bottom resumes following.
    const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
        if (event.key !== 'Enter' || event.target !== event.currentTarget || newestOtherIndex < 0) return;
        event.preventDefault();
        const id = segments[newestOtherIndex].segmentId;
        setExpandedId((current) => (current === id ? null : id));
    };

    const jumpToLatest = () => {
        const el = containerRef.current;
        if (!el) return;
        followingRef.current = true;
        setRowsWhenFollowStopped(null);
        el.scrollTop = el.scrollHeight;
    };

    const newRows = countNewRows(segments.length, rowsWhenFollowStopped);

    if (!hasContent) return null;

    const lastLabel = segments.length > 0 ? segments[segments.length - 1].speakerLabel : undefined;

    return (
        <div className="relative h-full min-h-0 no-drag">
            <div
                ref={containerRef}
                onScroll={handleScroll}
                onKeyDown={handleKeyDown}
                role="log"
                aria-live="off"
                tabIndex={0}
                aria-label="Meeting transcript"
                className="h-full w-full overflow-y-auto px-4 pt-2 pb-1"
            >
                <div className="space-y-2.5 pr-0.5">
                    {segments.map((seg, index) => {
                        const own = isOwnSpeech(seg);
                        const expanded = expandedId === seg.segmentId;
                        // Own speech is never translated: it stays one quiet source line.
                        const parts = transcriptRowParts(seg, own ? 'original' : displayMode, expanded);
                        const slot = rowSlot(seg, slotContext);
                        const newest = index === newestOtherIndex;
                        const showSpeaker = index === 0 || segments[index - 1].speakerLabel !== seg.speakerLabel;
                        const hasMeta = !!onTranslateSegment || !!seg.detectedLanguage;

                        const leadClass = own
                            ? 'text-xs leading-[17px] overlay-text-muted'
                            : parts.kind === 'awaiting'
                              ? 'text-xs leading-[17px] overlay-text-secondary'
                              : parts.kind === 'translation' && (!newest || parts.updating)
                                ? 'text-sm leading-5 overlay-text-secondary'
                                : `text-sm leading-5 overlay-text-primary${newest ? ' font-medium' : ''}`;

                        return (
                            <div
                                key={seg.segmentId}
                                className={`border-l-2 pl-2 ${newest ? 'border-accent-primary' : 'border-transparent'}`}
                            >
                                {showSpeaker && (
                                    <div className="text-[11px] font-medium overlay-text-muted">{seg.speakerLabel}</div>
                                )}
                                <SlotLine slot={slot} onRetry={onTranslateSegment ? () => onTranslateSegment(seg) : undefined} />
                                <button
                                    type="button"
                                    aria-expanded={expanded}
                                    onClick={() => setExpandedId(expanded ? null : seg.segmentId)}
                                    className="block w-full text-left"
                                >
                                    <span className={`block whitespace-pre-wrap break-words ${leadClass}${parts.updating ? ' opacity-70' : ''}`}>
                                        {parts.lead}
                                        {parts.updating && <span className="ml-1 text-[11px] overlay-text-muted"> · updating</span>}
                                    </span>
                                    {parts.sourceBelow !== null && (
                                        <span className="block text-xs leading-[17px] overlay-text-muted whitespace-pre-wrap break-words">
                                            {parts.sourceBelow}
                                        </span>
                                    )}
                                </button>
                                {expanded && hasMeta && (
                                    <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] overlay-text-muted">
                                        {seg.detectedLanguage && (
                                            <span className="font-mono uppercase" title={`Detected language: ${seg.detectedLanguage}`}>
                                                {seg.detectedLanguage}
                                            </span>
                                        )}
                                        <time className="tabular-nums" dateTime={new Date(seg.timestamp).toISOString()}>
                                            {formatTime(seg.timestamp)}
                                        </time>
                                        {onTranslateSegment && (
                                            <button
                                                type="button"
                                                onClick={() => onTranslateSegment(seg)}
                                                disabled={seg.translationState === 'pending'}
                                                className="inline-flex items-center gap-1 rounded-full border border-border-subtle px-2 py-0.5 text-[11px] overlay-text-secondary hover:text-text-primary disabled:cursor-wait disabled:opacity-70"
                                            >
                                                <Languages className="h-3 w-3" aria-hidden="true" />
                                                <span>{parts.hasTranslation ? 'Retranslate' : 'Translate'}</span>
                                            </button>
                                        )}
                                    </div>
                                )}
                            </div>
                        );
                    })}

                    {partialText && (
                        <div className="border-l-2 border-transparent pl-2">
                            {lastLabel !== partialLabel && (
                                <div className="text-[11px] font-medium overlay-text-muted">{partialLabel}</div>
                            )}
                            <SlotLine slot={rowSlot('live', slotContext)} />
                            <p
                                className={`overlay-text-primary whitespace-pre-wrap break-words ${
                                    rowSlot('live', slotContext) ? 'text-xs leading-[17px]' : 'text-sm leading-5'
                                }`}
                            >
                                {partialText}
                            </p>
                        </div>
                    )}
                </div>
            </div>

            <div className="sr-only" aria-live="polite" aria-atomic="true">
                {announcement}
            </div>

            {rowsWhenFollowStopped !== null && (
                <button
                    type="button"
                    aria-label={newRows > 0 ? `Jump to latest, ${newRows} new ${newRows === 1 ? 'line' : 'lines'}` : 'Jump to latest'}
                    onClick={jumpToLatest}
                    className="absolute bottom-2 right-3 flex items-center gap-1 rounded-full border border-border-subtle px-2.5 py-1 text-[11px] font-medium overlay-text-primary overlay-subtle-surface"
                >
                    <span aria-hidden="true">↓</span>
                    <span aria-hidden="true">
                        {newRows > 0 ? newRows : 'Latest'}
                        {newRows > 0 && <span className="hidden min-[480px]:inline"> new</span>}
                    </span>
                </button>
            )}
        </div>
    );
};

export default TranscriptNotes;
