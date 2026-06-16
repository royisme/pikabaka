import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'tap';

const read = (relativePath: string) => readFileSync(path.join(process.cwd(), relativePath), 'utf8');

test('quick answer actions use the intelligence transcript path instead of generic chat context', (t) => {
  const source = read('src/hooks/useMeetingChat.ts');
  const handleStart = source.indexOf('const handleWhatToSay');
  const handleEnd = source.indexOf('const handleFollowUp', handleStart);
  const handleBody = source.slice(handleStart, handleEnd);

  t.match(handleBody, /window\.electronAPI\.generateWhatToSay/, 'Guide me/Answer calls the transcript-aware IPC mode');
  t.notMatch(handleBody, /submitPrompt\(/, 'Guide me/Answer no longer routes through generic chat/RAG prompt text');
  t.match(source, /\[LIVE INTERVIEW TRANSCRIPT\]/, 'manual chat context explicitly includes live transcript context');
  t.match(source, /getSuggestedAnswerIntent/, 'suggested-answer stream events are mapped to explicit UI intents');
  t.match(source, /normalized\.includes\('brainstorm'\)\) return 'brainstorm'/, 'brainstorm streams render as brainstorm messages');
  t.match(source, /normalized\.includes\('code hint'\)\) return 'code_hint'/, 'code-hint streams render as code-hint messages');
  t.end();
});


test('capture-and-process sends the captured screenshot directly instead of relying on pending attachment state', (t) => {
  const source = read('src/components/PikaInterface.tsx');
  const start = source.indexOf('onCaptureAndProcess');
  const body = source.slice(start, source.indexOf('useEffect(() => {', start));

  t.match(body, /handleWhatToSay\(\[attachment\]\)/, 'immediate capture processing passes the exact captured attachment into Answer');
  t.notMatch(body, /handleScreenshotAttach\(data as ScreenshotAttachment\).*handleWhatToSay\(\)/s, 'does not depend on async React attachment state before sending');
  t.end();
});

test('stream chat captures transcript context before adding the current prompt', (t) => {
  const source = read('electron/ipc/core.ts');
  const streamStart = source.indexOf('safeHandle("gemini-chat-stream"');
  const streamBody = source.slice(streamStart, source.indexOf('});', streamStart));
  const autoContextIndex = streamBody.indexOf('const autoContext = intelligenceManager.getFormattedContext(100)');
  const addTranscriptIndex = streamBody.indexOf('intelligenceManager.addTranscript');

  t.ok(autoContextIndex >= 0, 'stream chat has transcript auto-context injection');
  t.ok(addTranscriptIndex >= 0, 'stream chat still records the user prompt for later context');
  t.ok(autoContextIndex < addTranscriptIndex, 'auto context is captured before the current prompt is recorded');
  t.end();
});

test('transcript and chat rendering distinguish action outputs and avoid ugly transcript borders', (t) => {
  const chatPanel = read('src/components/meeting/ChatPanel.tsx');
  const rollingTranscript = read('src/components/ui/RollingTranscript.tsx');

  t.match(chatPanel, /msg\.intent === 'brainstorm'/, 'brainstorm output has its own render intent');
  t.match(chatPanel, /msg\.intent === 'code_hint'/, 'code hint output has its own render intent');
  t.match(chatPanel, /\? 'Ideas'/, 'brainstorm output is labelled Ideas');
  t.match(chatPanel, /\? 'Code hint'/, 'code-hint output is labelled Code hint');
  t.match(chatPanel, /const canSubmitPrompt = inputValue\.trim\(\)\.length > 0 \|\| attachedContext\.length > 0;/, 'manual send button works for screenshot-only prompts');
  t.match(chatPanel, /disabled=\{!canSubmitPrompt\}/, 'manual send disabled state respects attachments as well as typed text');
  t.notMatch(rollingTranscript, /rounded-2xl border border-border-subtle px-4 py-3 shadow-sm overlay-transcript-surface/, 'final transcript bubbles do not draw the old heavy border');
  t.notMatch(rollingTranscript, /rounded-2xl border border-border-subtle\/80 px-4 py-3 overlay-transcript-surface/, 'live transcript bubbles do not draw the old partial border');
  t.end();
});
