import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Globe, Languages, Loader2 } from 'lucide-react';
import type { TranscriptDisplayMode, TranscriptSegment } from '../../lib/transcriptSegments';

interface TranscriptNotesProps {
    segments: TranscriptSegment[];
    partialText?: string;
    displayMode?: TranscriptDisplayMode;
    isActive?: boolean;
    surfaceStyle?: React.CSSProperties;
    partialSpeakerLabel?: string;
    onTranslateSegment?: (segment: TranscriptSegment) => void;
}

const AVATAR_PALETTE = [
    'bg-sky-500/25 text-sky-100 ring-1 ring-sky-400/35',
    'bg-emerald-500/25 text-emerald-100 ring-1 ring-emerald-400/35',
    'bg-amber-500/25 text-amber-100 ring-1 ring-amber-400/35',
    'bg-rose-500/25 text-rose-100 ring-1 ring-rose-400/35',
    'bg-violet-500/25 text-violet-100 ring-1 ring-violet-400/35',
    'bg-cyan-500/25 text-cyan-100 ring-1 ring-cyan-400/35',
];

function paletteIndexForLabel(label: string): number {
    let h = 0;
    for (let i = 0; i < label.length; i++) {
        h = (h << 5) - h + label.charCodeAt(i);
        h |= 0;
    }
    return Math.abs(h) % AVATAR_PALETTE.length;
}

function avatarAbbrev(label: string): string {
    const u = label.trim();
    if (!u) return '?';
    if (/^me$/i.test(u)) return 'Me';
    const userNum = /^user\s*(\d+)$/i.exec(u);
    if (userNum) return `U${userNum[1]}`;
    const sNum = /^s(\d+)$/i.exec(u);
    if (sNum) return `S${sNum[1]}`;
    if (u.length <= 4) return u.toUpperCase();
    return u.slice(0, 2).toUpperCase();
}

function formatTime(ts: number): string {
    return new Date(ts).toLocaleTimeString(undefined, {
        hour: 'numeric',
        minute: '2-digit',
    });
}

function SpeakerAvatar({
    label,
    pulsing,
}: {
    label: string;
    pulsing?: boolean;
}) {
    const idx = paletteIndexForLabel(label);
    const ring = pulsing ? ' ring-2 ring-emerald-400/60 animate-pulse' : '';
    return (
        <div
            className={[
                'flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[9px] font-semibold leading-none tracking-tight',
                AVATAR_PALETTE[idx],
                ring,
            ].join(' ')}
            aria-hidden="true"
        >
            {avatarAbbrev(label)}
        </div>
    );
}

const TranscriptNotes: React.FC<TranscriptNotesProps> = ({
    segments,
    partialText,
    isActive = false,
    surfaceStyle,
    partialSpeakerLabel = 'Interviewer',
    onTranslateSegment,
}) => {
    const bottomRef = useRef<HTMLDivElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const [userScrolled, setUserScrolled] = useState(false);

    const hasContent = segments.length > 0 || !!partialText;

    const partialLabel = useMemo(() => partialSpeakerLabel.trim() || 'Interviewer', [partialSpeakerLabel]);

    useEffect(() => {
        if (!userScrolled && bottomRef.current) {
            bottomRef.current.scrollIntoView({ behavior: 'smooth', block: 'end' });
        }
    }, [segments.length, partialText, userScrolled]);

    const handleScroll = () => {
        const el = containerRef.current;
        if (!el) return;
        const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 32;
        setUserScrolled(!atBottom);
    };

    if (!hasContent) return null;

    return (
        <div className="px-4 pt-2 pb-1 no-drag">
            <div
                ref={containerRef}
                onScroll={handleScroll}
                aria-live="polite"
                aria-label="Meeting transcript"
                className="w-full min-h-[80px] max-h-[280px] overflow-y-auto"
            >
                <div className="space-y-3 pr-0.5">
                    {segments.map((seg) => {
                        const hasTranslation =
                            !!seg.translatedText && seg.translatedText.trim() !== '' && seg.translatedText !== seg.sourceText;
                        const isTranslationPending = seg.translationState === 'pending';
                        const showTranslation = hasTranslation;

                        return (
                            <div key={seg.segmentId} className="flex items-start gap-2.5">
                                <SpeakerAvatar label={seg.speakerLabel} />
                                <div className="min-w-0 flex-1">
                                    <div className="mb-1 flex items-center justify-between gap-2">
                                        <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0">
                                            <span className="text-[10px] font-semibold uppercase tracking-wide text-text-secondary">
                                                {seg.speakerLabel}
                                            </span>
                                            <time
                                                className="text-[9px] tabular-nums text-text-tertiary"
                                                dateTime={new Date(seg.timestamp).toISOString()}
                                            >
                                                {formatTime(seg.timestamp)}
                                            </time>
                                        </div>
                                        {onTranslateSegment && (
                                            <button
                                                type="button"
                                                onClick={() => onTranslateSegment(seg)}
                                                disabled={isTranslationPending}
                                                className="inline-flex items-center gap-1 rounded-full border border-border-subtle px-2 py-1 text-[10px] text-text-secondary transition-colors hover:bg-white/5 hover:text-text-primary disabled:cursor-wait disabled:opacity-70"
                                            >
                                                {isTranslationPending ? (
                                                    <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
                                                ) : (
                                                    <Languages className="h-3 w-3" aria-hidden="true" />
                                                )}
                                                <span>{hasTranslation ? 'Retranslate' : 'Translate'}</span>
                                            </button>
                                        )}
                                    </div>
                                    <div
                                        className="rounded-2xl border border-border-subtle px-4 py-3 shadow-sm overlay-transcript-surface"
                                        style={surfaceStyle}
                                    >
                                        <p className="overlay-text-primary text-[13px] leading-[1.55] whitespace-pre-wrap break-words">
                                            {seg.sourceText}
                                        </p>
                                        {showTranslation && (
                                            <>
                                                <div className="my-2.5 h-px bg-border-subtle/60" />
                                                <div className="flex gap-2">
                                                    <Globe
                                                        className="mt-0.5 h-3.5 w-3.5 shrink-0 text-sky-400/90"
                                                        strokeWidth={2}
                                                        aria-hidden="true"
                                                    />
                                                    <p className="overlay-text-secondary min-w-0 flex-1 text-[12px] italic leading-[1.55] whitespace-pre-wrap break-words">
                                                        {seg.translatedText}
                                                    </p>
                                                </div>
                                            </>
                                        )}
                                        {!showTranslation && isTranslationPending && (
                                            <div className="mt-2 flex items-center gap-2 text-[11px] text-text-tertiary">
                                                <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
                                                <span>Translating...</span>
                                            </div>
                                        )}
                                        {seg.translationState === 'error' && !showTranslation && (
                                            <div className="mt-2 text-[11px] text-amber-300">
                                                Translation failed. Try again.
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </div>
                        );
                    })}

                    {partialText && (
                        <div className="flex items-start gap-2.5 opacity-90">
                            <SpeakerAvatar label={partialLabel} pulsing={isActive} />
                            <div className="min-w-0 flex-1">
                                <div className="mb-1 flex flex-wrap items-baseline gap-x-2">
                                    <span className="text-[10px] font-semibold uppercase tracking-wide text-text-secondary">
                                        {partialLabel}
                                    </span>
                                    <span className="text-[9px] text-text-tertiary">Live</span>
                                </div>
                                <div
                                    className="rounded-2xl border border-border-subtle/80 px-4 py-3 overlay-transcript-surface"
                                    style={surfaceStyle}
                                >
                                    <p className="overlay-text-primary text-[13px] leading-[1.55] whitespace-pre-wrap break-words opacity-80">
                                        {partialText}
                                    </p>
                                </div>
                            </div>
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
                    className="mt-1 ml-auto flex items-center gap-1 text-[10px] text-text-tertiary hover:text-text-secondary transition-colors"
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
