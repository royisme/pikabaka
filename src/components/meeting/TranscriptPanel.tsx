import React from 'react';
import RollingTranscript from '../ui/RollingTranscript';
import type { TranscriptDisplayMode, TranscriptSegment } from '../../lib/transcriptSegments';

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
}) => {
    const hasTranscriptContent = transcriptSegments.length > 0 || isInterviewerSpeaking || isUserSpeaking;
    const partialText = currentUserPartial || currentInterviewerPartial;
    const partialSpeakerLabel = currentUserPartial ? 'Me' : 'Interviewer';
    const placeholderText = 'Transcript will appear here when meeting audio is detected';
    const statusDetail = showSttErrorDetail ? (sttTroubleshootingMessage || nativeAudioHealth.lastError) : null;
    const statusTitle = statusDetail ? `${sttStatus.label} - ${statusDetail}` : sttStatus.label;

    return (
        <div className="flex h-full min-h-0 flex-col overflow-hidden custom-scrollbar">
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
                <div className="mx-4 mb-2 p-2 rounded-lg border border-state-warning-border bg-state-warning-soft no-drag">
                    <p className={`text-[10px] ${isLightTheme ? 'text-amber-800' : 'text-amber-200'}`}>
                        {sttTroubleshootingMessage || statusDetail || 'STT has no usable meeting audio input. Check output device routing and Screen & System Audio Recording permission.'}
                    </p>
                    <div className="mt-1.5 flex flex-wrap items-center gap-2">
                        <button
                            type="button"
                            onClick={() => window.electronAPI.toggleSettingsWindow({ tab: 'audio' })}
                            className="px-2.5 py-1 rounded-md text-[10px] font-medium border border-border-subtle bg-bg-input hover:bg-bg-elevated focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-primary text-text-primary transition-colors"
                        >
                            Open audio settings
                        </button>
                        <span className={`text-[10px] ${isLightTheme ? 'text-amber-700/80' : 'text-amber-200/80'}`}>
                            Microphone and Screen & System Audio Recording are separate permissions; update the blocked one, then restart the meeting.
                        </span>
                    </div>
                </div>
            )}
        </div>
    );
};

export default TranscriptPanel;
