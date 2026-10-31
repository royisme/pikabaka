import React from 'react';
import TranscriptPanel from './TranscriptPanel';
import type { TranscriptDisplayMode, TranscriptSegment } from '../../lib/transcriptSegments';
import type { AudioStatus } from '../../lib/audioStatus';

interface TranscriptColumnProps {
    transcriptSegments: TranscriptSegment[];
    livePartial: { label: string; text: string } | null;
    transcriptDisplayMode: TranscriptDisplayMode;
    translationEnabled: boolean;
    showTranscript: boolean;
    handleTranslateTranscriptSegment: (segment: TranscriptSegment) => void;
    status: AudioStatus;
    onFixAudio: () => void;
}

const TranscriptColumn: React.FC<TranscriptColumnProps> = ({
    transcriptSegments,
    livePartial,
    transcriptDisplayMode,
    translationEnabled,
    showTranscript,
    handleTranslateTranscriptSegment,
    status,
    onFixAudio,
}) => {
    return (
        <TranscriptPanel
            transcriptSegments={transcriptSegments}
            livePartial={livePartial}
            transcriptDisplayMode={transcriptDisplayMode}
            translationEnabled={translationEnabled}
            showTranscript={showTranscript}
            handleTranslateTranscriptSegment={handleTranslateTranscriptSegment}
            status={status}
            onFixAudio={onFixAudio}
        />
    );
};

export default TranscriptColumn;
