// Sample content, invented for illustration. No real meeting, person or product appears here.
// The types come from the app's own IPC types: a change to them fails `tsc` here.
import type { AgentProactiveCard, ElectronAPI } from '../../src/types/electron';

type Transcript = Parameters<Parameters<ElectronAPI['onNativeAudioTranscript']>[0]>[0];

export type SceneId = 'class' | 'client';

/** One step of the replay. The runner feeds each one through the event or the control the app already has. */
export type Step =
  | { kind: 'transcript'; transcript: Transcript }
  | { kind: 'card'; card: AgentProactiveCard }
  /** Presses the Reply button of the chat. */
  | { kind: 'reply' }
  /** The reply the model streams back into the chat. */
  | { kind: 'stream'; text: string };

export interface Scene {
  id: SceneId;
  /** The title of the call window drawn behind the overlay. */
  callTitle: string;
  /** The recognition key of the other party's language, and of the language the translations are in. */
  themLanguage: string;
  targetLanguage: string;
  steps: Step[];
}

const MEETING_ID = 'sample-meeting';
const BASE = Date.UTC(2026, 10, 2, 9, 0, 0);

/** A line of the other party, as the main process reports it: first the text, then its translation. */
function them(n: number, speakerLabel: string, text: string, translatedText: string, originalText?: string): Step[] {
  const common = { speaker: 'them', speakerLabel, segmentId: `them-${n}`, timestamp: BASE + n * 9000, final: true, revision: 1 };
  return [
    { kind: 'transcript', transcript: { ...common, text, sourceText: text, translationState: 'pending', originalText } },
    { kind: 'transcript', transcript: { ...common, text, sourceText: text, translatedText, translationState: 'complete', originalText } },
  ];
}

/** The user's own speech: shown as one quiet source line, never translated. */
function mine(n: number, text: string): Step {
  return {
    kind: 'transcript',
    transcript: { speaker: 'user', speakerLabel: 'Me', segmentId: `me-${n}`, timestamp: BASE + n * 9000, final: true, text, sourceText: text, translationState: 'skipped' },
  };
}

function card(segmentId: string, kind: AgentProactiveCard['kind'], text: string): Step {
  return { kind: 'card', card: { id: `card-${segmentId}`, meetingId: MEETING_ID, segmentId, kind, text, time: BASE + 120000 } };
}

export const classScene: Scene = {
  id: 'class',
  callTitle: 'CS 201 · Hash tables and Big-O',
  themLanguage: 'english-us',
  targetLanguage: 'chinese',
  steps: [
    ...them(1, 'Lecturer', "Today: hash tables, with constant-time lookup on average.", '今天讲哈希表，平均查找是常数时间。'),
    ...them(
      2,
      'Lecturer',
      "Two keys can land on the same index. That's a collision.",
      '两个键可能落在同一个索引上，这就是冲突。',
      "Two keys can land on the same index. That's a collusion."
    ),
    mine(3, 'So what happens when two keys get the same index?'),
    ...them(4, 'Lecturer', 'The table needs a strategy, like chaining: each slot holds a linked list.', '哈希表需要冲突处理策略，比如链地址法：每个槽位存一个链表。'),
    ...them(5, 'Lecturer', 'The cost depends on the load factor: items divided by slots.', '代价取决于负载因子：元素数除以槽位数。'),
    card(
      'them-5',
      'explain_term',
      'Load factor: items divided by slots. Small means short chains and O(1) lookups; large drifts toward O(n).'
    ),
    ...them(6, 'Lecturer', 'Resize at a threshold, say 0.75: allocate a bigger array and rehash.', '超过阈值（比如0.75）就扩容：分配更大的数组并重新哈希。'),
    { kind: 'reply' },
    {
      kind: 'stream',
      text: 'Got it. So if one insert triggers an O(n) rehash, why is the amortized cost still constant? Is it because the expensive resizes get rarer as the array doubles?',
    },
  ],
};

export const clientScene: Scene = {
  id: 'client',
  callTitle: 'Product design consultation',
  themLanguage: 'french',
  targetLanguage: 'english-us',
  steps: [
    ...them(1, 'Client', "Nous voulons refaire l'application mobile de nos adhérents.", 'We want to redo our members\' mobile app.'),
    ...them(2, 'Client', 'Beaucoup abandonnent la réservation au moment du paiement.', 'Many give up on booking at the payment step.'),
    ...them(3, 'Client', "Nous aimerions un premier prototype d'ici le 15 mars.", 'We would like a first prototype by 15 March.'),
    mine(4, 'We would streamline checkout with guest payment options.'),
    ...them(
      5,
      'Client',
      "Comment gérez-vous l'authentification forte 3D Secure ?",
      'How do you handle 3D Secure strong authentication?',
      "Comment gérez-vous l'authentification fort 3D Secours ?"
    ),
    card(
      'them-5',
      'answer_question',
      'They ask how 3D Secure is handled. Say: the user retries from the same step and keeps their progress.'
    ),
    ...them(6, 'Client', 'Ce budget de quarante mille euros couvre-t-il les tests utilisateurs ?', 'Does the 40,000 euro budget cover user testing?'),
    { kind: 'reply' },
    {
      kind: 'stream',
      text: "Good question. I'd want to confirm scope before promising anything. User testing can fit within that budget, but it depends on how many rounds and participants you want. Could we agree on a lean testing round for the payment recovery flow, then confirm the numbers in writing after this call?",
    },
  ],
};

export const scenes: Record<SceneId, Scene> = { class: classScene, client: clientScene };

export const languages = {
  'english-us': { label: 'English (US)' },
  french: { label: 'French' },
  chinese: { label: 'Chinese (Simplified)' },
};
