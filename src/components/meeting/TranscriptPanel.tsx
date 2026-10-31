import React from 'react';
import RollingTranscript from '../ui/RollingTranscript';
import type { TranscriptDisplayMode, TranscriptSegment } from '../../lib/transcriptSegments';
import type { AudioStatus } from '../../lib/audioStatus';

interface TranscriptPanelProps {
    transcriptSegments: TranscriptSegment[];
    livePartial: { label: string; text: string } | null;
    transcriptDisplayMode: TranscriptDisplayMode;
    translationEnabled: boolean;
    showTranscript: boolean;
    handleTranslateTranscriptSegment: (segment: TranscriptSegment) => void;
    status: AudioStatus;
    onFixAudio: () => void;
}

const TranscriptPanel: React.FC<TranscriptPanelProps> = ({
    transcriptSegments,
    livePartial,
    transcriptDisplayMode,
    translationEnabled,
    showTranscript,
    handleTranslateTranscriptSegment,
    status,
    onFixAudio,
}) => {
    const hasTranscriptContent = transcriptSegments.length > 0 || livePartial !== null;
    const zone = status.zone;

    return (
        <div className="flex h-full min-h-0 flex-col">
            <div className="flex-1 min-h-0">
                {showTranscript && hasTranscriptContent ? (
                    <RollingTranscript
                        segments={transcriptSegments}
                        partialText={livePartial?.text}
                        partialSpeakerLabel={livePartial?.label}
                        displayMode={transcriptDisplayMode}
                        translationOn={translationEnabled}
                        onTranslateSegment={handleTranslateTranscriptSegment}
                    />
                ) : (
                    // The one place the audio status is spelled out when there are no rows to show (the header chip then shows only its dot).
                    <div className="h-full overflow-y-auto px-4 pt-3 pb-2 no-drag">
                        {!showTranscript ? (
                            <p className="text-xs leading-[17px] overlay-text-muted">The transcript is hidden.</p>
                        ) : (
                            zone && (
                                <>
                                    {zone.title && (
                                        <p className="flex items-center gap-1.5 text-sm font-medium leading-5 overlay-text-primary">
                                            <span aria-hidden="true" className={status.level === 'warn' ? 'text-state-warning' : 'text-state-danger'}>
                                                {status.level === 'warn' ? '▲' : '✕'}
                                            </span>
                                            {zone.title}
                                        </p>
                                    )}
                                    <p className="text-xs leading-[17px] overlay-text-muted">{zone.body}</p>
                                    {status.action === 'fix-audio' && (
                                        <button
                                            type="button"
                                            onClick={onFixAudio}
                                            className="mt-2 inline-flex h-7 items-center rounded-full bg-[var(--overlay-action)] px-3.5 text-xs font-semibold text-white hover:brightness-95"
                                        >
                                            Fix audio
                                        </button>
                                    )}
                                </>
                            )
                        )}
                    </div>
                )}
            </div>
        </div>
    );
};

export default TranscriptPanel;
