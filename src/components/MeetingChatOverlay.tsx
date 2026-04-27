import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport } from 'ai';
import { X, Copy, Check } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import pikaIcon from '../../assets/icon.png';
import { electronChatFetch } from '../lib/electronChatFetch';

import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';

interface MeetingContext {
    id?: string;
    title: string;
    summary?: string;
    keyPoints?: string[];
    actionItems?: string[];
    transcript?: Array<{ speaker: string; text: string; timestamp: number }>;
}

interface MeetingChatOverlayProps {
    isOpen: boolean;
    onClose: () => void;
    meetingContext: MeetingContext;
    initialQuery?: string;
    initialQueryKey?: number;
}

const getMessageText = (message: { parts?: Array<{ type: string; text?: string }> }) => {
    return message.parts
        ?.filter((part) => part.type === 'text')
        .map((part) => part.text ?? '')
        .join('') ?? '';
};

const TypingIndicator: React.FC = () => (
    <div className="flex items-center gap-1 py-4">
        <div className="flex items-center gap-1">
            {[0, 1, 2].map((i) => (
                <motion.div
                    key={i}
                    className="w-2 h-2 rounded-full bg-text-tertiary"
                    animate={{ opacity: [0.4, 1, 0.4] }}
                    transition={{
                        duration: 0.6,
                        repeat: Infinity,
                        delay: i * 0.15,
                        ease: 'easeInOut'
                    }}
                />
            ))}
        </div>
    </div>
);

const UserMessage: React.FC<{ content: string }> = ({ content }) => (
    <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.15 }}
        className="flex justify-end mb-6"
    >
        <div className="bg-accent-primary text-white px-5 py-3 rounded-2xl rounded-tr-md max-w-[70%] text-[15px] leading-relaxed">
            {content}
        </div>
    </motion.div>
);

const AssistantMessage: React.FC<{ content: string; isStreaming?: boolean }> = ({ content, isStreaming }) => {
    const [copied, setCopied] = useState(false);

    const handleCopy = async () => {
        try {
            await navigator.clipboard.writeText(content);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        } catch (err) {
            console.error('Failed to copy:', err);
        }
    };

    return (
        <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.15 }}
            className="flex flex-col items-start mb-6"
        >
            <div className="text-text-primary text-[15px] leading-relaxed max-w-[85%]">
                <div className="markdown-content">
                    <ReactMarkdown
                        remarkPlugins={[remarkGfm, remarkMath]}
                        rehypePlugins={[rehypeKatex]}
                        components={{
                            p: ({ node, ...props }: any) => <p className="mb-2 last:mb-0 whitespace-pre-wrap" {...props} />,
                            a: ({ node, ...props }: any) => <a className="text-blue-500 hover:underline" {...props} />,
                            pre: ({ children }: any) => <div className="not-prose mb-4">{children}</div>,
                            code: ({ node, inline, className, children, ...props }: any) => {
                                const match = /language-(\w+)/.exec(className || '');
                                const isInline = inline ?? false;
                                const lang = match ? match[1] : '';

                                return !isInline ? (
                                    <div className="my-3 rounded-xl overflow-hidden border border-white/[0.08] shadow-lg bg-zinc-800/60 backdrop-blur-md">
                                        <div className="bg-white/[0.04] px-3 py-1.5 border-b border-white/[0.08]">
                                            <span className="text-[10px] uppercase tracking-widest font-semibold text-white/40 font-mono">
                                                {lang || 'CODE'}
                                            </span>
                                        </div>
                                        <div className="bg-transparent">
                                            <SyntaxHighlighter
                                                language={lang || 'text'}
                                                style={vscDarkPlus}
                                                customStyle={{
                                                    margin: 0,
                                                    borderRadius: 0,
                                                    fontSize: '13px',
                                                    lineHeight: '1.6',
                                                    background: 'transparent',
                                                    padding: '16px',
                                                    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace'
                                                }}
                                                wrapLongLines={true}
                                                showLineNumbers={true}
                                                lineNumberStyle={{ minWidth: '2.5em', paddingRight: '1.2em', color: 'rgba(255,255,255,0.2)', textAlign: 'right', fontSize: '11px' }}
                                                {...props}
                                            >
                                                {String(children).replace(/\n$/, '')}
                                            </SyntaxHighlighter>
                                        </div>
                                    </div>
                                ) : (
                                    <code className="bg-bg-tertiary px-1.5 py-0.5 rounded text-[13px] font-mono text-text-primary border border-border-subtle whitespace-pre-wrap" {...props}>
                                        {children}
                                    </code>
                                );
                            },
                        }}
                    >
                        {content}
                    </ReactMarkdown>
                </div>
                {isStreaming && (
                    <motion.span
                        className="inline-block w-0.5 h-4 bg-text-secondary ml-0.5 align-middle"
                        animate={{ opacity: [1, 0] }}
                        transition={{ duration: 0.5, repeat: Infinity }}
                    />
                )}
            </div>
            {!isStreaming && content && (
                <button
                    onClick={handleCopy}
                    className="flex items-center gap-2 mt-3 text-[13px] text-text-tertiary hover:text-text-secondary transition-colors"
                >
                    {copied ? <Check size={14} className="text-emerald-500" /> : <Copy size={14} />}
                    {copied ? 'Copied' : 'Copy message'}
                </button>
            )}
        </motion.div>
    );
};

const MeetingChatOverlay: React.FC<MeetingChatOverlayProps> = ({
    isOpen,
    onClose,
    meetingContext,
    initialQuery = '',
    initialQueryKey = 0,
}) => {
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const chatWindowRef = useRef<HTMLDivElement>(null);
    const lastQueryRef = useRef<string>('');
    const [panelHeight, setPanelHeight] = useState(0.85); // fraction of viewport height
    const isDraggingRef = useRef(false);
    const dragStartYRef = useRef(0);
    const dragStartHeightRef = useRef(0);

    const {
        messages,
        sendMessage,
        regenerate,
        status,
        error,
        setMessages,
        stop,
    } = useChat({
        transport: new DefaultChatTransport({
            api: '/api/chat',
            fetch: electronChatFetch as typeof globalThis.fetch,
            body: { meetingId: meetingContext.id },
        }),
    });
    const [input, setInput] = useState('');
    const isLoading = status === 'submitted' || status === 'streaming';

    const handleFormSubmit = useCallback((e: React.FormEvent) => {
        e.preventDefault();
        if (!input.trim() || isLoading) return;
        const text = input.trim();
        setInput('');
        void sendMessage({ text });
    }, [input, isLoading, sendMessage]);

    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages, isLoading]);

    useEffect(() => {
        if (isOpen && initialQuery) {
            const queryToken = `${initialQueryKey}:${initialQuery}`;
            if (queryToken !== lastQueryRef.current) {
                lastQueryRef.current = queryToken;
                void sendMessage({ text: initialQuery });
            }
        }
    }, [isOpen, initialQuery, initialQueryKey, sendMessage]);

    useEffect(() => {
        if (!isOpen) {
            stop();
            setMessages([]);
            lastQueryRef.current = '';
        }
    }, [isOpen, setMessages, stop]);

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape' && isOpen) {
                handleClose();
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [isOpen]);

    const handleBackdropClick = useCallback((e: React.MouseEvent) => {
        if (e.target === e.currentTarget) {
            handleClose();
        }
    }, []);

    const handleClose = useCallback(() => {
        stop();
        onClose();
    }, [onClose, stop]);

    const handleDragStart = useCallback((e: React.MouseEvent) => {
        e.preventDefault();
        isDraggingRef.current = true;
        dragStartYRef.current = e.clientY;
        dragStartHeightRef.current = panelHeight;

        const onMouseMove = (moveEvent: MouseEvent) => {
            if (!isDraggingRef.current) return;
            const delta = dragStartYRef.current - moveEvent.clientY;
            const deltaFraction = delta / window.innerHeight;
            const newHeight = Math.min(0.95, Math.max(0.3, dragStartHeightRef.current + deltaFraction));
            setPanelHeight(newHeight);
        };

        const onMouseUp = () => {
            isDraggingRef.current = false;
            window.removeEventListener('mousemove', onMouseMove);
            window.removeEventListener('mouseup', onMouseUp);
        };

        window.addEventListener('mousemove', onMouseMove);
        window.addEventListener('mouseup', onMouseUp);
    }, [panelHeight]);

    return (
        <AnimatePresence>
            {isOpen && (
                <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.16 }}
                    className="absolute inset-0 z-40 flex flex-col justify-end"
                    onClick={handleBackdropClick}
                >
                    <motion.div
                        initial={{ backdropFilter: 'blur(0px)' }}
                        animate={{ backdropFilter: 'blur(8px)' }}
                        exit={{ backdropFilter: 'blur(0px)' }}
                        transition={{ duration: 0.16 }}
                        className="absolute inset-0 bg-black/40"
                    />

                    <motion.div
                        ref={chatWindowRef}
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: `${panelHeight * 100}vh`, opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{
                            height: isDraggingRef.current ? { duration: 0 } : { type: 'spring', stiffness: 300, damping: 30, mass: 0.8 },
                            opacity: { duration: 0.2 }
                        }}
                        className="relative mx-auto w-full max-w-[680px] mb-0 bg-bg-secondary rounded-t-[24px] border-t border-x border-border-subtle shadow-2xl overflow-hidden flex flex-col"
                        onClick={(e) => e.stopPropagation()}
                    >
                        {/* Drag handle */}
                        <div
                            onMouseDown={handleDragStart}
                            className="absolute top-0 left-0 right-0 h-5 flex items-center justify-center cursor-ns-resize z-10 group"
                        >
                            <div className="w-10 h-1 rounded-full bg-border-subtle group-hover:bg-text-tertiary transition-colors" />
                        </div>

                        <div className="flex items-center justify-between px-4 py-3 pt-5 border-b border-border-subtle shrink-0">
                            <div className="flex items-center gap-2">
                                <img src={pikaIcon} className="w-3.5 h-3.5 opacity-60 object-contain drop-shadow-sm" alt="logo" />
                                <span className="text-[13px] font-medium text-text-secondary">Search this meeting</span>
                            </div>
                            <button
                                onClick={handleClose}
                                className="p-2 transition-colors group"
                            >
                                <X size={16} className="text-text-tertiary group-hover:text-red-500 group-hover:drop-shadow-[0_0_8px_rgba(239,68,68,0.5)] transition-all duration-300" />
                            </button>
                        </div>

                        <div className="flex-1 overflow-y-auto px-6 py-4 pb-32 custom-scrollbar">
                            {messages.map((msg) => {
                                const content = getMessageText(msg);
                                return msg.role === 'user'
                                    ? <UserMessage key={msg.id} content={content} />
                                    : <AssistantMessage key={msg.id} content={content} isStreaming={isLoading && msg.id === messages[messages.length - 1]?.id} />;
                            })}

                            {isLoading && messages[messages.length - 1]?.role !== 'assistant' && <TypingIndicator />}

                            {error && (
                                <div className="text-[#FF6B6B] text-[13px] py-2 flex items-center gap-2">
                                    <span>Couldn't get a response.</span>
                                    <button onClick={() => void regenerate()} className="underline hover:text-red-400">Retry</button>
                                </div>
                            )}

                            <div ref={messagesEndRef} />
                        </div>

                        <div className="absolute bottom-0 left-0 right-0 px-4 py-3 border-t border-border-subtle bg-bg-secondary">
                            <form onSubmit={handleFormSubmit} className="flex gap-2">
                                <input
                                    type="text"
                                    value={input}
                                    onChange={(e) => setInput(e.target.value)}
                                    placeholder="Ask a follow-up question..."
                                    className="flex-1 bg-bg-input border border-border-subtle rounded-xl px-3 py-2 text-[14px] text-text-primary focus:outline-none focus:ring-1 focus:ring-accent-primary"
                                    autoFocus
                                />
                                <button
                                    type="submit"
                                    disabled={!input.trim() || isLoading}
                                    className="px-3 py-2 rounded-xl bg-accent-primary text-white text-[13px] font-medium disabled:opacity-50"
                                >
                                    Send
                                </button>
                            </form>
                        </div>
                    </motion.div>
                </motion.div>
            )}
        </AnimatePresence>
    );
};

export default MeetingChatOverlay;
