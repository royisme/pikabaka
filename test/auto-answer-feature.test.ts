import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'tap';
import { QuestionDetector, detectQuestionFromText } from '../electron/core/QuestionDetector';
import { normalizeAutoAnswerSettings } from '../electron/core/AutoAnswerController';

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

test('Auto Answer settings normalize unsafe values', (t) => {
  const normalized = normalizeAutoAnswerSettings({ mode: 'auto_answer', minConfidence: 2, cooldownMs: 1, includeRecentScreenshots: true });
  t.equal(normalized.mode, 'auto_answer');
  t.equal(normalized.minConfidence, 0.95, 'min confidence is capped');
  t.equal(normalized.cooldownMs, 3000, 'cooldown is floored');
  t.equal(normalized.includeRecentScreenshots, true);
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

  t.match(manager, /this\.autoAnswerController\.handleTranscript\(segment\)/, 'transcript stream flows into AutoAnswerController');
  t.match(main, /auto-answer-question-detected/, 'main process forwards detected-question events');
  t.match(ipc, /get-auto-answer-settings/, 'settings IPC exists');
  t.match(ipc, /set-auto-answer-settings/, 'settings update IPC exists');
  t.match(preload, /onAutoAnswerQuestionDetected/, 'renderer can subscribe to detection events');
  t.match(hook, /api\.onAutoAnswerGenerationStarted/, 'meeting chat hook tracks generation lifecycle');
  t.match(transcriptPanel, /Auto Answer/, 'overlay renders Auto Answer controls');
  t.match(settings, /AUTO_ANSWER_MODE_OPTIONS/, 'settings renders persistent Auto Answer modes');
  t.end();
});
