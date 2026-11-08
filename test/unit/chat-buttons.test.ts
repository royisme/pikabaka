import t from 'tap';
import path from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider, QueryObserver } from '@tanstack/react-query';
import type { QueryObserverOptions } from '@tanstack/react-query';
import * as ReactQuery from '@tanstack/react-query';
import * as FramerMotion from 'framer-motion';
import { mockRequire } from '../../node_modules/@tapjs/mock/dist/esm/mock-require.js';
import { replyToLineRequest } from '../../src/lib/transcriptAsk';
import TranscriptNotes from '../../src/components/ui/RollingTranscript';
import { meetingChatFlagsReducer, initialMeetingChatFlags } from '../../src/hooks/meetingChatFlagsReducer';
import type { TranscriptSegment } from '../../src/lib/transcriptSegments';
import type { useMeetingChat as UseMeetingChat } from '../../src/hooks/useMeetingChat';
import type { ShortcutConfig } from '../../src/hooks/useShortcuts';

const at = (name: string) => path.resolve(name);
const noop = () => {};

const lecture = 'A load factor above 0.75 triggers a resize; next week, open addressing.';
const question = 'Can the onboarding flow ship in two languages by March?';

function row(segmentId: string, sourceText: string, speaker: 'them' | 'user' = 'them'): TranscriptSegment {
  return {
    segmentId, sourceText, timestamp: 1, speakerLabel: speaker === 'them' ? 'Them' : 'You',
    translationState: 'skipped', speaker, revision: 1,
  };
}

function visibleText(html: string) {
  return html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');
}

// ---------------------------------------------------------------- the button row

const shortcuts = { reply: ['⌘', '1'], selectiveScreenshot: ['⌘', '⇧', 'H'] } as unknown as ShortcutConfig;

function chatPanel() {
  const { default: ChatPanel } = mockRequire(at('src/components/meeting/ChatPanel.tsx'), {
    'katex/dist/katex.min.css': {},
    react: React,
  }) as { default: React.FC<Record<string, unknown>> };
  return renderToStaticMarkup(React.createElement(ChatPanel, {
    messages: [], attachedContext: [], setAttachedContext: noop, inputValue: '', setInputValue: noop,
    isProcessing: false, handleReply: noop, handleAsk: noop, handleCatchUp: noop, handleManualSubmit: noop,
    onCaptureScreen: noop, onCaptureArea: noop, appearance: {}, isLightTheme: false, shortcuts,
    scrollContainerRef: { current: null }, textInputRef: { current: null },
  }));
}

t.test('the chat panel offers Reply, Ask, Catch up and the two capture buttons, and nothing else', async t => {
  const html = chatPanel();
  const labels = [...html.matchAll(/<button[^>]*aria-label="([^"]+)"/g)].map(match => match[1]);
  t.same(labels, ['Reply', 'Ask', 'Catch up', 'Screenshot', 'Select area', 'Send']);
  const text = visibleText(html);
  for (const gone of [/Clarify/, /Follow-up/, /Ideas/, /Recap/, /What to say/]) t.notMatch(text, gone);
  t.match(html, /title="Reply"/);
});

// ---------------------------------------------------------------- the settings popup

t.test('the settings popup has no Brainstorm or Ideas row', async t => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const queries = new Map<string, QueryObserver>();
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { electronAPI: {}, atob, btoa, addEventListener: noop, removeEventListener: noop } });
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: () => null, setItem: noop } });
  const { default: SettingsPopup } = mockRequire(at('src/components/SettingsPopup.tsx'), {
    react: { ...React, useEffect: noop, useLayoutEffect: noop },
    '@tanstack/react-query': { ...ReactQuery, useQueryClient: () => client,
      useQuery: ({ queryKey, queryFn, ...options }: { queryKey: readonly unknown[]; queryFn?: () => Promise<unknown> } & QueryObserverOptions) => {
        const key = JSON.stringify(queryKey);
        let observer = queries.get(key);
        if (!observer) { observer = new QueryObserver(client, { ...options, queryKey, queryFn }); queries.set(key, observer); }
        return observer.getCurrentResult();
      } },
    'framer-motion': FramerMotion,
    'react-dom': { createPortal: (children: React.ReactNode) => children },
    [at('assets/icon.png')]: 'synthetic-icon.png',
    [at('src/hooks/useShortcuts.ts')]: { useShortcuts: () => ({ shortcuts: {}, updateShortcut: noop, resetShortcuts: noop, isShortcutPressed: () => false }) },
    [at('src/hooks/useMainEvent.ts')]: { useMainEvent: noop },
    [at('src/hooks/useWindowEvent.ts')]: { useWindowEvent: noop },
    [at('src/hooks/useResolvedTheme.ts')]: { useResolvedTheme: () => 'dark' },
    [at('src/hooks/useLocalStorageValue.ts')]: { useLocalStorageValue: () => [null, noop] },
    [at('src/utils/platformUtils.ts')]: { isMac: true, isWindows: false },
  }) as { default: (props: object) => React.ReactNode };
  const html = renderToStaticMarkup(React.createElement(QueryClientProvider, { client },
    React.createElement(SettingsPopup as React.FC<object>, { isOpen: true, onClose: noop, onStartMeeting: noop, onOpenSettings: noop })));
  t.match(visibleText(html), 'Show or hide Pika', 'the popup rendered');
  t.notMatch(visibleText(html), /Brainstorm|Ideas/);
});

// ---------------------------------------------------------------- Reply on a transcript row

t.test('Reply to this line shows on other-party rows only, and only when a handler is given', async t => {
  const segments = [row('a', lecture), row('b', 'Invented own words', 'user'), row('c', question)];
  const withHandler = renderToStaticMarkup(React.createElement(TranscriptNotes, { segments, displayMode: 'original', onReplySegment: noop }));
  t.equal(withHandler.split('data-reply-line').length - 1, 2);
  t.match(withHandler, /aria-label="Reply to this line"/);
  const without = renderToStaticMarkup(React.createElement(TranscriptNotes, { segments, displayMode: 'original' }));
  t.equal(without.split('data-reply-line').length - 1, 0);
  const ask = renderToStaticMarkup(React.createElement(TranscriptNotes, { segments, displayMode: 'original', onAskSegment: noop, onReplySegment: noop }));
  t.equal(ask.split('data-ask-line').length - 1, 2, 'the ask button stays');
  t.match(withHandler, /opacity-0[^"]*group-hover:opacity-100/, 'hidden until hover or focus');
});

t.test('Reply to a row targets that line, not the last sentence', async t => {
  const segments = [row('q', question), row('s1', 'Invented sentence about a vendor review.'), row('s2', lecture)];
  const request = replyToLineRequest(segments[0]);
  t.equal(request.replyTo, question);
  t.equal(request.userText, `What should I say in response to: "${question}"?`);
  t.equal(replyToLineRequest({ sourceText: `  ${lecture}  ` }).replyTo, lecture, 'the line is trimmed');
});

// ---------------------------------------------------------------- the hook: retry and row reply

function hookHost() {
  const calls = { ask: 0, catchUp: 0, prompts: [] as string[] };
  const slots: unknown[] = [];
  let index = 0;
  const slot = <T,>(initial: () => T) => { const i = index++; if (!(i in slots)) slots[i] = initial(); return i; };
  const react = {
    ...React,
    useState: (initial: unknown) => { const i = slot(() => typeof initial === 'function' ? (initial as () => unknown)() : initial); return [slots[i], (next: unknown) => { slots[i] = typeof next === 'function' ? (next as (v: unknown) => unknown)(slots[i]) : next; }]; },
    useReducer: (reducer: (s: unknown, a: unknown) => unknown, initial: unknown) => { const i = slot(() => initial); return [slots[i], (action: unknown) => { slots[i] = reducer(slots[i], action); }]; },
    useRef: (value: unknown) => { const i = slot(() => ({ current: value })); return slots[i]; },
    useCallback: (fn: unknown) => fn,
    useMemo: (fn: () => unknown) => fn(),
    useEffect: noop,
  };
  Object.defineProperty(globalThis, 'window', { configurable: true, value: {
    setTimeout: noop,
    electronAPI: {
      generateAsk: async () => { calls.ask += 1; return { question: 'Invented question' }; },
      generateCatchUp: async () => { calls.catchUp += 1; return { summary: 'Invented summary' }; },
      streamGeminiChat: async (prompt: string) => { calls.prompts.push(prompt); },
    },
  } });
  const { useMeetingChat: chatHook } = mockRequire(at('src/hooks/useMeetingChat.ts'), {
    react,
    '@ai-sdk/react': { useChat: () => ({ messages: [], sendMessage: noop, status: 'ready', stop: noop }) },
    ai: { DefaultChatTransport: class {} },
    '@tanstack/react-query': { useQuery: () => ({ data: false }), useQueryClient: () => ({ setQueryData: noop, invalidateQueries: noop }) },
    [at('src/lib/electronChatFetch.ts')]: { electronChatFetch: noop },
    [at('src/hooks/useMainEvent.ts')]: { useMainEvent: noop },
  }) as { useMeetingChat: typeof UseMeetingChat };
  // One render of the hook: the refs and state of the earlier renders carry over.
  const render = () => { index = 0; return chatHook({ getReplyContext: () => 'Invented latest words' }); };
  return { calls, render, flags: () => slots.find(slot => slot && typeof slot === 'object' && 'canRetry' in slot) };
}

t.test('Retry asks again what was asked last: Ask and Catch up', async t => {
  const h = hookHost();
  await h.render().handleAsk();
  t.equal(h.calls.ask, 1);
  await h.render().retryLast();
  t.equal(h.calls.ask, 2, 'Retry runs Ask again');
  t.equal(h.calls.catchUp, 0);

  await h.render().handleCatchUp();
  await h.render().retryLast();
  t.equal(h.calls.catchUp, 2, 'Retry runs Catch up again');
  t.equal(h.calls.ask, 2);
});

t.test('Retry of a row Reply asks for the same line again', async t => {
  const h = hookHost();
  const request = replyToLineRequest(row('q', question));
  await h.render().handleReplyToLine(request);
  await h.render().retryLast();
  t.same(h.calls.prompts, [request.userText, request.userText]);
  t.ok(initialMeetingChatFlags && meetingChatFlagsReducer, 'the flags reducer is the real one');
});

// ---------------------------------------------------------------- the lecture fixture reads through the same builder

t.test('the lecture fixture is quoted as the line to reply to', async t => {
  t.equal(replyToLineRequest(row('l', lecture)).userText, `What should I say in response to: "${lecture}"?`);
});
