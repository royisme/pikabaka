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
    audioKey?: AudioStatusKey;
    handleClarify: () => void;
    handleFollowUpQuestions: () => void;
    handleRecap: () => void;
    handleBrainstorm: () => void;
    handleManualSubmit: () => void;
    appearance: ReturnType<typeof getOverlayAppearance>;
    isLightTheme: boolean;
    currentModel: string;
    isSettingsOpen: boolean;
    isMousePassthrough: boolean;
    setIsMousePassthrough: (value: boolean) => void;
    shortcuts: ShortcutConfig;
    scrollContainerRef: React.RefObject<HTMLDivElement>;
    textInputRef: React.RefObject<HTMLInputElement>;
    contentRef: React.RefObject<HTMLDivElement>;
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
    audioKey,
    handleClarify,
    handleFollowUpQuestions,
    handleRecap,
    handleBrainstorm,
    handleManualSubmit,
    appearance,
    isLightTheme,
    currentModel,
    isSettingsOpen,
    isMousePassthrough,
    setIsMousePassthrough,
    shortcuts,
    scrollContainerRef,
    textInputRef,
    contentRef,
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
            audioKey={audioKey}
            handleClarify={handleClarify}
            handleFollowUpQuestions={handleFollowUpQuestions}
            handleRecap={handleRecap}
            handleBrainstorm={handleBrainstorm}
            handleManualSubmit={handleManualSubmit}
            appearance={appearance}
            isLightTheme={isLightTheme}
            currentModel={currentModel}
            isSettingsOpen={isSettingsOpen}
            isMousePassthrough={isMousePassthrough}
            setIsMousePassthrough={setIsMousePassthrough}
            shortcuts={shortcuts}
            scrollContainerRef={scrollContainerRef}
            textInputRef={textInputRef}
            contentRef={contentRef}
            setMessages={setMessages}
        />
    );
};

export default ChatColumn;
