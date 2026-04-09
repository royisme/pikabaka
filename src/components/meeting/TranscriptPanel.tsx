import React from 'react';
import RollingTranscript from '../ui/RollingTranscript';
import type { TranscriptDisplayMode, TranscriptSegment } from '../../lib/transcriptSegments';

interface TranscriptPanelProps {
    transcriptSegments: TranscriptSegment[];
    isInterviewerSpeaking: boolean;
    currentInterviewerPartial: string;
    transcriptDisplayMode: TranscriptDisplayMode;
    showTranscript: boolean;
    handleTranslateTranscriptSegment: (segment: TranscriptSegment) => void;
    sttStatus: { label: string; toneClass: string; dotClass: string };
    sttNeedsTroubleshooting: boolean;
    showSttErrorDetail: boolean;
    nativeAudioHealth: { lastError: string | null };
    appearance: ReturnType<typeof import('../../lib/overlayAppearance').getOverlayAppearance>;
    isLightTheme: boolean;
}

const subtleSurfaceClass = 'overlay-subtle-surface';

const TranscriptPanel: React.FC<TranscriptPanelProps> = ({
    transcriptSegments,
    isInterviewerSpeaking,
    currentInterviewerPartial,
    transcriptDisplayMode,
    showTranscript,
    handleTranslateTranscriptSegment,
    sttStatus,
    sttNeedsTroubleshooting,
    showSttErrorDetail,
    nativeAudioHealth,
    appearance,
    isLightTheme,
}) => {
    const hasTranscriptContent = transcriptSegments.length > 0 || isInterviewerSpeaking;
    const placeholderText = 'Transcript will appear here when meeting audio is detected';

    return (
        <div className="flex h-full flex-col overflow-y-auto custom-scrollbar">
            <div className="flex-1">
                {showTranscript && hasTranscriptContent ? (
                    <RollingTranscript
                        segments={transcriptSegments}
                        partialText={isInterviewerSpeaking ? currentInterviewerPartial : undefined}
                        displayMode={transcriptDisplayMode}
                        isActive={isInterviewerSpeaking}
                        surfaceStyle={appearance.transcriptStyle}
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

            <div className="px-4 pt-2 pb-1 no-drag" aria-live="polite" aria-atomic="true">
                <div
                    className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-medium border border-border-subtle/70 ${subtleSurfaceClass} ${sttStatus.toneClass}`}
                    style={appearance.subtleStyle}
                >
                    <span aria-hidden="true" className={`w-1.5 h-1.5 rounded-full ${sttStatus.dotClass}`} />
                    <span>{sttStatus.label}</span>
                    {showSttErrorDetail && <span className="opacity-80">- {nativeAudioHealth.lastError}</span>}
                </div>
            </div>

            {sttNeedsTroubleshooting && (
                <div className="mx-4 mb-2 p-2 rounded-lg border border-amber-500/30 bg-amber-500/10 no-drag">
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
