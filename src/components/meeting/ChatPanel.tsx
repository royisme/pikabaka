import React from 'react';
import type { ShortcutConfig } from '../../hooks/useShortcuts';
import { KeyBadge } from '../ui/KeyBadge';
import { answerEmptyHint } from '../../lib/answerEmpty';
import { splitLead } from '../../lib/answerLead';
import type { AudioStatusKey } from '../../lib/audioStatus';
import {
  MessageSquare,
  RefreshCw,
  HelpCircle,
  Lightbulb,
  ArrowRight,
  Zap,
  Square,
  Image,
  X,
  Copy,
  Code,
  Monitor,
  Crop,
} from 'lucide-react';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneLight, vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';

interface Message {
  id: string;
  role: 'user' | 'system' | 'them';
  text: string;
  isStreaming?: boolean;
  isError?: boolean;
  /** What the other party said last, for the "Re:" line of a what-to-say answer. */
  replyTo?: string;
  hasScreenshot?: boolean;
  screenshotPreview?: string;
  isCode?: boolean;
  intent?: string;
}

interface ChatPanelProps {
  onCaptureScreen?: () => void;
  onCaptureArea?: () => void;
  messages: Message[];
  attachedContext: Array<{ path: string; preview: string }>;
  setAttachedContext: React.Dispatch<React.SetStateAction<Array<{ path: string; preview: string }>>>;
  actionButtonMode: 'recap' | 'brainstorm';
  inputValue: string;
  setInputValue: React.Dispatch<React.SetStateAction<string>>;
  isProcessing: boolean;
  handleWhatToSay: () => void;
  /** Stops the answer being produced; the primary button becomes this while one is. */
  onStop?: () => void;
  /** Asks again what was asked last. */
  onRetry?: () => void;
  /** Which audio state the empty answer area should speak for. */
  audioKey?: AudioStatusKey;
  /** The transcript has lines: an empty answer area must not say the other party's words are missing. */
  hasTranscriptRows?: boolean;
  /** True when something else is the one thing to do (fix the audio): What to say stays available but quiet. */
  primaryQuiet?: boolean;
  handleClarify: () => void;
  handleFollowUpQuestions: () => void;
  handleRecap: () => void;
  handleBrainstorm: () => void;
  handleManualSubmit: () => void;
  appearance: any;
  isLightTheme: boolean;
  shortcuts: ShortcutConfig;
  scrollContainerRef: React.RefObject<HTMLDivElement>;
  textInputRef: React.RefObject<HTMLInputElement>;
}

const ChatPanel: React.FC<ChatPanelProps> = ({
  onCaptureScreen,
  onCaptureArea,
  messages,
  attachedContext,
  setAttachedContext,
  actionButtonMode,
  inputValue,
  setInputValue,
  isProcessing,
  handleWhatToSay,
  onStop,
  onRetry,
  audioKey = 'off',
  hasTranscriptRows = false,
  primaryQuiet = false,
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
}) => {
  const codeTheme = isLightTheme ? oneLight : vscDarkPlus;
  const codeLineNumberColor = isLightTheme ? 'rgba(15,23,42,0.35)' : 'rgba(255,255,255,0.2)';
  const subtleSurfaceClass = 'overlay-subtle-surface';
  const codeBlockClass = 'overlay-code-block-surface';
  const codeHeaderClass = 'overlay-code-header-surface';
  const codeHeaderTextClass = 'overlay-text-muted';
  const quickActionClass = 'overlay-chip-surface overlay-text-interactive hover:text-[var(--overlay-text-primary)]';
  const inputClass = `${isLightTheme ? 'focus:ring-black/10' : 'focus:ring-white/10'} overlay-input-surface overlay-input-text`;

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text).catch(console.error);
  };

  // One code block for every answer layout, with its own Copy: copying the snippet is what the reader wants mid-call.
  const renderCodeBlock = (key: React.Key, lang: string, code: string) => (
    <div key={key} className={`my-3 rounded-xl overflow-hidden border shadow-lg ${codeBlockClass}`} style={appearance.codeBlockStyle}>
      <div className={`flex items-center justify-between px-3 py-1.5 border-b ${codeHeaderClass}`} style={appearance.codeHeaderStyle}>
        <span className={`text-[11px] tracking-[0.12em] font-medium font-mono ${codeHeaderTextClass}`}>
          {!lang || lang === 'text' ? 'code' : lang}
        </span>
        <button
          type="button"
          onClick={() => handleCopy(code)}
          aria-label="Copy code"
          className="inline-flex items-center gap-1 text-[11px] overlay-text-secondary hover:text-[var(--overlay-text-primary)]"
        >
          <Copy className="w-3 h-3" aria-hidden="true" />
          <span>Copy</span>
        </button>
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
          showLineNumbers={code.split('\n').length > 6}
          lineNumberStyle={{ minWidth: '2.5em', paddingRight: '1.2em', color: codeLineNumberColor, textAlign: 'right', fontSize: '11px' }}
        >
          {code}
        </SyntaxHighlighter>
      </div>
    </div>
  );

  const renderSayMarkdown = (text: string) => (
    <ReactMarkdown
      remarkPlugins={[remarkGfm, remarkMath]}
      rehypePlugins={[rehypeKatex]}
      components={{
        p: ({ node, ...props }: any) => <p className="mb-2 last:mb-0" {...props} />,
        strong: ({ node, ...props }: any) => <strong className={`font-bold ${isLightTheme ? 'text-emerald-700' : 'text-state-success'}`} {...props} />,
        em: ({ node, ...props }: any) => <em className={`italic ${isLightTheme ? 'text-emerald-700/80' : 'text-emerald-200/80'}`} {...props} />,
        ul: ({ node, ...props }: any) => <ul className="list-disc ml-4 mb-2 space-y-1" {...props} />,
        ol: ({ node, ...props }: any) => <ol className="list-decimal ml-4 mb-2 space-y-1" {...props} />,
        li: ({ node, ...props }: any) => <li className="pl-1" {...props} />,
      }}
    >
      {text}
    </ReactMarkdown>
  );

  const renderMessageText = (msg: Message) => {
    // An answer with its own layout below (what to say, recap, ...) keeps it even when it contains a code fence.
    const hasOwnLayout = msg.intent === 'shorten' || msg.intent === 'recap' || msg.intent === 'follow_up_questions' || msg.intent === 'what_to_answer';
    if (msg.isCode || (msg.role === 'system' && !hasOwnLayout && msg.text.includes('```'))) {
      const parts = msg.text.split(/(```[\s\S]*?```)/g);
      return (
        <div className={`rounded-lg p-3 my-1 border ${subtleSurfaceClass}`} style={appearance.subtleStyle}>
          <div className={`flex items-center gap-2 mb-2 font-medium text-[11px] tracking-[0.02em] ${isLightTheme ? 'text-violet-600' : 'text-purple-300'}`}>
            <Code className="w-3.5 h-3.5" />
            <span>Code Solution</span>
          </div>
          <div className={`space-y-2 text-sm leading-relaxed ${isLightTheme ? 'text-slate-800' : 'text-text-primary'}`}>
            {parts.map((part, i) => {
              if (part.startsWith('```')) {
                const match = part.match(/```(\w+)?\n?([\s\S]*?)```/);
                if (match) {
                  const lang = match[1] || 'text';
                  const code = match[2].trim();
                  return renderCodeBlock(i, lang, code);
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
                      blockquote: ({ node, ...props }: any) => <blockquote className={`border-l-2 pl-3 italic my-2 ${isLightTheme ? 'border-violet-500/30 text-text-tertiary' : 'border-purple-500/50 text-text-secondary'}`} {...props} />,
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
          <div className={`text-sm leading-relaxed markdown-content ${isLightTheme ? 'text-slate-800' : 'text-text-primary'}`}>
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
          <div className={`flex items-center gap-2 mb-2 font-medium text-[11px] tracking-[0.02em] ${isLightTheme ? 'text-indigo-700' : 'text-state-info'}`}>
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Recap</span>
          </div>
          <div className={`text-sm leading-relaxed markdown-content ${isLightTheme ? 'text-slate-800' : 'text-text-primary'}`}>
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
          <div className={`text-sm leading-relaxed markdown-content ${isLightTheme ? 'text-slate-800' : 'text-text-primary'}`}>
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
        <div>
          <div className="mb-1 flex items-center gap-1.5 text-[11px] leading-4 overlay-text-muted">
            <span className="shrink-0 font-medium text-state-success-strong">Say this</span>
            {msg.replyTo && <span className="min-w-0 truncate" title={msg.replyTo}>· Re: {msg.replyTo}</span>}
          </div>
          <div className="text-sm leading-relaxed overlay-text-primary">
            {parts.map((part, i) => {
              if (part.startsWith('```')) {
                const match = part.match(/```(\w*)\s+([\s\S]*?)(?:```|$)/);

                if (match || part.startsWith('```')) {
                  const lang = (match && match[1]) ? match[1] : 'text';
                  let code = '';

                  if (match && match[2]) {
                    code = match[2].trim();
                  } else {
                    code = part.replace(/^```\w*\s*/, '').replace(/```$/, '').trim();
                  }

                  return renderCodeBlock(i, lang, code);
                }
              }
              // The first sentence is what to say: larger than the explanation after it.
              const { lead, rest } = i === 0 ? splitLead(part) : { lead: '', rest: part };
              return (
                <React.Fragment key={i}>
                  {lead && (
                    <div className="markdown-content text-base font-medium leading-6 mb-2">{renderSayMarkdown(lead)}</div>
                  )}
                  {rest && <div className="markdown-content">{renderSayMarkdown(rest)}</div>}
                </React.Fragment>
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

  const latestAnswer = [...messages].reverse().find((m) => m.role === 'system' && !m.isStreaming && m.text);
  const latestAnswerId = latestAnswer?.id;

  return (
    <div className="flex flex-col h-full">
      <div
        ref={scrollContainerRef}
        className="flex-1 overflow-y-auto px-4 pt-2 pb-0 space-y-2.5 no-drag"
        style={{ scrollbarWidth: 'none' }}
      >
        {messages.length === 0 && !isProcessing && (() => {
          const hint = answerEmptyHint(audioKey, hasTranscriptRows);
          const keys = hint.key ? shortcuts[hint.key] : [];
          return (
            <p className="flex flex-wrap items-center gap-x-1 pt-1 text-xs leading-[17px] overlay-text-muted">
              <span>{hint.before}</span>
              {keys.length > 0 && <KeyBadge keys={keys} />}
              {hint.after && <span>{hint.after}</span>}
            </p>
          );
        })()}

        {messages.map((msg) => (
          <div key={msg.id} data-message-id={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'} animate-fade-in-up`}>
            <div className={`
              ${msg.role === 'user' ? 'max-w-[min(72.25%,680px)] px-[13.6px] py-[10.2px]' : msg.intent === 'what_to_answer' ? 'w-full max-w-[680px] px-0 py-1' : 'max-w-[min(85%,680px)] px-4 py-2.5'} text-[14px] leading-6 relative group whitespace-pre-wrap
              ${msg.role === 'user'
                ? (isLightTheme
                  ? 'bg-blue-500/12 border border-blue-500/25 text-blue-950 rounded-[20px] rounded-tr-[4px] shadow-sm font-medium'
                  : 'bg-blue-500/18 border border-blue-400/30 text-blue-50 rounded-[20px] rounded-tr-[4px] shadow-sm font-medium')
                : ''
              }
              ${msg.role === 'system' ? (msg.isError ? 'text-state-danger-strong font-normal' : 'overlay-text-primary font-normal') : ''}
              ${msg.role === 'them' ? 'overlay-text-muted italic pl-0 text-sm' : ''}
            `}>
              {msg.role === 'them' && (
                <div className="flex items-center gap-1.5 mb-1 text-[11px] font-medium tracking-[0.08em] overlay-text-muted">
                  Them
                  {msg.isStreaming && <span className="w-1 h-1 bg-state-success rounded-full animate-pulse" />}
                </div>
              )}
              {msg.role === 'user' && msg.hasScreenshot && (
                <div className={`flex items-center gap-1 text-[11px] opacity-70 mb-1 border-b pb-1 ${isLightTheme ? 'border-black/10' : 'border-white/10'}`}>
                  <Image className="w-2.5 h-2.5" />
                  <span>Screenshot attached</span>
                </div>
              )}
              {msg.role === 'system' && !msg.isStreaming && msg.id !== latestAnswerId && (
                <button
                  onClick={() => handleCopy(msg.text)}
                  aria-label="Copy answer"
                  className="absolute top-2 right-2 p-1.5 rounded-md opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity overlay-icon-surface overlay-icon-surface-hover overlay-text-interactive"
                  title="Copy to clipboard"
                  style={appearance.iconStyle}
                >
                  <Copy className="w-3.5 h-3.5" />
                </button>
              )}
              {renderMessageText(msg)}
              {msg.id === latestAnswerId && (
                <div className="mt-1.5 flex justify-end">
                  <button
                    onClick={() => handleCopy(msg.text)}
                    className="inline-flex items-center gap-1 rounded-full border border-border-subtle px-2 py-0.5 text-[11px] overlay-text-secondary hover:text-[var(--overlay-text-primary)]"
                  >
                    <Copy className="w-3 h-3" aria-hidden="true" />
                    <span>Copy</span>
                  </button>
                  {onRetry && (
                    <button
                      onClick={onRetry}
                      className="ml-1.5 inline-flex items-center gap-1 rounded-full border overlay-hairline px-2 py-0.5 text-[11px] overlay-text-secondary hover:text-[var(--overlay-text-primary)]"
                    >
                      <RefreshCw className="w-3 h-3" aria-hidden="true" />
                      <span>Retry</span>
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        ))}

      </div>

      <div className="shrink-0 px-3 min-[560px]:px-4 py-2 no-drag">
        <div className="flex h-7 items-center gap-1.5 mb-1.5">
          <button
            onClick={isProcessing ? onStop : handleWhatToSay}
            disabled={isProcessing && !onStop}
            className={`flex h-7 min-w-[9rem] items-center justify-center gap-1.5 px-3 rounded-full text-xs font-semibold transition-colors active:scale-95 duration-200 interaction-base interaction-press whitespace-nowrap shrink-0 disabled:cursor-wait ${
              primaryQuiet
                ? `border overlay-hairline ${quickActionClass}`
                : 'bg-[var(--overlay-action)] text-white shadow-[0_4px_14px_rgba(0,113,227,0.18)] hover:brightness-95'
            }`}
            style={primaryQuiet ? appearance.chipStyle : undefined}
          >
            {isProcessing ? <Square className="w-3 h-3 fill-current opacity-75" aria-hidden="true" /> : <Zap className="w-3 h-3 opacity-75" />} {isProcessing ? 'Stop' : 'What to say'}
            {!isProcessing && shortcuts.whatToAnswer.length > 0 && <KeyBadge keys={shortcuts.whatToAnswer} onAction={!primaryQuiet} className="hidden min-[560px]:flex ml-0.5" />}
          </button>
          <button onClick={handleClarify} aria-label="Clarify" title="Clarify" className={`flex h-7 w-7 min-[560px]:w-auto items-center justify-center gap-1.5 min-[560px]:px-2 rounded-full text-xs font-medium border overlay-hairline transition-colors active:scale-95 duration-200 interaction-base interaction-press whitespace-nowrap shrink-0 ${quickActionClass}`} style={appearance.chipStyle}>
            <MessageSquare className="w-3 h-3 opacity-65" /> <span className="hidden min-[560px]:inline">Clarify</span>
          </button>
          <button onClick={actionButtonMode === 'brainstorm' ? handleBrainstorm : handleRecap} aria-label={actionButtonMode === 'brainstorm' ? 'Ideas' : 'Recap'} title={actionButtonMode === 'brainstorm' ? 'Ideas' : 'Recap'} className={`flex h-7 w-7 min-[560px]:w-auto items-center justify-center gap-1.5 min-[560px]:px-2 rounded-full text-xs font-medium border overlay-hairline transition-colors active:scale-95 duration-200 interaction-base interaction-press whitespace-nowrap shrink-0 ${quickActionClass}`} style={appearance.chipStyle}>
            {actionButtonMode === 'brainstorm'
              ? <><Lightbulb className="w-3 h-3 opacity-65" /> <span className="hidden min-[560px]:inline">Ideas</span></>
              : <><RefreshCw className="w-3 h-3 opacity-65" /> <span className="hidden min-[560px]:inline">Recap</span></>
            }
          </button>
          <button onClick={handleFollowUpQuestions} aria-label="Follow-up" title="Follow-up" className={`flex h-7 w-7 min-[560px]:w-auto items-center justify-center gap-1.5 min-[560px]:px-2 rounded-full text-xs font-medium border overlay-hairline transition-colors active:scale-95 duration-200 interaction-base interaction-press whitespace-nowrap shrink-0 ${quickActionClass}`} style={appearance.chipStyle}>
            <HelpCircle className="w-3 h-3 opacity-65" /> <span className="hidden min-[560px]:inline">Follow-up</span>
          </button>
          {onCaptureScreen && (
            <button onClick={onCaptureScreen} aria-label="Screenshot" title="Screenshot of the screen, attached to your next question" className={`ml-auto flex h-7 w-7 shrink-0 items-center justify-center rounded-full border overlay-hairline transition-colors active:scale-95 duration-200 interaction-base interaction-press ${quickActionClass}`} style={appearance.chipStyle}>
              <Monitor className="w-3 h-3 opacity-65" aria-hidden="true" />
            </button>
          )}
          {onCaptureArea && (
            <button onClick={onCaptureArea} aria-label="Select area" title={`Screenshot of a selected area${shortcuts.selectiveScreenshot.length ? ` (${shortcuts.selectiveScreenshot.join('+')})` : ''}`} className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full border overlay-hairline transition-colors active:scale-95 duration-200 interaction-base interaction-press ${quickActionClass}`} style={appearance.chipStyle}>
              <Crop className="w-3 h-3 opacity-65" aria-hidden="true" />
            </button>
          )}
        </div>
        {attachedContext.length > 0 && (
          <div className="mb-1.5 flex h-7 items-center gap-1.5 overflow-hidden" role="group" aria-label={`${attachedContext.length} screenshot${attachedContext.length > 1 ? 's' : ''} attached`}>
            {attachedContext.map((ctx, idx) => (
              <div key={ctx.path} className="relative group/thumb shrink-0">
                <img
                  src={ctx.preview}
                  alt={`Screenshot ${idx + 1}`}
                  className={`h-6 w-auto rounded border ${isLightTheme ? 'border-black/15' : 'border-white/20'}`}
                />
                <button
                  onClick={() => setAttachedContext(prev => prev.filter((_, i) => i !== idx))}
                  className="absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-state-danger opacity-0 transition-opacity group-hover/thumb:opacity-100 focus-visible:opacity-100"
                  aria-label={`Remove screenshot ${idx + 1}`}
                  title="Remove"
                >
                  <X className="w-2.5 h-2.5 text-white" />
                </button>
              </div>
            ))}
            {attachedContext.length > 1 && (
              <button
                onClick={() => setAttachedContext([])}
                className="shrink-0 rounded-full border overlay-hairline px-2 py-0.5 text-[11px] overlay-text-secondary hover:text-[var(--overlay-text-primary)]"
              >
                Clear
              </button>
            )}
          </div>
        )}

        <div className="relative h-9 group">
          <input
            ref={textInputRef}
            type="text"
            aria-label="Ask a question"
            placeholder="Ask about the call or the screen"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && !e.nativeEvent.isComposing && handleManualSubmit()}
            className={`h-9 w-full border overlay-hairline focus:ring-1 rounded-xl pl-3 pr-10 focus:outline-none transition-all duration-200 ease-sculpted font-sans text-sm ${inputClass}`}
            style={appearance.inputStyle}
          />

          <button
            onClick={handleManualSubmit}
            aria-label="Send"
            disabled={!inputValue.trim()}
            className={`
              absolute right-1 top-1/2 -translate-y-1/2 w-7 h-7 rounded-full flex items-center justify-center
              interaction-base interaction-press
              overlay-icon-surface
              ${inputValue.trim() ? 'overlay-text-primary' : 'overlay-text-muted cursor-not-allowed'}
            `}
            style={appearance.iconStyle}
          >
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
};

export default ChatPanel;
