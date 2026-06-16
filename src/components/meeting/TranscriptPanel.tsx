import React from 'react';
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
    const partialText = currentUserPartial || currentInterviewerPartial;
    const partialSpeakerLabel = currentUserPartial ? 'Me' : 'Interviewer';
    const placeholderText = 'Transcript will appear here when meeting audio is detected';
    const statusDetail = showSttErrorDetail ? (sttTroubleshootingMessage || nativeAudioHealth.lastError) : null;
    const statusTitle = statusDetail ? `${sttStatus.label} - ${statusDetail}` : sttStatus.label;
    const autoAnswerLabel = autoAnswerState.mode === 'auto_answer' ? 'Auto Answer' : autoAnswerState.mode === 'detect_only' ? 'Detect Only' : 'Off';
    const autoAnswerStatus = autoAnswerState.status === 'generating'
        ? 'Generating answer…'
        : autoAnswerState.status === 'detected'
            ? 'Question detected'
            : autoAnswerState.status === 'answered'
                ? 'Answered'
                : autoAnswerState.status === 'error'
                    ? 'Needs attention'
                    : autoAnswerState.mode === 'off' ? 'Manual only' : 'Listening for interviewer questions';

    return (
        <div className="flex h-full min-h-0 flex-col overflow-hidden custom-scrollbar">

            <div className="shrink-0 px-3 pb-2 no-drag">
                <div className="rounded-2xl border border-border-subtle/70 overlay-subtle-surface px-3 py-2 space-y-2" style={appearance.subtleStyle}>
                    <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0">
                            <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-text-tertiary">Auto Answer</div>
                            <div className={`text-xs font-medium ${autoAnswerState.status === 'error' ? 'text-red-300' : 'text-text-secondary'}`}>
                                {autoAnswerLabel} · {autoAnswerStatus}
                            </div>
                        </div>
                        <div className="flex shrink-0 rounded-full border border-border-subtle/70 bg-bg-input/60 p-0.5">
                            {([
                                ['off', 'Off'],
                                ['detect_only', 'Detect'],
                                ['auto_answer', 'Auto'],
                            ] as Array<[AutoAnswerMode, string]>).map(([mode, label]) => (
                                <button
                                    key={mode}
                                    type="button"
                                    onClick={() => setAutoAnswerMode(mode)}
                                    className={`rounded-full px-2 py-0.5 text-[10px] font-semibold transition-colors ${autoAnswerState.mode === mode
                                        ? 'bg-accent-primary text-white shadow-sm'
                                        : 'text-text-tertiary hover:text-text-primary'
                                        }`}
                                >
                                    {label}
                                </button>
                            ))}
                        </div>
                    </div>

                    {autoAnswerState.question && autoAnswerState.mode !== 'off' && (
                        <div className="rounded-xl border border-border-subtle/60 bg-bg-input/50 px-2.5 py-2">
                            <div className="flex items-start gap-2">
                                <div className="min-w-0 flex-1">
                                    <div className="text-[10px] font-semibold text-text-tertiary mb-1">
                                        Detected {autoAnswerState.type || 'interview'} question{typeof autoAnswerState.confidence === 'number' ? ` · ${Math.round(autoAnswerState.confidence * 100)}%` : ''}
                                    </div>
                                    <p className="text-xs leading-snug text-text-primary" style={{ display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical' }}>
                                        {autoAnswerState.question}
                                    </p>
                                    {autoAnswerState.error && (
                                        <p className="mt-1 text-[10px] leading-snug text-red-300">{autoAnswerState.error}</p>
                                    )}
                                </div>
                                <div className="flex shrink-0 flex-col gap-1">
                                    {autoAnswerState.mode === 'detect_only' && (
                                        <button
                                            type="button"
                                            onClick={answerDetectedQuestion}
                                            className="rounded-md bg-accent-primary px-2 py-1 text-[10px] font-semibold text-white transition-colors hover:bg-accent-primary/90"
                                        >
                                            Answer
                                        </button>
                                    )}
                                    <button
                                        type="button"
                                        onClick={dismissAutoAnswerQuestion}
                                        className="rounded-md border border-border-subtle bg-bg-input px-2 py-1 text-[10px] font-medium text-text-secondary transition-colors hover:text-text-primary"
                                    >
                                        Dismiss
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            </div>

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
