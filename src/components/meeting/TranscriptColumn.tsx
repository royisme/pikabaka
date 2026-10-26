import React from 'react';
import TranscriptPanel from './TranscriptPanel';
import type { TranscriptDisplayMode, TranscriptSegment } from '../../lib/transcriptSegments';
import type { getOverlayAppearance } from '../../lib/overlayAppearance';

interface TranscriptColumnProps {
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
    appearance: ReturnType<typeof getOverlayAppearance>;
    isLightTheme: boolean;
}

const TranscriptColumn: React.FC<TranscriptColumnProps> = ({
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
    return (
        <TranscriptPanel
            transcriptSegments={transcriptSegments}
            isInterviewerSpeaking={isInterviewerSpeaking}
            currentInterviewerPartial={currentInterviewerPartial}
            transcriptDisplayMode={transcriptDisplayMode}
            translationEnabled={translationEnabled}
            showTranscript={showTranscript}
            handleTranslateTranscriptSegment={handleTranslateTranscriptSegment}
            sttNeedsTroubleshooting={sttNeedsTroubleshooting}
            showSttErrorDetail={showSttErrorDetail}
            nativeAudioHealth={nativeAudioHealth}
            appearance={appearance}
            isLightTheme={isLightTheme}
        />
    );
};

export default TranscriptColumn;
