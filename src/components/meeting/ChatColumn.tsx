import React from 'react';
import ChatPanel from './ChatPanel';
import type { ShortcutConfig } from '../../hooks/useShortcuts';
import type { Message } from '../../hooks/useMeetingChat';
import type { getOverlayAppearance } from '../../lib/overlayAppearance';
import type { AudioStatusKey } from '../../lib/audioStatus';

type AttachedContext = Array<{ path: string; preview: string }>;

interface ChatColumnProps {
    /** Take a screenshot of the whole screen, or of an area, and attach it to the next question. */
    onCaptureScreen?: () => void;
    onCaptureArea?: () => void;
    messages: Message[];
    attachedContext: AttachedContext;
    setAttachedContext: React.Dispatch<React.SetStateAction<AttachedContext>>;
    inputValue: string;
    setInputValue: React.Dispatch<React.SetStateAction<string>>;
    isProcessing: boolean;
    handleReply: () => void;
    primaryQuiet?: boolean;
    onStop?: () => void;
    onRetry?: () => void;
    audioKey?: AudioStatusKey;
    hasTranscriptRows?: boolean;
    handleAsk: () => void;
    handleCatchUp: () => void;
    handleManualSubmit: () => void;
    appearance: ReturnType<typeof getOverlayAppearance>;
    isLightTheme: boolean;
    shortcuts: ShortcutConfig;
    scrollContainerRef: React.RefObject<HTMLDivElement | null>;
    textInputRef: React.RefObject<HTMLInputElement | null>;
}

const ChatColumn: React.FC<ChatColumnProps> = ({
    onCaptureScreen,
    onCaptureArea,
    messages,
    attachedContext,
    setAttachedContext,
    inputValue,
    setInputValue,
    isProcessing,
    handleReply,
    primaryQuiet,
    onStop,
    onRetry,
    audioKey,
    hasTranscriptRows,
    handleAsk,
    handleCatchUp,
    handleManualSubmit,
    appearance,
    isLightTheme,
    shortcuts,
    scrollContainerRef,
    textInputRef,
}) => {
    return (
        <ChatPanel
            messages={messages}
            onCaptureScreen={onCaptureScreen}
            onCaptureArea={onCaptureArea}
            attachedContext={attachedContext}
            setAttachedContext={setAttachedContext}
            inputValue={inputValue}
            setInputValue={setInputValue}
            isProcessing={isProcessing}
            handleReply={handleReply}
            primaryQuiet={primaryQuiet}
            onStop={onStop}
            onRetry={onRetry}
            audioKey={audioKey}
            hasTranscriptRows={hasTranscriptRows}
            handleAsk={handleAsk}
            handleCatchUp={handleCatchUp}
            handleManualSubmit={handleManualSubmit}
            appearance={appearance}
            isLightTheme={isLightTheme}
            shortcuts={shortcuts}
            scrollContainerRef={scrollContainerRef}
            textInputRef={textInputRef}
        />
    );
};

export default ChatColumn;
