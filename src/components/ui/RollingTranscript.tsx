import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Languages, MessageSquarePlus, Reply, TriangleAlert } from 'lucide-react';
import type { TranscriptDisplayMode, TranscriptSegment } from '../../lib/transcriptSegments';
import { failureReasonText, rowSlot, transcriptRowParts, type RowSlot } from '../../lib/transcriptRow';
import { countNewRows, isNearBottom, newestPreview, nextTranscriptScroll } from '../../lib/answerScroll';
import { nextAnnouncement } from '../../lib/transcriptAnnounce';

interface TranscriptNotesProps {
    segments: TranscriptSegment[];
    partialText?: string;
    displayMode?: TranscriptDisplayMode;
    translationOn?: boolean;
    partialSpeakerLabel?: string;
    onTranslateSegment?: (segment: TranscriptSegment) => void;
    onAskSegment?: (segment: TranscriptSegment) => void;
    onReplySegment?: (segment: TranscriptSegment) => void;
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
                    <span className="text-state-danger-strong">
                        {slot.reason && failureReasonText(slot.reason) ? `Translation failed · ${failureReasonText(slot.reason)}` : 'Translation failed'}
                    </span>
                    {onRetry && (
                        <button
                            type="button"
                            onClick={onRetry}
                            className="rounded-full border border-border-subtle px-2 py-0.5 text-[11px] overlay-text-secondary hover:text-[var(--overlay-text-primary)]"
                        >
                            Retry
                        </button>
                    )}
                </>
            )}
        </div>
    );
}

/** The jump-to-latest pill. Its width is fixed so a longer preview or a bigger count never makes it jump. */
export function NewRowsPill({ count, preview, onClick }: { count: number; preview: string; onClick: () => void }) {
    return (
        <button
            type="button"
            aria-label={count > 0 ? `Jump to latest, ${count} new ${count === 1 ? 'line' : 'lines'}` : 'Jump to latest'}
            onClick={onClick}
            className="absolute bottom-2 right-3 flex w-44 max-w-[calc(100%-1.5rem)] items-center gap-1 rounded-full border border-border-subtle px-2.5 py-1 text-[11px] font-medium overlay-text-primary overlay-subtle-surface min-[480px]:w-56"
        >
            <span aria-hidden="true" className="shrink-0">↓</span>
            <span aria-hidden="true" className="shrink-0">
                {count > 0 ? count : 'Latest'}
                {count > 0 && <span className="hidden min-[480px]:inline"> new</span>}
            </span>
            {preview && (
                <span aria-hidden="true" data-pill-preview="true" className="min-w-0 flex-1 truncate text-left font-normal overlay-text-secondary">
                    {preview}
                </span>
            )}
        </button>
    );
}

const TranscriptNotes: React.FC<TranscriptNotesProps> = ({
    segments,
    partialText,
    displayMode = 'both',
    translationOn = false,
    partialSpeakerLabel = 'Them',
    onTranslateSegment,
    onAskSegment,
    onReplySegment,
}) => {
    const containerRef = useRef<HTMLDivElement>(null);
    // Following is read from scroll events, not measured after a render: by then new content has
    // already grown the list and the reader would look as if they had scrolled up.
    const followingRef = useRef(true);
    const [rowsWhenFollowStopped, setRowsWhenFollowStopped] = useState<number | null>(null);
    const [expandedId, setExpandedId] = useState<string | null>(null);

    const hasContent = segments.length > 0 || !!partialText;

    const partialLabel = useMemo(() => partialSpeakerLabel.trim() || 'Them', [partialSpeakerLabel]);

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
                <div className="mx-auto max-w-[680px] space-y-2.5 pr-0.5">
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
                                className={`group border-l-2 pl-2 ${newest ? 'border-[var(--overlay-action)]' : 'border-transparent'}`}
                            >
                                {showSpeaker && (
                                    <div className="text-[11px] font-medium overlay-text-muted">{seg.speakerLabel}</div>
                                )}
                                <SlotLine slot={slot} onRetry={onTranslateSegment ? () => onTranslateSegment(seg) : undefined} />
                                <div className="flex items-start gap-1">
                                <button
                                    type="button"
                                    aria-expanded={expanded}
                                    onClick={() => setExpandedId(expanded ? null : seg.segmentId)}
                                    className="block min-w-0 flex-1 text-left"
                                >
                                    <span className={`block whitespace-pre-wrap break-words ${leadClass}${parts.updating && parts.translationBelow === null ? ' opacity-70' : ''}`}>
                                        {parts.lead}
                                        {seg.originalText && (
                                            <span className="ml-1 text-[11px] overlay-text-muted" title={`Heard as: ${seg.originalText}`} data-corrected="true">
                                                <span aria-hidden="true">✎</span>
                                                <span className="sr-only">Corrected. Heard as: {seg.originalText}</span>
                                            </span>
                                        )}
                                        {parts.updating && parts.translationBelow === null && <span className="ml-1 text-[11px] overlay-text-muted"> · updating</span>}
                                    </span>
                                    {parts.translationBelow !== null && (
                                        <span className={`block text-xs leading-[17px] overlay-text-secondary whitespace-pre-wrap break-words${parts.updating ? ' opacity-70' : ''}`}>
                                            {parts.translationBelow}
                                            {parts.updating && <span className="ml-1 text-[11px] overlay-text-muted"> · updating</span>}
                                        </span>
                                    )}
                                    {parts.sourceBelow !== null && (
                                        <span className="block text-xs leading-[17px] overlay-text-muted whitespace-pre-wrap break-words">
                                            {parts.sourceBelow}
                                        </span>
                                    )}
                                </button>
                                {onAskSegment && !own && (
                                    <button
                                        type="button"
                                        onClick={() => onAskSegment(seg)}
                                        aria-label="Ask the agent about this line"
                                        title="Ask the agent about this line"
                                        data-ask-line="true"
                                        className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full overlay-text-muted opacity-0 hover:text-[var(--overlay-text-primary)] focus-visible:opacity-100 group-hover:opacity-100"
                                    >
                                        <MessageSquarePlus className="h-3 w-3" aria-hidden="true" />
                                    </button>
                                )}
                                {onReplySegment && !own && (
                                    <button
                                        type="button"
                                        onClick={() => onReplySegment(seg)}
                                        aria-label="Reply to this line"
                                        title="Reply to this line"
                                        data-reply-line="true"
                                        className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full overlay-text-muted opacity-0 hover:text-[var(--overlay-text-primary)] focus-visible:opacity-100 group-hover:opacity-100"
                                    >
                                        <Reply className="h-3 w-3" aria-hidden="true" />
                                    </button>
                                )}
                                </div>
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
                                                disabled={seg.translationState === 'pending' || seg.translationState === 'streaming'}
                                                className="inline-flex items-center gap-1 rounded-full border border-border-subtle px-2 py-0.5 text-[11px] overlay-text-secondary hover:text-[var(--overlay-text-primary)] disabled:cursor-wait disabled:opacity-70"
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
                <NewRowsPill count={newRows} preview={newestPreview(segments)} onClick={jumpToLatest} />
            )}
        </div>
    );
};

export default TranscriptNotes;
