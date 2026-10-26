import React from 'react';
import ChatPanel from './ChatPanel';
import type { ShortcutConfig } from '../../hooks/useShortcuts';
import type { Message } from '../../hooks/useMeetingChat';
import type { getOverlayAppearance } from '../../lib/overlayAppearance';
import type { AudioStatusKey } from '../../lib/audioStatus';

type KnowledgeContext = {
    matchedJDSignals: Array<{ requirement: string; relevance: number }>;
    resumeEvidence: Array<{ source: string; text: string }>;
    mustHitKeywords: string[];
    questionCategory: string;
};

type AttachedContext = Array<{ path: string; preview: string }>;

interface ChatColumnProps {
    messages: Message[];
    knowledgeContext: KnowledgeContext | null;
    attachedContext: AttachedContext;
    setAttachedContext: React.Dispatch<React.SetStateAction<AttachedContext>>;
    actionButtonMode: 'recap' | 'brainstorm';
    inputValue: string;
    setInputValue: React.Dispatch<React.SetStateAction<string>>;
    isProcessing: boolean;
    handleWhatToSay: () => void;
    primaryQuiet?: boolean;
    onStop?: () => void;
    onRetry?: () => void;
    audioKey?: AudioStatusKey;
    handleClarify: () => void;
    handleFollowUpQuestions: () => void;
    handleRecap: () => void;
    handleBrainstorm: () => void;
    handleManualSubmit: () => void;
    appearance: ReturnType<typeof getOverlayAppearance>;
    isLightTheme: boolean;
    shortcuts: ShortcutConfig;
    scrollContainerRef: React.RefObject<HTMLDivElement>;
    textInputRef: React.RefObject<HTMLInputElement>;
    setMessages: React.Dispatch<React.SetStateAction<Message[]>>;
}

const ChatColumn: React.FC<ChatColumnProps> = ({
    messages,
    knowledgeContext,
    attachedContext,
    setAttachedContext,
    actionButtonMode,
    inputValue,
    setInputValue,
    isProcessing,
    handleWhatToSay,
    primaryQuiet,
    onStop,
    onRetry,
    audioKey,
    handleClarify,
    handleFollowUpQuestions,
    handleRecap,
    handleBrainstorm,
    handleManualSubmit,
    appearance,
    isLightTheme,
    shortcuts,
    scrollContainerRef,
    textInputRef,
    setMessages,
}) => {
    return (
        <ChatPanel
            messages={messages}
            knowledgeContext={knowledgeContext}
            attachedContext={attachedContext}
            setAttachedContext={setAttachedContext}
            actionButtonMode={actionButtonMode}
            inputValue={inputValue}
            setInputValue={setInputValue}
            isProcessing={isProcessing}
            handleWhatToSay={handleWhatToSay}
            primaryQuiet={primaryQuiet}
            onStop={onStop}
            onRetry={onRetry}
            audioKey={audioKey}
            handleClarify={handleClarify}
            handleFollowUpQuestions={handleFollowUpQuestions}
            handleRecap={handleRecap}
            handleBrainstorm={handleBrainstorm}
            handleManualSubmit={handleManualSubmit}
            appearance={appearance}
            isLightTheme={isLightTheme}
            shortcuts={shortcuts}
            scrollContainerRef={scrollContainerRef}
            textInputRef={textInputRef}
            setMessages={setMessages}
        />
    );
};

export default ChatColumn;
