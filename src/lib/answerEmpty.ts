import type { AudioStatusKey } from './audioStatus';

export type AnswerEmptyHint = {
  before: string;
  /** Which of the user's own shortcuts to show as a key badge after `before`, if any. */
  key: 'reply' | 'selectiveScreenshot' | null;
  after: string;
};

/**
 * The one line the empty answer area shows. It says what the area is for in the current audio
 * state, so an empty area is small and tells the reader what will happen.
 */
export function answerEmptyHint(status: AudioStatusKey, hasTranscriptRows = false): AnswerEmptyHint {
  switch (status) {
    case 'no-audio':
      // With lines already on screen their words are not missing: only new sound is.
      return hasTranscriptRows
        ? { before: 'No new sound from the call. You can still ask about what was said.', key: null, after: '' }
        : { before: 'Reply needs their words first. Type a question to ask anyway.', key: null, after: '' };
    case 'listening':
      return { before: 'When they ask something, press ', key: 'reply', after: ' for a reply.' };
    case 'live':
      return { before: 'Press ', key: 'reply', after: ' after a question for a reply.' };
    case 'stopped':
      return { before: 'You can still type a question or attach a screenshot ', key: 'selectiveScreenshot', after: '.' };
    case 'off':
    case 'starting':
    case 'waiting':
      return { before: 'Ask about your screen now, or wait for the call.', key: null, after: '' };
  }
}
