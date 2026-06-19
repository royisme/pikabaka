import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'tap';
import { QuestionDetector, detectQuestionFromText } from '../electron/core/QuestionDetector';
import { normalizeAutoAnswerSettings } from '../electron/core/AutoAnswerController';
import { SessionTracker } from '../electron/core/SessionTracker';
import { normalizeOpenAICompatibleBaseUrl } from '../electron/utils/modelFetcher';
import { upsertTranscriptSegment } from '../src/lib/transcriptSegments';

const read = (relativePath: string) => readFileSync(path.join(process.cwd(), relativePath), 'utf8');

test('QuestionDetector detects real interviewer questions and classifies them', (t) => {
  const behavioral = detectQuestionFromText('Can you tell me about a time when you handled a conflict with a stakeholder?');
  t.ok(behavioral?.isQuestion, 'behavioral interviewer question detected');
  t.equal(behavioral?.type, 'behavioral', 'behavioral question is classified');

  const coding = detectQuestionFromText('Given an array of integers, can you implement an efficient algorithm to return the maximum subarray sum and discuss time complexity?');
  t.ok(coding?.isQuestion, 'coding question detected');
  t.equal(coding?.type, 'coding', 'coding question is classified');

  const filler = detectQuestionFromText('Right?');
  t.equal(filler, null, 'filler question is ignored');
  t.end();
});

test('QuestionDetector ignores user speech and suppresses duplicates', (t) => {
  const detector = new QuestionDetector({ duplicateWindowMs: 60_000 });
  const first = detector.detect({ speaker: 'interviewer', text: 'How would you design a cache invalidation strategy for this service?', timestamp: 1000, final: true, confidence: 0.9 });
  const second = detector.detect({ speaker: 'interviewer', text: 'How would you design a cache invalidation strategy for this service?', timestamp: 2000, final: true, confidence: 0.9 });
  const user = detector.detect({ speaker: 'user', text: 'Can you tell me about your architecture?', timestamp: 3000, final: true, confidence: 0.9 });

  t.ok(first, 'first interviewer question detected');
  t.equal(second, null, 'duplicate interviewer question suppressed');
  t.equal(user, null, 'user transcript never triggers detector');
  t.end();
});

test('QuestionDetector can assemble multi-turn interviewer prompts', (t) => {
  const detector = new QuestionDetector();
  const setup = detector.detect({ speaker: 'interviewer', text: 'Let us switch to a system design scenario for a notification service.', timestamp: 1000, final: true, confidence: 0.85 });
  const question = detector.detect({ speaker: 'interviewer', text: 'How would you design the API, queue, database, and retry strategy?', timestamp: 2500, final: true, confidence: 0.86 });

  t.equal(setup, null, 'setup sentence alone is not enough');
  t.ok(question?.isQuestion, 'follow-up question is detected with buffered context');
  t.equal(question?.type, 'technical', 'technical system-design question is classified');
  t.match(question?.question || '', /How would you design/i, 'question text is preserved');
  t.end();
});


test('cross-role duplicate transcript keeps interviewer and drops mic echo', (t) => {
  const session = new SessionTracker();
  const now = Date.now();
  const user = session.handleTranscript({ speaker: 'user', text: 'How would you design a reliable notification service using queues and retries?', timestamp: now, final: true, confidence: 0.95 });
  const interviewer = session.handleTranscript({ speaker: 'interviewer', text: 'How would you design a reliable notification service using queues and retries?', timestamp: now + 700, final: true, confidence: 0.95 });
  const echoUser = session.handleTranscript({ speaker: 'user', text: 'How would you design a reliable notification service using queues and retries?', timestamp: now + 1100, final: true, confidence: 0.95 });

  t.equal(user?.role, 'user', 'initial mic transcript is accepted while no interviewer duplicate exists');
  t.equal(interviewer?.role, 'interviewer', 'interviewer transcript is accepted');
  t.notOk(interviewer?.droppedAsDuplicate, 'interviewer supersedes duplicate mic text');
  t.equal(echoUser?.droppedAsDuplicate, true, 'later mic echo is dropped');
  t.equal(echoUser?.duplicateOfRole, 'interviewer', 'mic echo points at interviewer duplicate');
  t.notMatch(session.getFormattedContext(30), /\[ME\]: How would you design/, 'duplicate ME line is removed from context');
  t.match(session.getFormattedContext(30), /\[INTERVIEWER\]: How would you design/, 'interviewer line remains in context');
  t.end();
});

test('renderer transcript upsert removes duplicated ME segment when interviewer arrives', (t) => {
  const withUser = upsertTranscriptSegment([], {
    final: true,
    segmentId: 'u1',
    speaker: 'user',
    text: 'How would you design a reliable notification service using queues and retries?',
    timestamp: 1000,
  });
  const withInterviewer = upsertTranscriptSegment(withUser, {
    final: true,
    segmentId: 'i1',
    speaker: 'interviewer',
    text: 'How would you design a reliable notification service using queues and retries?',
    timestamp: 1500,
  });

  t.equal(withUser.length, 1, 'user segment initially appears');
  t.equal(withInterviewer.length, 1, 'interviewer duplicate replaces user segment');
  t.equal(withInterviewer[0].speaker, 'interviewer');
  t.end();
});


test('cross-role duplicate transcript removes segmented mic echo against interviewer text', (t) => {
  const session = new SessionTracker();
  const now = Date.now();
  session.handleTranscript({ speaker: 'user', text: 'Given an array of integers,', timestamp: now, final: true, confidence: 0.95 });
  session.handleTranscript({ speaker: 'interviewer', text: 'Given an array of integers, can you implement an efficient algorithm', timestamp: now + 700, final: true, confidence: 0.95 });
  const echo = session.handleTranscript({ speaker: 'user', text: 'can you implement an efficient algorithm to return the maximum subarray', timestamp: now + 900, final: true, confidence: 0.95 });
  const interviewerTail = session.handleTranscript({ speaker: 'interviewer', text: 'to return the maximum subarray sum and discuss time complexity?', timestamp: now + 1100, final: true, confidence: 0.95 });

  const context = session.getFormattedContext(30);
  t.equal(echo?.droppedAsDuplicate, true, 'overlapping user chunk is dropped as interviewer echo');
  t.equal(interviewerTail?.role, 'interviewer', 'interviewer tail is accepted');
  t.notMatch(context, /\[ME\]: Given an array/i, 'leading mic fragment is removed when interviewer contains it');
  t.notMatch(context, /\[ME\]: can you implement/i, 'overlapping mic fragment is not kept');
  t.match(context, /\[INTERVIEWER\]: Given an array/i, 'interviewer leading segment remains');
  t.match(context, /\[INTERVIEWER\]: to return the maximum subarray/i, 'interviewer tail remains');
  t.end();
});

test('renderer transcript upsert removes segmented ME echoes', (t) => {
  const now = Date.now();
  const userLead = upsertTranscriptSegment([], { final: true, segmentId: 'u1', speaker: 'user', text: 'Given an array of integers,', timestamp: now });
  const interviewerLead = upsertTranscriptSegment(userLead, { final: true, segmentId: 'i1', speaker: 'interviewer', text: 'Given an array of integers, can you implement an efficient algorithm', timestamp: now + 700 });
  const userEcho = upsertTranscriptSegment(interviewerLead, { final: true, segmentId: 'u2', speaker: 'user', text: 'can you implement an efficient algorithm to return the maximum subarray', timestamp: now + 900 });
  const interviewerTail = upsertTranscriptSegment(userEcho, { final: true, segmentId: 'i2', speaker: 'interviewer', text: 'to return the maximum subarray sum and discuss time complexity?', timestamp: now + 1100 });

  t.same(interviewerTail.map((s) => s.speaker), ['interviewer', 'interviewer'], 'only interviewer segments remain');
  t.match(interviewerTail.map((s) => s.sourceText).join(' '), /maximum subarray sum/i, 'interviewer content is preserved');
  t.end();
});

test('Auto Answer settings normalize unsafe values', (t) => {
  const normalized = normalizeAutoAnswerSettings({ mode: 'auto_answer', minConfidence: 2, cooldownMs: 1, includeRecentScreenshots: true });
  t.equal(normalized.mode, 'auto_answer');
  t.equal(normalized.minConfidence, 0.95, 'min confidence is capped');
  t.equal(normalized.cooldownMs, 3000, 'cooldown is floored');
  t.equal(normalized.includeRecentScreenshots, true);
  t.end();
});


test('OpenAI-compatible base URL normalization handles common pasted endpoints', (t) => {
  t.equal(normalizeOpenAICompatibleBaseUrl('https://example.com'), 'https://example.com/v1');
  t.equal(normalizeOpenAICompatibleBaseUrl('https://example.com/v1'), 'https://example.com/v1');
  t.equal(normalizeOpenAICompatibleBaseUrl('https://example.com/api/v1/chat/completions'), 'https://example.com/api/v1');
  t.equal(normalizeOpenAICompatibleBaseUrl('http://localhost:1234/models'), 'http://localhost:1234/v1');
  t.end();
});

test('Auto Answer is wired end-to-end through manager, IPC, preload, and overlay UI', (t) => {
  const manager = read('electron/IntelligenceManager.ts');
  const main = read('electron/main.ts');
  const ipc = read('electron/ipc/intelligence.ts');
  const preload = read('electron/preload.ts');
  const hook = read('src/hooks/useMeetingChat.ts');
  const transcriptPanel = read('src/components/meeting/TranscriptPanel.tsx');
  const settings = read('src/components/SettingsOverlay.tsx');

  t.match(manager, /autoAnswerController\.handleTranscript\(segment\)/, 'accepted interviewer transcript stream flows into AutoAnswerController');
  t.match(main, /auto-answer-question-detected/, 'main process forwards detected-question events');
  t.match(ipc, /get-auto-answer-settings/, 'settings IPC exists');
  t.match(ipc, /set-auto-answer-settings/, 'settings update IPC exists');
  t.match(preload, /onAutoAnswerQuestionDetected/, 'renderer can subscribe to detection events');
  t.match(hook, /api\.onAutoAnswerGenerationStarted/, 'meeting chat hook tracks generation lifecycle');
  t.match(transcriptPanel, /Auto Answer/, 'overlay renders Auto Answer controls');
  t.match(settings, /AUTO_ANSWER_MODE_OPTIONS/, 'settings renders persistent Auto Answer modes');
  t.end();
});

test('Auto Answer compact panel uses a free-form language control, not hardcoded language chips', (t) => {
  const transcriptPanel = read('src/components/meeting/TranscriptPanel.tsx');
  const modeSelectorOccurrences = (transcriptPanel.match(/\['off', 'Off'\]/g) || []).length;
  t.equal(modeSelectorOccurrences, 1, 'Auto Answer mode selector is rendered once, not duplicated in the body');
  t.match(transcriptPanel, /Custom answer language/, 'compact panel exposes custom answer language input');
  t.match(transcriptPanel, /persistAnswerLanguage/, 'compact panel persists arbitrary language text');
  t.match(transcriptPanel, /Type any language or language mix/, 'language input tells users arbitrary mixes are allowed');
  t.match(transcriptPanel, /Same language/, 'language auto reset is named distinctly from Auto Answer mode Auto');
  t.notMatch(transcriptPanel, /Auto: answer in the interviewer/, 'language auto reset does not reuse ambiguous Auto label/title');
  t.notMatch(transcriptPanel, /AUTO_ANSWER_LANGUAGE_OPTIONS/, 'compact panel does not use a hardcoded language option array');
  t.notMatch(transcriptPanel, /EN\+RU/, 'compact panel no longer renders fixed EN/RU/EN+RU chips');
  t.end();
});

test('AI response language accepts arbitrary custom language instructions end-to-end', (t) => {
  const languages = read('electron/config/languages.ts');
  const ipc = read('electron/ipc/core.ts');
  const helper = read('electron/core/LLMHelper.ts');
  const whatToAnswer = read('electron/llm/WhatToAnswerLLM.ts');
  const settings = read('src/components/SettingsOverlay.tsx');

  t.match(languages, /AI_RESPONSE_LANGUAGES:[\s\S]*= \[\]/, 'renderer language choices are not a hardcoded list');
  t.match(ipc, /return raw;/, 'IPC accepts arbitrary non-empty language text');
  t.notMatch(ipc, /AI_RESPONSE_LANGUAGE_CODES|\.has\(sanitizedLanguage\)/, 'IPC does not restrict AI response language to a static set');
  t.match(helper, /getAiResponseLanguageInstruction/, 'LLM helper exposes reusable language instruction');
  t.match(helper, /requested language or locale/, 'single custom language strings are passed through to the prompt');
  t.match(helper, /requested languages or language variants/, 'custom multi-language strings are handled generically');
  t.notMatch(helper, /Отвечай только на русском языке|Answer bilingually/, 'LLM helper does not hardcode Russian or bilingual prompt branches');
  t.match(whatToAnswer, /<answer_language>/, 'What-to-answer streaming prompt carries the selected answer language');
  t.match(settings, /Custom AI response language/, 'settings uses a custom language input');
  t.notMatch(settings, /availableAiLanguages|isAiLangDropdownOpen/, 'settings no longer renders a hardcoded language dropdown');
  t.end();
});

test('mouse passthrough icon shows the disable shortcut next to the icon', (t) => {
  const chatPanel = read('src/components/meeting/ChatPanel.tsx');
  t.match(chatPanel, /mousePassthroughShortcut = formatShortcutHint\(shortcuts\.toggleMousePassthrough\)/, 'chat panel reads configured mouse-passthrough shortcut');
  t.match(chatPanel, /Disable \$\{mousePassthroughShortcut\}/, 'visible hint explains how to disable click-through');
  t.match(chatPanel, /<PointerOff[\s\S]*<span[\s\S]*\{mousePassthroughHint\}/, 'hint text is rendered beside the pointer-off icon');
  t.end();
});

test('Claude streaming does not duplicate every text delta', (t) => {
  const helper = read('electron/core/LLMHelper.ts');
  const fn = helper.slice(helper.indexOf('private async * streamWithClaude('), helper.indexOf('private async * streamWithOpenaiMultimodal('));
  const yields = fn.match(/yield event\.delta\.text/g) || [];
  t.equal(yields.length, 1, 'Claude text delta is yielded exactly once');
  t.end();
});
