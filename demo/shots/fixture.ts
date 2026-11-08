// Sample content, invented for illustration. No real meeting, person or product appears here.
// The types come from the app's own IPC types: a change to them fails `tsc` here.
import type { AgentEvent, AgentProactiveCard, ElectronAPI } from '../../src/types/electron';

type Transcript = Parameters<Parameters<ElectronAPI['onNativeAudioTranscript']>[0]>[0];

export type SceneId = 'class' | 'client';

/** One step of the replay. The runner feeds each one through the event or the control the app already has. */
export type Step =
  | { kind: 'transcript'; transcript: Transcript }
  | { kind: 'card'; card: AgentProactiveCard }
  /** Presses the "ask the agent about this line" button of the row with this segment id. */
  | { kind: 'askLine'; segmentId: string }
  /** Presses "Not right" on the card. */
  | { kind: 'notRight' }
  /** Adds text at the end of the chat input, then sends it. */
  | { kind: 'submit'; append: string }
  /** The agent's reply to the submitted question. */
  | { kind: 'agent'; events: AgentEvent[] };

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

function answer(text: string): Step {
  const events: AgentEvent[] = [
    { meetingId: MEETING_ID, type: 'run_started' },
    { meetingId: MEETING_ID, type: 'text_final', text },
    { meetingId: MEETING_ID, type: 'run_settled' },
  ];
  return { kind: 'agent', events };
}

export const classScene: Scene = {
  id: 'class',
  callTitle: 'CS 201 · Hash tables and Big-O',
  themLanguage: 'english-us',
  targetLanguage: 'chinese',
  steps: [
    ...them(1, 'Lecturer', 'Today we look at hash tables, and why they are fast.', '今天我们讲哈希表，以及它为什么快。'),
    ...them(
      2,
      'Lecturer',
      'A hash table maps a key to a bucket with a hash function.',
      '哈希表用哈希函数把键映射到一个桶。',
      'A hash cable maps a key to a bucket with a hash function.'
    ),
    ...them(3, 'Lecturer', 'Lookup is O(1) on average, but O(n) in the worst case.', '查找平均是 O(1)，最坏情况是 O(n)。'),
    mine(4, 'So a collision is what makes it slow?'),
    ...them(5, 'Lecturer', 'Right. We handle collisions with chaining or open addressing.', '对。处理冲突可以用链地址法或开放寻址法。'),
    card(
      'them-5',
      'explain_term',
      'Open addressing: on a collision, the table probes other slots in a fixed order (linear probing, for example) until it finds a free one. No linked lists are used.'
    ),
    { kind: 'submit', append: 'Chaining or open addressing: which is faster in practice?' },
    answer(
      'Open addressing is often faster on small tables: probing stays cache friendly. Chaining degrades more gently at a high load factor. Name both and state the trade-off.'
    ),
  ],
};

export const clientScene: Scene = {
  id: 'client',
  callTitle: 'Product design consultation',
  themLanguage: 'french',
  targetLanguage: 'chinese',
  steps: [
    ...them(
      1,
      'Client',
      "Bonjour, merci pour votre temps. Nous voulons refondre l'application de réservation de nos salles de sport.",
      '你好，谢谢你的时间。我们想重新设计健身房的预约应用。'
    ),
    ...them(2, 'Client', "Trop d'adhérents abandonnent la réservation au moment du paiement.", '太多会员在支付环节放弃了预约。'),
    ...them(3, 'Client', "Pourriez-vous nous présenter une première maquette d'ici le 15 mars ?", '你们能在3月15日前给我们看第一版设计稿吗？'),
    card(
      'them-3',
      'answer_question',
      'They ask for a first mock-up by 15 March. A safe reply: yes for the booking and payment screens, the other screens a week later.'
    ),
    { kind: 'askLine', segmentId: 'them-3' },
    { kind: 'submit', append: 'which screens does the first mock-up need to cover?' },
    answer('They named the booking flow and the payment step, where members drop out. Start the mock-up with those two screens.'),
    ...them(4, 'Client', 'Parfait. Je vous envoie le cahier des charges demain matin.', '好的。我明天上午把需求文档发给你们。'),
    { kind: 'notRight' },
  ],
};

export const scenes: Record<SceneId, Scene> = { class: classScene, client: clientScene };

export const languages = {
  'english-us': { label: 'English (US)' },
  french: { label: 'French' },
  chinese: { label: 'Chinese (Simplified)' },
};
