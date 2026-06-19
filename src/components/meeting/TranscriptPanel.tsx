import React, { useEffect, useMemo, useState } from 'react';
import RollingTranscript from '../ui/RollingTranscript';
import type { TranscriptDisplayMode, TranscriptSegment } from '../../lib/transcriptSegments';
import type { AutoAnswerMode, AutoAnswerUiState } from '../../hooks/useMeetingChat';

interface TranscriptPanelProps {
    transcriptSegments: TranscriptSegment[];
    isInterviewerSpeaking: boolean;
    currentInterviewerPartial: string;
    isUserSpeaking: boolean;
    currentUserPartial: string;
    transcriptDisplayMode: TranscriptDisplayMode;
    showTranscript: boolean;
    handleTranslateTranscriptSegment: (segment: TranscriptSegment) => void;
    sttStatus: { label: string; toneClass: string; dotClass: string };
    sttNeedsTroubleshooting: boolean;
    showSttErrorDetail: boolean;
    sttTroubleshootingMessage?: string | null;
    nativeAudioHealth: { lastError: string | null };
    appearance: ReturnType<typeof import('../../lib/overlayAppearance').getOverlayAppearance>;
    isLightTheme: boolean;
    autoAnswerState: AutoAnswerUiState;
    setAutoAnswerMode: (mode: AutoAnswerMode) => void;
    dismissAutoAnswerQuestion: () => void;
    answerDetectedQuestion: () => void;
}

const subtleSurfaceClass = 'overlay-subtle-surface';
const AUTO_ANSWER_PANEL_COLLAPSED_KEY = 'pika_auto_answer_panel_collapsed';

function getAutoAnswerCopy(state: AutoAnswerUiState): { label: string; status: string; toneClass: string } {
    const label = state.mode === 'auto_answer' ? 'Auto' : state.mode === 'detect_only' ? 'Detect' : 'Off';
    if (state.status === 'generating') return { label, status: 'Generating answer', toneClass: 'text-blue-300' };
    if (state.status === 'detected') return { label, status: 'Question detected', toneClass: 'text-amber-200' };
    if (state.status === 'answered') return { label, status: 'Answered', toneClass: 'text-emerald-300' };
    if (state.status === 'skipped') return { label, status: state.reason || 'Skipped', toneClass: 'text-text-tertiary' };
    if (state.status === 'error') return { label, status: 'Needs attention', toneClass: 'text-red-300' };
    if (state.mode === 'off') return { label, status: 'Manual only', toneClass: 'text-text-tertiary' };
    return { label, status: 'Listening for interviewer questions', toneClass: 'text-text-secondary' };
}

const AutoAnswerPanel: React.FC<{
    state: AutoAnswerUiState;
    appearance: ReturnType<typeof import('../../lib/overlayAppearance').getOverlayAppearance>;
    setMode: (mode: AutoAnswerMode) => void;
    dismissQuestion: () => void;
    answerQuestion: () => void;
}> = ({ state, appearance, setMode, dismissQuestion, answerQuestion }) => {
    const [collapsed, setCollapsed] = useState(() => {
        const stored = localStorage.getItem(AUTO_ANSWER_PANEL_COLLAPSED_KEY);
        return stored === null ? state.mode === 'off' : stored === 'true';
    });
    const [answerLanguage, setAnswerLanguage] = useState('auto');
    const [answerLanguageDraft, setAnswerLanguageDraft] = useState('');

    const copy = useMemo(() => getAutoAnswerCopy(state), [state]);
    const hasQuestion = !!state.question && state.mode !== 'off';
    const shouldForceReadable = state.status === 'detected' || state.status === 'generating' || state.status === 'error';

    useEffect(() => {
        if (shouldForceReadable) setCollapsed(false);
    }, [shouldForceReadable]);

    useEffect(() => {
        localStorage.setItem(AUTO_ANSWER_PANEL_COLLAPSED_KEY, String(collapsed));
    }, [collapsed]);

    useEffect(() => {
        let alive = true;
        window.electronAPI?.getAiResponseLanguage?.()
            .then((language) => {
                if (alive && language) {
                    setAnswerLanguage(language);
                    setAnswerLanguageDraft(language === 'auto' ? '' : language);
                }
            })
            .catch(() => {});
        return () => { alive = false; };
    }, []);

    const persistAnswerLanguage = async (rawLanguage: string) => {
        const language = rawLanguage.trim() || 'auto';
        const previous = answerLanguage;
        setAnswerLanguage(language);
        setAnswerLanguageDraft(language === 'auto' ? '' : language);
        try {
            const result = await window.electronAPI?.setAiResponseLanguage?.(language);
            if (result && !result.success) {
                setAnswerLanguage(previous);
                setAnswerLanguageDraft(previous === 'auto' ? '' : previous);
            }
        } catch {
            setAnswerLanguage(previous);
            setAnswerLanguageDraft(previous === 'auto' ? '' : previous);
        }
    };

    const languageControl = (
        <div className="pika-language-control grid min-w-0 items-center gap-2 rounded-lg border border-border-subtle/50 bg-bg-input/35 px-2 py-1.5">
            <span className="pika-language-label text-[10px] font-semibold uppercase tracking-[0.12em] text-text-tertiary">Answer language</span>
            <input
                value={answerLanguageDraft}
                onChange={(event) => setAnswerLanguageDraft(event.target.value)}
                onBlur={() => persistAnswerLanguage(answerLanguageDraft)}
                onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                        event.currentTarget.blur();
                    }
                }}
                placeholder={answerLanguage === 'auto' ? 'Auto / any language or mix' : answerLanguage}
                aria-label="Custom answer language"
                title="Type any language or language mix. Leave blank for Auto."
                className="pika-language-input min-w-[150px] rounded-md border border-white/10 bg-white/[0.04] px-2 py-1 text-[10px] font-medium text-text-primary placeholder:text-text-tertiary shadow-none transition-colors hover:bg-white/[0.06] focus:bg-white/[0.06] focus-visible:bg-white/[0.06] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent-primary/60 [color-scheme:dark] [-webkit-text-fill-color:theme(colors.text.primary)]"
                style={{ backgroundColor: 'rgba(255, 255, 255, 0.04)' }}
            />
            <button
                type="button"
                onClick={() => persistAnswerLanguage('auto')}
                aria-pressed={answerLanguage === 'auto'}
                className={`pika-language-same-button rounded-md border border-border-subtle/70 px-2 py-1 text-[10px] font-semibold transition-colors ${answerLanguage === 'auto'
                    ? 'bg-accent-primary text-white shadow-sm'
                    : 'bg-bg-input/50 text-text-tertiary hover:text-text-primary'
                    }`}
                title="Same language: answer in the interviewer/question language"
            >
                Same language
            </button>
        </div>
    );

    return (
        <div className="shrink-0 px-2.5 pb-2 no-drag">
            <div
                className="rounded-xl border border-border-subtle/70 overlay-subtle-surface shadow-sm overflow-hidden"
                style={appearance.subtleStyle}
            >
                <div className="flex min-w-0 items-center justify-between gap-2 px-2.5 py-1.5">
                    <button
                        type="button"
                        onClick={() => setCollapsed((value) => !value)}
                        className="flex min-w-0 flex-1 items-center gap-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-primary rounded-lg"
                        aria-expanded={!collapsed}
                        title={collapsed ? 'Show Auto Answer' : 'Hide Auto Answer'}
                    >
                        <span className="shrink-0 rounded-md border border-border-subtle/70 bg-bg-input/70 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-[0.14em] text-text-tertiary">
                            Auto Answer
                        </span>
                        <span className={`min-w-0 truncate text-[11px] font-semibold ${copy.toneClass}`}>
                            {copy.label} · {copy.status}
                        </span>
                        {hasQuestion && collapsed && (
                            <span className="shrink-0 rounded-full bg-accent-primary/15 px-1.5 py-0.5 text-[9px] font-semibold text-accent-primary">
                                {typeof state.confidence === 'number' ? `${Math.round(state.confidence * 100)}%` : 'New'}
                            </span>
                        )}
                    </button>

                    <div className="flex shrink-0 items-center gap-1">
                        {!collapsed && (
                            <div className="flex rounded-full border border-border-subtle/70 bg-bg-input/60 p-0.5">
                                {([
                                    ['off', 'Off'],
                                    ['detect_only', 'Detect'],
                                    ['auto_answer', 'Auto'],
                                ] as Array<[AutoAnswerMode, string]>).map(([mode, label]) => (
                                    <button
                                        key={mode}
                                        type="button"
                                        aria-pressed={state.mode === mode}
                                        onClick={() => setMode(mode)}
                                        className={`rounded-full px-2 py-0.5 text-[10px] font-semibold transition-colors ${state.mode === mode
                                            ? 'bg-accent-primary text-white shadow-sm'
                                            : 'text-text-tertiary hover:text-text-primary'
                                            }`}
                                    >
                                        {label}
                                    </button>
                                ))}
                            </div>
                        )}
                        <button
                            type="button"
                            onClick={() => setCollapsed((value) => !value)}
                            className="rounded-md border border-border-subtle/70 bg-bg-input/50 px-1.5 py-0.5 text-[10px] font-semibold text-text-tertiary hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-primary"
                            title={collapsed ? 'Show Auto Answer' : 'Hide Auto Answer'}
                        >
                            {collapsed ? 'Show' : 'Hide'}
                        </button>
                    </div>
                </div>

                {!collapsed && (
                    <div className="space-y-2 border-t border-border-subtle/60 px-2.5 py-2">
                        {hasQuestion ? (
                            <div className="rounded-lg border border-border-subtle/60 bg-bg-input/45 px-2.5 py-2">
                                <div className="mb-1 flex flex-wrap items-center gap-1.5 text-[10px] font-semibold text-text-tertiary">
                                    <span>Detected {state.type || 'interview'} question</span>
                                    {typeof state.confidence === 'number' && <span>· {Math.round(state.confidence * 100)}%</span>}
                                </div>
                                <div className="max-h-[22vh] overflow-y-auto pr-1 custom-scrollbar">
                                    <p className="whitespace-pre-wrap break-words text-xs leading-snug text-text-primary">
                                        {state.question}
                                    </p>
                                    {state.error && (
                                        <p className="mt-2 whitespace-pre-wrap break-words rounded-md border border-red-500/30 bg-red-500/10 px-2 py-1.5 text-[10px] leading-snug text-red-200">
                                            {state.error}
                                        </p>
                                    )}
                                    {state.reason && state.status !== 'error' && (
                                        <p className="mt-1 break-words text-[9px] leading-snug text-text-tertiary">
                                            {state.reason}
                                        </p>
                                    )}
                                </div>
                                <div className="mt-2 flex flex-wrap justify-end gap-1.5">
                                    {state.mode === 'detect_only' && (
                                        <button
                                            type="button"
                                            onClick={answerQuestion}
                                            className="rounded-md bg-accent-primary px-2 py-1 text-[10px] font-semibold text-white transition-colors hover:bg-accent-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-primary"
                                        >
                                            Answer
                                        </button>
                                    )}
                                    <button
                                        type="button"
                                        onClick={dismissQuestion}
                                        className="rounded-md border border-border-subtle bg-bg-input px-2 py-1 text-[10px] font-medium text-text-secondary transition-colors hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-primary"
                                    >
                                        Dismiss
                                    </button>
                                </div>
                                <div className="mt-2">
                                    {languageControl}
                                </div>
                            </div>
                        ) : (
                            <div className="space-y-2 text-[10px] text-text-tertiary">
                                <p className="min-w-0 break-words">Detects final interviewer questions; mic echo duplicates are ignored.</p>
                                {languageControl}
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
};

const TranscriptPanel: React.FC<TranscriptPanelProps> = ({
    transcriptSegments,
    isInterviewerSpeaking,
    currentInterviewerPartial,
    isUserSpeaking,
    currentUserPartial,
    transcriptDisplayMode,
    showTranscript,
    handleTranslateTranscriptSegment,
    sttStatus,
    sttNeedsTroubleshooting,
    showSttErrorDetail,
    sttTroubleshootingMessage,
    nativeAudioHealth,
    appearance,
    isLightTheme,
    autoAnswerState,
    setAutoAnswerMode,
    dismissAutoAnswerQuestion,
    answerDetectedQuestion,
}) => {
    const hasTranscriptContent = transcriptSegments.length > 0 || isInterviewerSpeaking || isUserSpeaking;
    const partialText = currentInterviewerPartial || currentUserPartial;
    const partialSpeakerLabel = currentInterviewerPartial ? 'Interviewer' : 'Me';
    const placeholderText = 'Transcript will appear here when meeting audio is detected';
    const statusDetail = showSttErrorDetail ? (sttTroubleshootingMessage || nativeAudioHealth.lastError) : null;
    const statusTitle = statusDetail ? `${sttStatus.label} - ${statusDetail}` : sttStatus.label;

    return (
        <div className="flex h-full min-h-0 flex-col overflow-hidden custom-scrollbar">
            <AutoAnswerPanel
                state={autoAnswerState}
                appearance={appearance}
                setMode={setAutoAnswerMode}
                dismissQuestion={dismissAutoAnswerQuestion}
                answerQuestion={answerDetectedQuestion}
            />

            <div className="flex-1 min-h-0">
                {showTranscript && hasTranscriptContent ? (
                    <RollingTranscript
                        segments={transcriptSegments}
                        partialText={partialText || undefined}
                        displayMode={transcriptDisplayMode}
                        isActive={isInterviewerSpeaking || isUserSpeaking}
                        partialSpeakerLabel={partialSpeakerLabel}
                        surfaceStyle={appearance.transcriptStyle}
                        onTranslateSegment={handleTranslateTranscriptSegment}
                    />
                ) : (
                    <div className="flex h-full items-center justify-center px-3 py-3 no-drag">
                        <div
                            className="max-w-[320px] rounded-2xl px-4 py-5 text-center text-sm leading-relaxed text-text-tertiary/90 overlay-transcript-surface"
                            style={appearance.transcriptStyle}
                        >
                            {placeholderText}
                        </div>
                    </div>
                )}
            </div>

            <div className="shrink-0 px-3 py-2 no-drag" aria-live="polite" aria-atomic="true">
                <div
                    title={statusTitle}
                    className={`flex max-w-full items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-medium border border-border-subtle/70 ${subtleSurfaceClass} ${sttStatus.toneClass}`}
                    style={appearance.subtleStyle}
                >
                    <span aria-hidden="true" className={`h-1.5 w-1.5 shrink-0 rounded-full ${sttStatus.dotClass}`} />
                    <span className="min-w-0 truncate">{sttStatus.label}</span>
                    {statusDetail && <span className="shrink-0 opacity-60">•</span>}
                    {statusDetail && <span className="min-w-0 truncate opacity-80">{statusDetail}</span>}
                </div>
            </div>

            {sttNeedsTroubleshooting && (
                <div className="mx-4 mb-2 rounded-lg border border-state-warning-border bg-state-warning-soft px-2.5 py-1.5 no-drag">
                    <div className="flex items-start gap-2">
                        <p className={`min-w-0 flex-1 overflow-hidden text-[10px] leading-snug ${isLightTheme ? 'text-amber-800' : 'text-amber-200'}`} style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
                            {sttTroubleshootingMessage || statusDetail || 'No meeting audio detected. Try Default or the output playing the video.'}
                        </p>
                        <button
                            type="button"
                            onClick={() => window.electronAPI.toggleSettingsWindow({ tab: 'audio' })}
                            className="shrink-0 rounded-md border border-border-subtle bg-bg-input px-2 py-0.5 text-[10px] font-medium text-text-primary transition-colors hover:bg-bg-elevated focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-primary"
                        >
                            Audio
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
};

export default TranscriptPanel;
