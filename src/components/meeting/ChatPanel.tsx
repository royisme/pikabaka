import React from 'react';
import type { ShortcutConfig } from '../../hooks/useShortcuts';
import {
  Pencil,
  MessageSquare,
  RefreshCw,
  HelpCircle,
  Lightbulb,
  ArrowRight,
  Zap,
  ChevronDown,
  SlidersHorizontal,
  PointerOff,
  Image,
  X,
  Copy,
  Code,
} from 'lucide-react';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneLight, vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';
import { NegotiationCoachingCard } from '../../premium';

interface Message {
  id: string;
  role: 'user' | 'system' | 'interviewer';
  text: string;
  isStreaming?: boolean;
  hasScreenshot?: boolean;
  screenshotPreview?: string;
  isCode?: boolean;
  intent?: string;
  isNegotiationCoaching?: boolean;
  negotiationCoachingData?: {
    tacticalNote: string;
    exactScript: string;
    showSilenceTimer: boolean;
    phase: string;
    theirOffer: number | null;
    yourTarget: number | null;
    currency: string;
  };
}

interface KnowledgeContext {
  matchedJDSignals: Array<{ requirement: string; relevance: number }>;
  resumeEvidence: Array<{ source: string; text: string }>;
  mustHitKeywords: string[];
  questionCategory: string;
}

interface ChatPanelProps {
  messages: Message[];
  knowledgeContext: KnowledgeContext | null;
  attachedContext: Array<{ path: string; preview: string }>;
  setAttachedContext: React.Dispatch<React.SetStateAction<Array<{ path: string; preview: string }>>>;
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
  isManualRecording: boolean;
  manualTranscript: string;
  voiceInput: string;
  appearance: any;
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

const ChatPanel: React.FC<ChatPanelProps> = ({
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
  const codeTheme = isLightTheme ? oneLight : vscDarkPlus;
  const codeLineNumberColor = isLightTheme ? 'rgba(15,23,42,0.35)' : 'rgba(255,255,255,0.2)';
  const subtleSurfaceClass = 'overlay-subtle-surface';
  const codeBlockClass = 'overlay-code-block-surface';
  const codeHeaderClass = 'overlay-code-header-surface';
  const codeHeaderTextClass = 'overlay-text-muted';
  const quickActionClass = 'overlay-chip-surface overlay-text-interactive hover:overlay-text-primary';
  const inputClass = `${isLightTheme ? 'focus:ring-black/10' : 'focus:ring-white/10'} overlay-input-surface overlay-input-text`;
  const controlSurfaceClass = 'overlay-control-surface overlay-text-interactive';

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text).catch(console.error);
  };

  const renderMessageText = (msg: Message) => {
    if (msg.isNegotiationCoaching && msg.negotiationCoachingData) {
      return (
        <NegotiationCoachingCard
          {...msg.negotiationCoachingData}
          phase={msg.negotiationCoachingData.phase as any}
          onSilenceTimerEnd={() => {
            setMessages(prev => prev.map(m =>
              m.id === msg.id
                ? { ...m, negotiationCoachingData: m.negotiationCoachingData ? { ...m.negotiationCoachingData, showSilenceTimer: false } : undefined }
                : m
            ));
          }}
        />
      );
    }

    if (msg.isCode || (msg.role === 'system' && msg.text.includes('```'))) {
      const parts = msg.text.split(/(```[\s\S]*?```)/g);
      return (
        <div className={`rounded-lg p-3 my-1 border ${subtleSurfaceClass}`} style={appearance.subtleStyle}>
          <div className={`flex items-center gap-2 mb-2 font-medium text-[11px] tracking-[0.02em] ${isLightTheme ? 'text-violet-600' : 'text-purple-300'}`}>
            <Code className="w-3.5 h-3.5" />
            <span>Code Solution</span>
          </div>
          <div className={`space-y-2 text-[13px] leading-relaxed ${isLightTheme ? 'text-slate-800' : 'text-slate-200'}`}>
            {parts.map((part, i) => {
              if (part.startsWith('```')) {
                const match = part.match(/```(\w+)?\n?([\s\S]*?)```/);
                if (match) {
                  const lang = match[1] || 'python';
                  const code = match[2].trim();
                  return (
                    <div key={i} className={`my-3 rounded-xl overflow-hidden border shadow-lg ${codeBlockClass}`} style={appearance.codeBlockStyle}>
                      <div className={`px-3 py-1.5 border-b ${codeHeaderClass}`} style={appearance.codeHeaderStyle}>
                        <span className={`text-[10px] tracking-[0.12em] font-medium font-mono ${codeHeaderTextClass}`}>
                          {lang || 'CODE'}
                        </span>
                      </div>
                      <div className="bg-transparent">
                        <SyntaxHighlighter
                          language={lang}
                          style={codeTheme}
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
                          lineNumberStyle={{ minWidth: '2.5em', paddingRight: '1.2em', color: codeLineNumberColor, textAlign: 'right', fontSize: '11px' }}
                        >
                          {code}
                        </SyntaxHighlighter>
                      </div>
                    </div>
                  );
                }
              }
              return (
                <div key={i} className="markdown-content">
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm, remarkMath]}
                    rehypePlugins={[rehypeKatex]}
                    components={{
                      p: ({ node, ...props }: any) => <p className="mb-2 last:mb-0 whitespace-pre-wrap" {...props} />,
                      strong: ({ node, ...props }: any) => <strong className="font-bold overlay-text-strong" {...props} />,
                      em: ({ node, ...props }: any) => <em className="italic overlay-text-secondary" {...props} />,
                      ul: ({ node, ...props }: any) => <ul className="list-disc ml-4 mb-2 space-y-1" {...props} />,
                      ol: ({ node, ...props }: any) => <ol className="list-decimal ml-4 mb-2 space-y-1" {...props} />,
                      li: ({ node, ...props }: any) => <li className="pl-1" {...props} />,
                      h1: ({ node, ...props }: any) => <h1 className="text-lg font-bold mb-2 mt-3 overlay-text-strong" {...props} />,
                      h2: ({ node, ...props }: any) => <h2 className="text-base font-bold mb-2 mt-3 overlay-text-strong" {...props} />,
                      h3: ({ node, ...props }: any) => <h3 className="text-sm font-bold mb-1 mt-2 overlay-text-primary" {...props} />,
                      code: ({ node, ...props }: any) => <code className={`overlay-inline-code-surface rounded px-1 py-0.5 text-xs font-mono whitespace-pre-wrap ${isLightTheme ? 'text-violet-700' : 'text-purple-200'}`} {...props} />,
                      blockquote: ({ node, ...props }: any) => <blockquote className={`border-l-2 pl-3 italic my-2 ${isLightTheme ? 'border-violet-500/30 text-slate-600' : 'border-purple-500/50 text-slate-400'}`} {...props} />,
                      a: ({ node, ...props }: any) => <a className={`hover:underline ${isLightTheme ? 'text-blue-600 hover:text-blue-700' : 'text-blue-400 hover:text-blue-300'}`} target="_blank" rel="noopener noreferrer" {...props} />,
                    }}
                  >
                    {part}
                  </ReactMarkdown>
                </div>
              );
            })}
          </div>
        </div>
      );
    }

    if (msg.intent === 'shorten') {
      return (
        <div className={`rounded-lg p-3 my-1 border ${subtleSurfaceClass}`} style={appearance.subtleStyle}>
          <div className={`flex items-center gap-2 mb-2 font-medium text-[11px] tracking-[0.02em] ${isLightTheme ? 'text-cyan-700' : 'text-cyan-300'}`}>
            <MessageSquare className="w-3.5 h-3.5" />
            <span>Shortened</span>
          </div>
          <div className={`text-[13px] leading-relaxed markdown-content ${isLightTheme ? 'text-slate-800' : 'text-slate-200'}`}>
            <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]} components={{
              p: ({ node, ...props }: any) => <p className="mb-2 last:mb-0" {...props} />,
              strong: ({ node, ...props }: any) => <strong className={`font-bold ${isLightTheme ? 'text-cyan-800' : 'text-cyan-100'}`} {...props} />,
              ul: ({ node, ...props }: any) => <ul className="list-disc ml-4 mb-2" {...props} />,
              li: ({ node, ...props }: any) => <li className="pl-1" {...props} />,
            }}>
              {msg.text}
            </ReactMarkdown>
          </div>
        </div>
      );
    }

    if (msg.intent === 'recap') {
      return (
        <div className={`rounded-lg p-3 my-1 border ${subtleSurfaceClass}`} style={appearance.subtleStyle}>
          <div className={`flex items-center gap-2 mb-2 font-medium text-[11px] tracking-[0.02em] ${isLightTheme ? 'text-indigo-700' : 'text-indigo-300'}`}>
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Recap</span>
          </div>
          <div className={`text-[13px] leading-relaxed markdown-content ${isLightTheme ? 'text-slate-800' : 'text-slate-200'}`}>
            <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]} components={{
              p: ({ node, ...props }: any) => <p className="mb-2 last:mb-0" {...props} />,
              strong: ({ node, ...props }: any) => <strong className={`font-bold ${isLightTheme ? 'text-indigo-800' : 'text-indigo-100'}`} {...props} />,
              ul: ({ node, ...props }: any) => <ul className="list-disc ml-4 mb-2" {...props} />,
              li: ({ node, ...props }: any) => <li className="pl-1" {...props} />,
            }}>
              {msg.text}
            </ReactMarkdown>
          </div>
        </div>
      );
    }

    if (msg.intent === 'follow_up_questions') {
      return (
        <div className={`rounded-lg p-3 my-1 border ${subtleSurfaceClass}`} style={appearance.subtleStyle}>
          <div className={`flex items-center gap-2 mb-2 font-medium text-[11px] tracking-[0.02em] ${isLightTheme ? 'text-amber-700' : 'text-[#FFD60A]'}`}>
            <HelpCircle className="w-3.5 h-3.5" />
            <span>Follow-Up Questions</span>
          </div>
          <div className={`text-[13px] leading-relaxed markdown-content ${isLightTheme ? 'text-slate-800' : 'text-slate-200'}`}>
            <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]} components={{
              p: ({ node, ...props }: any) => <p className="mb-2 last:mb-0" {...props} />,
              strong: ({ node, ...props }: any) => <strong className={`font-bold ${isLightTheme ? 'text-amber-800' : 'text-[#FFF9C4]'}`} {...props} />,
              ul: ({ node, ...props }: any) => <ul className="list-disc ml-4 mb-2" {...props} />,
              li: ({ node, ...props }: any) => <li className="pl-1" {...props} />,
            }}>
              {msg.text}
            </ReactMarkdown>
          </div>
        </div>
      );
    }

    if (msg.intent === 'what_to_answer') {
      const parts = msg.text.split(/(```[\s\S]*?(?:```|$))/g);

      return (
        <div className={`rounded-lg p-3 my-1 border ${subtleSurfaceClass}`} style={appearance.subtleStyle}>
          <div className="flex items-center gap-2 mb-2 text-emerald-400 font-medium text-[11px] tracking-[0.02em]">
            <span>Say this</span>
          </div>
          <div className="text-[14px] leading-relaxed overlay-text-primary">
            {parts.map((part, i) => {
              if (part.startsWith('```')) {
                const match = part.match(/```(\w*)\s+([\s\S]*?)(?:```|$)/);

                if (match || part.startsWith('```')) {
                  const lang = (match && match[1]) ? match[1] : 'python';
                  let code = '';

                  if (match && match[2]) {
                    code = match[2].trim();
                  } else {
                    code = part.replace(/^```\w*\s*/, '').replace(/```$/, '').trim();
                  }

                  return (
                    <div key={i} className={`my-3 rounded-xl overflow-hidden border shadow-lg ${codeBlockClass}`} style={appearance.codeBlockStyle}>
                      <div className={`px-3 py-1.5 border-b ${codeHeaderClass}`} style={appearance.codeHeaderStyle}>
                        <span className={`text-[10px] tracking-[0.12em] font-medium font-mono ${codeHeaderTextClass}`}>
                          {lang || 'CODE'}
                        </span>
                      </div>

                      <div className="bg-transparent">
                        <SyntaxHighlighter
                          language={lang}
                          style={codeTheme}
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
                          lineNumberStyle={{ minWidth: '2.5em', paddingRight: '1.2em', color: codeLineNumberColor, textAlign: 'right', fontSize: '11px' }}
                        >
                          {code}
                        </SyntaxHighlighter>
                      </div>
                    </div>
                  );
                }
              }
              return (
                <div key={i} className="markdown-content">
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm, remarkMath]}
                    rehypePlugins={[rehypeKatex]}
                    components={{
                      p: ({ node, ...props }: any) => <p className="mb-2 last:mb-0" {...props} />,
                      strong: ({ node, ...props }: any) => <strong className={`font-bold ${isLightTheme ? 'text-emerald-700' : 'text-emerald-100'}`} {...props} />,
                      em: ({ node, ...props }: any) => <em className={`italic ${isLightTheme ? 'text-emerald-700/80' : 'text-emerald-200/80'}`} {...props} />,
                      ul: ({ node, ...props }: any) => <ul className="list-disc ml-4 mb-2 space-y-1" {...props} />,
                      ol: ({ node, ...props }: any) => <ol className="list-decimal ml-4 mb-2 space-y-1" {...props} />,
                      li: ({ node, ...props }: any) => <li className="pl-1" {...props} />,
                    }}
                  >
                    {part}
                  </ReactMarkdown>
                </div>
              );
            })}
          </div>
        </div>
      );
    }

    return (
      <div className="markdown-content">
        <ReactMarkdown
          remarkPlugins={[remarkGfm, remarkMath]}
          rehypePlugins={[rehypeKatex]}
          components={{
            p: ({ node, ...props }: any) => <p className="mb-2 last:mb-0 whitespace-pre-wrap" {...props} />,
            strong: ({ node, ...props }: any) => <strong className="font-bold opacity-100 overlay-text-strong" {...props} />,
            em: ({ node, ...props }: any) => <em className="italic opacity-90 overlay-text-secondary" {...props} />,
            ul: ({ node, ...props }: any) => <ul className="list-disc ml-4 mb-2 space-y-1" {...props} />,
            ol: ({ node, ...props }: any) => <ol className="list-decimal ml-4 mb-2 space-y-1" {...props} />,
            li: ({ node, ...props }: any) => <li className="pl-1" {...props} />,
            code: ({ node, ...props }: any) => <code className={`overlay-inline-code-surface rounded px-1 py-0.5 text-xs font-mono ${isLightTheme ? 'text-slate-800' : ''}`} {...props} />,
            a: ({ node, ...props }: any) => <a className="underline hover:opacity-80" target="_blank" rel="noopener noreferrer" {...props} />,
          }}
        >
          {msg.text}
        </ReactMarkdown>
      </div>
    );
  };

  return (
    <div className="flex flex-col h-full">
      <div
        ref={scrollContainerRef}
        className="flex-1 overflow-y-auto px-4 py-3.5 space-y-2.5 no-drag"
        style={{ scrollbarWidth: 'none' }}
      >
        {messages.map((msg) => (
          <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'} animate-fade-in-up`}>
            <div className={`
              ${msg.role === 'user' ? 'max-w-[72.25%] px-[13.6px] py-[10.2px]' : 'max-w-[85%] px-4 py-2.5'} text-[14px] leading-6 relative group whitespace-pre-wrap
              ${msg.role === 'user'
                ? (isLightTheme
                  ? 'bg-blue-500/12 border border-blue-500/25 text-blue-950 rounded-[20px] rounded-tr-[4px] shadow-sm font-medium'
                  : 'bg-blue-500/18 border border-blue-400/30 text-blue-50 rounded-[20px] rounded-tr-[4px] shadow-sm font-medium')
                : ''
              }
              ${msg.role === 'system' ? 'overlay-text-primary font-normal' : ''}
              ${msg.role === 'interviewer' ? 'overlay-text-muted italic pl-0 text-[13px]' : ''}
            `}>
              {msg.role === 'interviewer' && (
                <div className="flex items-center gap-1.5 mb-1 text-[10px] font-medium tracking-[0.08em] overlay-text-muted/90">
                  Interviewer
                  {msg.isStreaming && <span className="w-1 h-1 bg-green-500 rounded-full animate-pulse" />}
                </div>
              )}
              {msg.role === 'user' && msg.hasScreenshot && (
                <div className={`flex items-center gap-1 text-[10px] opacity-70 mb-1 border-b pb-1 ${isLightTheme ? 'border-black/10' : 'border-white/10'}`}>
                  <Image className="w-2.5 h-2.5" />
                  <span>Screenshot attached</span>
                </div>
              )}
              {msg.role === 'system' && !msg.isStreaming && (
                <button
                  onClick={() => handleCopy(msg.text)}
                  className="absolute top-2 right-2 p-1.5 rounded-md opacity-0 group-hover:opacity-100 transition-opacity overlay-icon-surface overlay-icon-surface-hover overlay-text-interactive"
                  title="Copy to clipboard"
                  style={appearance.iconStyle}
                >
                  <Copy className="w-3.5 h-3.5" />
                </button>
              )}
              {renderMessageText(msg)}
            </div>
          </div>
        ))}

        {isManualRecording && (
          <div className="flex flex-col items-end gap-1 animate-in fade-in slide-in-from-bottom-2 duration-300">
            {(manualTranscript || voiceInput) && (
              <div className="max-w-[85%] px-3.5 py-2.5 bg-emerald-500/10 border border-emerald-500/20 rounded-[18px] rounded-tr-[4px]">
                <span className="text-[13px] text-emerald-300">
                  {voiceInput}{voiceInput && manualTranscript ? ' ' : ''}{manualTranscript}
                </span>
              </div>
            )}
            <div className="px-3 py-2 flex gap-1.5 items-center">
              <div className="w-2 h-2 bg-emerald-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
              <div className="w-2 h-2 bg-emerald-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
              <div className="w-2 h-2 bg-emerald-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
              <span className="text-[10px] text-emerald-400/70 ml-1">Listening...</span>
            </div>
          </div>
        )}

        {isProcessing && (
          <div className="flex justify-start">
            <div className="px-3 py-2 flex gap-1.5">
              <div className="w-2 h-2 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
              <div className="w-2 h-2 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
              <div className="w-2 h-2 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
            </div>
          </div>
        )}

        {knowledgeContext && knowledgeContext.matchedJDSignals.length > 0 && (
          <div className="mx-3 mb-2 p-3.5 rounded-2xl border border-white/12 bg-[rgba(10,14,28,0.82)] shadow-[0_10px_28px_rgba(0,0,0,0.18)]">
            <div className="flex items-center gap-1.5 mb-2">
              <span className="text-[10px] font-semibold text-blue-100/90 tracking-[0.08em]">Role focus</span>
            </div>
            <div className="space-y-1.5">
              {knowledgeContext.matchedJDSignals.slice(0, 5).map((sig, i) => (
                <div key={i} className="flex items-center gap-2.5">
                  <div className="w-1.5 h-1.5 rounded-full shrink-0 bg-blue-300" />
                  <span className="text-[11.5px] text-white/88 leading-relaxed">{sig.requirement}</span>
                  <div className="ml-auto w-8 h-1.5 rounded-full bg-white/10 overflow-hidden shrink-0">
                    <div className="h-full rounded-full bg-blue-300" style={{ width: `${Math.round(sig.relevance * 100)}%` }} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {knowledgeContext && (knowledgeContext.mustHitKeywords.length > 0 || knowledgeContext.resumeEvidence.length > 0) && (
          <div className="mx-3 mb-3 p-3.5 rounded-2xl border border-white/12 bg-[rgba(10,14,28,0.88)] shadow-[0_10px_28px_rgba(0,0,0,0.2)]">
            {knowledgeContext.mustHitKeywords.length > 0 && (
              <div className="mb-3">
                <span className="text-[10px] font-semibold text-blue-100/90 tracking-[0.08em]">Language to weave in</span>
                <div className="flex flex-wrap gap-1.5 mt-1.5">
                  {knowledgeContext.mustHitKeywords.slice(0, 8).map((kw, i) => (
                    <span key={i} className="text-[10.5px] font-medium text-blue-50 px-2 py-1 rounded-md bg-blue-400/16 border border-blue-300/20">
                      {kw}
                    </span>
                  ))}
                </div>
              </div>
            )}
            {knowledgeContext.resumeEvidence.length > 0 && (
              <div>
                <span className="text-[10px] font-semibold text-emerald-100/90 tracking-[0.08em]">Good examples to mention</span>
                <div className="space-y-1.5 mt-1.5">
                  {knowledgeContext.resumeEvidence.slice(0, 3).map((ev, i) => (
                    <div key={i} className="text-[11px] leading-relaxed text-white/80">
                      <span className="font-semibold text-emerald-200">{ev.source}:</span> {ev.text.slice(0, 100)}{ev.text.length > 100 ? '...' : ''}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      <div className="flex flex-nowrap justify-center items-center gap-1.5 px-4 pb-3 overflow-x-auto no-scrollbar pt-3.5 no-drag">
        <button onClick={handleWhatToSay} className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-full text-[10.5px] font-medium border border-border-subtle/55 transition-colors active:scale-95 duration-200 interaction-base interaction-press whitespace-nowrap shrink-0 ${quickActionClass}`} style={appearance.chipStyle}>
          <Pencil className="w-3 h-3 opacity-65" /> Guide me
        </button>
        <button onClick={handleClarify} className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-full text-[10.5px] font-medium border border-border-subtle/55 transition-colors active:scale-95 duration-200 interaction-base interaction-press whitespace-nowrap shrink-0 ${quickActionClass}`} style={appearance.chipStyle}>
          <MessageSquare className="w-3 h-3 opacity-65" /> Clarify
        </button>
        <button onClick={actionButtonMode === 'brainstorm' ? handleBrainstorm : handleRecap} className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-full text-[10.5px] font-medium border border-border-subtle/55 transition-colors active:scale-95 duration-200 interaction-base interaction-press whitespace-nowrap shrink-0 ${quickActionClass}`} style={appearance.chipStyle}>
          {actionButtonMode === 'brainstorm'
            ? <><Lightbulb className="w-3 h-3 opacity-65" /> Ideas</>
            : <><RefreshCw className="w-3 h-3 opacity-65" /> Recap</>
          }
        </button>
        <button onClick={handleFollowUpQuestions} className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-full text-[10.5px] font-medium border border-border-subtle/55 transition-colors active:scale-95 duration-200 interaction-base interaction-press whitespace-nowrap shrink-0 ${quickActionClass}`} style={appearance.chipStyle}>
          <HelpCircle className="w-3 h-3 opacity-65" /> Follow-up
        </button>
        <button
          onClick={handleAnswerNow}
          className={`flex items-center justify-center gap-1.5 px-3.5 py-1.5 rounded-full text-[10.5px] font-semibold transition-colors active:scale-95 duration-200 interaction-base interaction-press min-w-[84px] whitespace-nowrap shrink-0 ${isManualRecording
            ? 'bg-red-500/10 text-red-300 ring-1 ring-red-400/20'
            : 'bg-[#007AFF] text-white shadow-[0_4px_14px_rgba(0,122,255,0.18)] hover:bg-[#0071E3]'
          }`}
        >
          {isManualRecording ? (
            <>
              <div className="w-1.5 h-1.5 rounded-full bg-red-400 animate-pulse" />
              Stop
            </>
          ) : (
            <><Zap className="w-3 h-3 opacity-75" /> Answer</>
          )}
        </button>
      </div>

      <div className="p-3 pt-0 no-drag">
        {attachedContext.length > 0 && (
          <div className={`mb-2 rounded-lg p-2 transition-all duration-200 border ${subtleSurfaceClass}`} style={appearance.subtleStyle}>
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[11px] font-medium overlay-text-primary">
                {attachedContext.length} screenshot{attachedContext.length > 1 ? 's' : ''} attached
              </span>
              <button
                onClick={() => setAttachedContext([])}
                className="p-1 rounded-full transition-colors overlay-icon-surface overlay-icon-surface-hover overlay-text-interactive"
                title="Remove all"
                style={appearance.iconStyle}
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
            <div className="flex gap-1.5 overflow-x-auto max-w-full pb-1">
              {attachedContext.map((ctx, idx) => (
                <div key={ctx.path} className="relative group/thumb flex-shrink-0">
                  <img
                    src={ctx.preview}
                    alt={`Screenshot ${idx + 1}`}
                    className={`h-10 w-auto rounded border ${isLightTheme ? 'border-black/15' : 'border-white/20'}`}
                  />
                  <button
                    onClick={() => setAttachedContext(prev => prev.filter((_, i) => i !== idx))}
                    className="absolute -top-1 -right-1 w-4 h-4 bg-red-500/80 hover:bg-red-500 rounded-full flex items-center justify-center opacity-0 group-hover/thumb:opacity-100 transition-opacity"
                    title="Remove"
                  >
                    <X className="w-2.5 h-2.5 text-white" />
                  </button>
                </div>
              ))}
            </div>
            <span className="text-[10px] overlay-text-muted">Ask a question or click Answer</span>
          </div>
        )}

        <div className="relative group">
          <input
            ref={textInputRef}
            type="text"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleManualSubmit()}
            className={`w-full border focus:ring-1 rounded-xl pl-3 pr-10 py-2.5 focus:outline-none transition-all duration-200 ease-sculpted text-[13px] leading-relaxed ${inputClass}`}
            style={appearance.inputStyle}
          />

          {!inputValue && (
            <div className="absolute left-3 top-1/2 -translate-y-1/2 flex items-center gap-1.5 pointer-events-none text-[12px] overlay-text-muted/90 max-w-[calc(100%-56px)] overflow-hidden whitespace-nowrap text-ellipsis">
              <span>Ask anything on screen or conversation, or</span>
              <div className="flex items-center gap-1 opacity-80">
                {(shortcuts.selectiveScreenshot || ['⌘', 'Shift', 'H']).map((key, i) => (
                  <React.Fragment key={i}>
                    {i > 0 && <span className="text-[10px]">+</span>}
                    <kbd className="px-1.5 py-0.5 rounded border text-[10px] font-sans min-w-[20px] text-center overlay-control-surface overlay-text-secondary" style={appearance.controlStyle}>{key}</kbd>
                  </React.Fragment>
                ))}
              </div>
              <span>for selective screenshot</span>
            </div>
          )}

          {!inputValue && (
            <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-1 pointer-events-none opacity-20">
              <span className="text-[10px]">↵</span>
            </div>
          )}
        </div>

        <div className="flex items-center justify-between mt-3 px-0.5">
          <div className="flex items-center gap-1.5">
            <button
              onClick={(e) => {
                if (!contentRef.current) return;
                const contentRect = contentRef.current.getBoundingClientRect();
                const buttonRect = e.currentTarget.getBoundingClientRect();
                const GAP = 8;

                const x = window.screenX + buttonRect.left;
                const y = window.screenY + contentRect.bottom + GAP;

                window.electronAPI.toggleModelSelector({ x, y });
              }}
              className={`
                flex items-center gap-2 px-3 py-1.5
                border border-border-subtle/60 rounded-lg transition-colors
                text-xs font-medium w-[140px]
                interaction-base interaction-press
                ${controlSurfaceClass}
              `}
              style={appearance.controlStyle}
            >
              <span className="truncate min-w-0 flex-1">
                {(() => {
                  const m = currentModel;
                  if (m.startsWith('ollama-')) return m.replace('ollama-', '');
                  if (m === 'gemini-3.1-flash-lite-preview') return 'Gemini 3.1 Flash';
                  if (m === 'gemini-3.1-pro-preview') return 'Gemini 3.1 Pro';
                  if (m === 'llama-3.3-70b-versatile') return 'Groq Llama 3.3';
                  if (m === 'gpt-5.4') return 'GPT 5.4';
                  if (m === 'claude-sonnet-4-6') return 'Sonnet 4.6';
                  return m;
                })()}
              </span>
              <ChevronDown size={14} className="shrink-0 transition-transform" />
            </button>

            <div className="w-px h-3 mx-1" style={appearance.dividerStyle} />

            <div className="relative">
              <button
                onClick={(e) => {
                  if (isSettingsOpen) {
                    window.electronAPI.toggleSettingsWindow();
                    return;
                  }

                  if (!contentRef.current) return;

                  const contentRect = contentRef.current.getBoundingClientRect();
                  const buttonRect = e.currentTarget.getBoundingClientRect();
                  const GAP = 8;

                  const x = window.screenX + buttonRect.left;
                  const y = window.screenY + contentRect.bottom + GAP;

                  window.electronAPI.toggleSettingsWindow({ x, y });
                }}
                className={`
                  w-7 h-7 flex items-center justify-center rounded-lg
                  interaction-base interaction-press
                  ${isSettingsOpen
                    ? 'overlay-icon-surface overlay-icon-surface-hover overlay-text-primary'
                    : 'overlay-icon-surface overlay-icon-surface-hover overlay-text-interactive'}
                `}
                style={appearance.iconStyle}
              >
                <SlidersHorizontal className="w-3.5 h-3.5" />
              </button>
            </div>

            <div className="w-px h-3 mx-1" style={appearance.dividerStyle} />

            <div className="relative">
              <button
                onClick={() => {
                  const newState = !isMousePassthrough;
                  setIsMousePassthrough(newState);
                  window.electronAPI?.setOverlayMousePassthrough?.(newState);
                }}
                className={`
                  w-7 h-7 flex items-center justify-center rounded-lg
                  interaction-base interaction-press
                  ${isMousePassthrough
                    ? 'overlay-icon-surface overlay-icon-surface-hover text-sky-400 opacity-100'
                    : 'overlay-icon-surface overlay-icon-surface-hover overlay-text-interactive'}
                `}
                style={appearance.iconStyle}
              >
                <PointerOff className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          <button
            onClick={handleManualSubmit}
            disabled={!inputValue.trim()}
            className={`
              w-7 h-7 rounded-full flex items-center justify-center
              interaction-base interaction-press
              ${inputValue.trim()
                ? 'bg-[#007AFF] text-white shadow-lg shadow-blue-500/20 hover:bg-[#0071E3]'
                : 'overlay-icon-surface overlay-text-muted cursor-not-allowed'
              }
            `}
            style={inputValue.trim() ? undefined : appearance.iconStyle}
          >
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
};

export default ChatPanel;
