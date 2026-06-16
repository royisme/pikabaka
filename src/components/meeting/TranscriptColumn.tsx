import React from 'react';
import TranscriptPanel from './TranscriptPanel';
import type { TranscriptDisplayMode, TranscriptSegment } from '../../lib/transcriptSegments';
import type { getOverlayAppearance } from '../../lib/overlayAppearance';

interface TranscriptColumnProps {
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
    appearance: ReturnType<typeof getOverlayAppearance>;
    isLightTheme: boolean;
}

const TranscriptColumn: React.FC<TranscriptColumnProps> = ({
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
    return (
        <TranscriptPanel
            transcriptSegments={transcriptSegments}
            isInterviewerSpeaking={isInterviewerSpeaking}
            currentInterviewerPartial={currentInterviewerPartial}
            isUserSpeaking={isUserSpeaking}
            currentUserPartial={currentUserPartial}
            transcriptDisplayMode={transcriptDisplayMode}
            showTranscript={showTranscript}
            handleTranslateTranscriptSegment={handleTranslateTranscriptSegment}
            sttStatus={sttStatus}
            sttNeedsTroubleshooting={sttNeedsTroubleshooting}
            showSttErrorDetail={showSttErrorDetail}
            sttTroubleshootingMessage={sttTroubleshootingMessage}
            nativeAudioHealth={nativeAudioHealth}
            appearance={appearance}
            isLightTheme={isLightTheme}
        />
    );
};

export default TranscriptColumn;
