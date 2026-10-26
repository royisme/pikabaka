import type { AudioStatusKey } from './audioStatus';

export type AnswerEmptyHint = {
  before: string;
  /** Which of the user's own shortcuts to show as a key badge after `before`, if any. */
  key: 'whatToAnswer' | 'selectiveScreenshot' | null;
  after: string;
};

/**
 * The one line the empty answer area shows. It says what the area is for in the current audio
 * state, so an empty area is small and tells the reader what will happen.
 */
export function answerEmptyHint(status: AudioStatusKey): AnswerEmptyHint {
  switch (status) {
    case 'no-audio':
      return { before: 'What to say needs their words first. Type a question to ask anyway.', key: null, after: '' };
    case 'listening':
      return { before: 'When they ask something, press ', key: 'whatToAnswer', after: ' for what to say.' };
    case 'live':
      return { before: 'Press ', key: 'whatToAnswer', after: ' after a question for what to say.' };
    case 'stopped':
      return { before: 'You can still type a question or attach a screenshot ', key: 'selectiveScreenshot', after: '.' };
    case 'off':
    case 'starting':
    case 'waiting':
      return { before: 'Ask about your screen now, or wait for the call.', key: null, after: '' };
  }
}
