import React from 'react';
import ChatPanel from './ChatPanel';
import type { ShortcutConfig } from '../../hooks/useShortcuts';
import type { Message } from '../../hooks/useMeetingChat';
import type { getOverlayAppearance } from '../../lib/overlayAppearance';

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
    handleClarify: () => void;
    handleFollowUpQuestions: () => void;
    handleRecap: () => void;
    handleBrainstorm: () => void;
    handleAnswerNow: () => void;
    handleManualSubmit: () => void;
    handlePasteImage: () => void;
    isManualRecording: boolean;
    manualTranscript: string;
    voiceInput: string;
    appearance: ReturnType<typeof getOverlayAppearance>;
    isLightTheme: boolean;
    currentModel: string;
    isSettingsOpen: boolean;
    isMousePassthrough: boolean;
    setIsMousePassthrough: (value: boolean) => void;
    shortcuts: ShortcutConfig;
    scrollContainerRef: React.RefObject<HTMLDivElement>;
    messagesEndRef: React.RefObject<HTMLDivElement>;
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
    handleClarify,
    handleFollowUpQuestions,
    handleRecap,
    handleBrainstorm,
    handleAnswerNow,
    handleManualSubmit,
    handlePasteImage,
    isManualRecording,
    manualTranscript,
    voiceInput,
    appearance,
    isLightTheme,
    currentModel,
    isSettingsOpen,
    isMousePassthrough,
    setIsMousePassthrough,
    shortcuts,
    scrollContainerRef,
    messagesEndRef,
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
            handleClarify={handleClarify}
            handleFollowUpQuestions={handleFollowUpQuestions}
            handleRecap={handleRecap}
            handleBrainstorm={handleBrainstorm}
            handleAnswerNow={handleAnswerNow}
            handleManualSubmit={handleManualSubmit}
            handlePasteImage={handlePasteImage}
            isManualRecording={isManualRecording}
            manualTranscript={manualTranscript}
            voiceInput={voiceInput}
            appearance={appearance}
            isLightTheme={isLightTheme}
            currentModel={currentModel}
            isSettingsOpen={isSettingsOpen}
            isMousePassthrough={isMousePassthrough}
            setIsMousePassthrough={setIsMousePassthrough}
            shortcuts={shortcuts}
            scrollContainerRef={scrollContainerRef}
            messagesEndRef={messagesEndRef}
            textInputRef={textInputRef}
            contentRef={contentRef}
            setMessages={setMessages}
        />
    );
};

export default ChatColumn;
