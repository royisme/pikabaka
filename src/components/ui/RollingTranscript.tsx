import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Languages } from 'lucide-react';
import type { TranscriptDisplayMode, TranscriptSegment } from '../../lib/transcriptSegments';
import { transcriptRowParts } from '../../lib/transcriptRow';

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
    const bottomRef = useRef<HTMLDivElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const [userScrolled, setUserScrolled] = useState(false);
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

    useEffect(() => {
        if (!userScrolled && bottomRef.current) {
            bottomRef.current.scrollIntoView({ behavior: 'smooth', block: 'end' });
        }
    }, [segments.length, contentSignature, partialText, userScrolled]);

    const handleScroll = () => {
        const el = containerRef.current;
        if (!el) return;
        const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 32;
        setUserScrolled(!atBottom);
    };

    if (!hasContent) return null;

    const lastLabel = segments.length > 0 ? segments[segments.length - 1].speakerLabel : undefined;

    return (
        <div className="px-4 pt-2 pb-1 no-drag">
            <div
                ref={containerRef}
                onScroll={handleScroll}
                aria-live="polite"
                aria-label="Meeting transcript"
                className="w-full min-h-[80px] max-h-[280px] overflow-y-auto"
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

                    <div ref={bottomRef} className="h-px" />
                </div>
            </div>

            {userScrolled && (
                <button
                    type="button"
                    aria-label="Scroll to latest"
                    onClick={() => {
                        setUserScrolled(false);
                        bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
                    }}
                    className="mt-1 ml-auto flex items-center gap-1 text-[11px] text-text-tertiary hover:text-text-secondary transition-colors"
                >
                    <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
                        <path
                            d="M5 2v6M2 6l3 3 3-3"
                            stroke="currentColor"
                            strokeWidth="1.2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                        />
                    </svg>
                    Jump to latest
                </button>
            )}
        </div>
    );
};

export default TranscriptNotes;
