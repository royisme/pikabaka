import React, { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Languages } from 'lucide-react';
import type { TranscriptDisplayMode, TranscriptSegment } from '../../lib/transcriptSegments';
import { transcriptRowParts } from '../../lib/transcriptRow';
import { countNewRows, isNearBottom, nextTranscriptScroll } from '../../lib/answerScroll';

interface TranscriptNotesProps {
    segments: TranscriptSegment[];
    partialText?: string;
    displayMode?: TranscriptDisplayMode;
    partialSpeakerLabel?: string;
    onTranslateSegment?: (segment: TranscriptSegment) => void;
}

function isOwnSpeech(label: string): boolean {
    return /^me$/i.test(label.trim());
}

function formatTime(ts: number): string {
    return new Date(ts).toLocaleTimeString(undefined, {
        hour: 'numeric',
        minute: '2-digit',
    });
}

const TranscriptNotes: React.FC<TranscriptNotesProps> = ({
    segments,
    partialText,
    displayMode = 'both',
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

    const newestOtherIndex = useMemo(() => {
        for (let i = segments.length - 1; i >= 0; i--) {
            if (!isOwnSpeech(segments[i].speakerLabel)) return i;
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
                aria-live="polite"
                aria-label="Meeting transcript"
                className="h-full w-full overflow-y-auto px-4 pt-2 pb-1"
            >
                <div className="space-y-2.5 pr-0.5">
                    {segments.map((seg, index) => {
                        const own = isOwnSpeech(seg.speakerLabel);
                        const expanded = expandedId === seg.segmentId;
                        // Own speech is never translated: it stays one quiet source line.
                        const parts = transcriptRowParts(seg, own ? 'original' : displayMode, expanded);
                        const newest = index === newestOtherIndex;
                        const showSpeaker = index === 0 || segments[index - 1].speakerLabel !== seg.speakerLabel;
                        const hasMeta = !!onTranslateSegment || !!seg.detectedLanguage;

                        const leadClass = own
                            ? 'text-xs leading-[17px] overlay-text-muted'
                            : parts.kind === 'awaiting'
                              ? 'text-xs leading-[17px] overlay-text-secondary'
                              : parts.kind === 'translation' && !newest
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
                                {parts.kind === 'awaiting' && (
                                    <div className="flex items-center gap-2 text-[11px] overlay-text-muted">
                                        {seg.translationState === 'error' ? (
                                            <>
                                                <span className="text-state-danger">Translation failed</span>
                                                {onTranslateSegment && (
                                                    <button
                                                        type="button"
                                                        onClick={() => onTranslateSegment(seg)}
                                                        className="rounded-full border border-border-subtle px-2 py-0.5 text-[11px] overlay-text-secondary hover:text-text-primary"
                                                    >
                                                        Retry
                                                    </button>
                                                )}
                                            </>
                                        ) : (
                                            <span>Translating…</span>
                                        )}
                                    </div>
                                )}
                                <button
                                    type="button"
                                    aria-expanded={expanded}
                                    onClick={() => setExpandedId(expanded ? null : seg.segmentId)}
                                    className="block w-full text-left"
                                >
                                    <span className={`block whitespace-pre-wrap break-words ${leadClass}`}>{parts.lead}</span>
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
                            <div className="text-[11px] overlay-text-muted">Live</div>
                            <p className="text-xs leading-[17px] overlay-text-primary whitespace-pre-wrap break-words">
                                {partialText}
                            </p>
                        </div>
                    )}
                </div>
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
