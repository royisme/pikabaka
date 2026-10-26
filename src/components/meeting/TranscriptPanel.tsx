import React from 'react';
import RollingTranscript from '../ui/RollingTranscript';
import type { TranscriptDisplayMode, TranscriptSegment } from '../../lib/transcriptSegments';

interface TranscriptPanelProps {
    transcriptSegments: TranscriptSegment[];
    isInterviewerSpeaking: boolean;
    currentInterviewerPartial: string;
    transcriptDisplayMode: TranscriptDisplayMode;
    translationEnabled: boolean;
    showTranscript: boolean;
    handleTranslateTranscriptSegment: (segment: TranscriptSegment) => void;
    sttNeedsTroubleshooting: boolean;
    showSttErrorDetail: boolean;
    nativeAudioHealth: { lastError: string | null };
    appearance: ReturnType<typeof import('../../lib/overlayAppearance').getOverlayAppearance>;
    isLightTheme: boolean;
}

const TranscriptPanel: React.FC<TranscriptPanelProps> = ({
    transcriptSegments,
    isInterviewerSpeaking,
    currentInterviewerPartial,
    transcriptDisplayMode,
    translationEnabled,
    showTranscript,
    handleTranslateTranscriptSegment,
    sttNeedsTroubleshooting,
    showSttErrorDetail,
    nativeAudioHealth,
    appearance,
    isLightTheme,
}) => {
    const hasTranscriptContent = transcriptSegments.length > 0 || isInterviewerSpeaking;
    const placeholderText = 'Transcript will appear here when meeting audio is detected';

    return (
        <div className="flex h-full min-h-0 flex-col">
            <div className="flex-1 min-h-0">
                {showTranscript && hasTranscriptContent ? (
                    <RollingTranscript
                        segments={transcriptSegments}
                        partialText={isInterviewerSpeaking ? currentInterviewerPartial : undefined}
                        displayMode={transcriptDisplayMode}
                        translationOn={translationEnabled}
                        onTranslateSegment={handleTranslateTranscriptSegment}
                    />
                ) : (
                    <div className="px-4 pt-3 pb-2 no-drag">
                        <div
                            className="rounded-2xl border border-dashed border-border-subtle/70 px-4 py-6 text-center text-sm text-text-tertiary overlay-transcript-surface"
                            style={appearance.transcriptStyle}
                        >
                            {placeholderText}
                        </div>
                    </div>
                )}
            </div>

            {showSttErrorDetail && nativeAudioHealth.lastError && (
                <p className="shrink-0 px-4 pb-1 text-[11px] overlay-text-muted no-drag">{nativeAudioHealth.lastError}</p>
            )}

            {sttNeedsTroubleshooting && (
                <div className="mx-4 mb-2 shrink-0 p-2 rounded-lg border border-state-warning-border bg-state-warning-soft no-drag">
                    <p className={`text-[10px] ${isLightTheme ? 'text-amber-800' : 'text-amber-200'}`}>
                        STT has no usable system audio input. Check output device routing and permissions.
                    </p>
                    <div className="mt-1.5 flex flex-wrap items-center gap-2">
                        <button
                            type="button"
                            onClick={() => window.electronAPI.toggleSettingsWindow()}
                            className="px-2.5 py-1 rounded-md text-[10px] font-medium border border-border-subtle bg-bg-input hover:bg-bg-elevated focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-primary text-text-primary transition-colors"
                        >
                            Open audio settings
                        </button>
                        <span className={`text-[10px] ${isLightTheme ? 'text-amber-700/80' : 'text-amber-200/80'}`}>
                            Tips: play audio on selected output device, then restart meeting if needed.
                        </span>
                    </div>
                </div>
            )}
        </div>
    );
};

export default TranscriptPanel;
