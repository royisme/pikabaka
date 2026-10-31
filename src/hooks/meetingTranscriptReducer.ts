import type { SetStateAction } from 'react';
import {
  translationEnabledAfterEvent,
  upsertTranscriptSegment,
  type TranscriptDisplayMode,
  type TranscriptEventForSegment,
  type TranscriptSegment,
} from '../lib/transcriptSegments';

/**
 * State of the transcript hook that changes from more than one place: the rows, the line being
 * spoken, and the translation settings read back from the main process. The reducer is the only
 * writer; the hook dispatches the event it saw.
 */
export interface MeetingTranscriptState {
  transcriptSegments: TranscriptSegment[];
  isThemSpeaking: boolean;
  currentThemPartial: string;
  /** What the user is saying now; the live line shows whoever spoke last. */
  myPartial: string;
  liveSpeaker: 'them' | 'user';
  transcriptDisplayMode: TranscriptDisplayMode;
  translationEnabled: boolean;
  targetLanguage: string;
  sourceLanguage: string;
  theirLanguage: string;
  myLanguage: string;
}

export const initialMeetingTranscriptState: MeetingTranscriptState = {
  transcriptSegments: [],
  isThemSpeaking: false,
  currentThemPartial: '',
  myPartial: '',
  liveSpeaker: 'them',
  transcriptDisplayMode: 'original',
  translationEnabled: false,
  targetLanguage: 'chinese',
  sourceLanguage: 'auto',
  theirLanguage: 'english-us',
  myLanguage: 'english-us',
};

/** The fields a settings read-back or a header change can carry; a missing field keeps its value. */
export interface TranscriptSettingsPatch {
  enabled?: boolean;
  targetLanguage?: string;
  displayMode?: TranscriptDisplayMode;
  sourceLanguage?: string;
}

export type MeetingTranscriptAction =
  | { type: 'segmentUpserted'; event: TranscriptEventForSegment; now: number }
  | { type: 'themPartial'; text: string }
  | { type: 'mePartial'; text: string }
  | { type: 'meArrival'; event: TranscriptEventForSegment; now: number }
  | { type: 'meSpeakingEnded' }
  | { type: 'themArrival'; event: TranscriptEventForSegment; now: number; displayMode?: TranscriptDisplayMode }
  | { type: 'themSpeakingEnded' }
  | { type: 'settingsChanged'; patch: TranscriptSettingsPatch }
  | { type: 'sttLanguageLoaded'; speaker: 'them' | 'user'; language: string }
  | { type: 'displayModeChanged'; mode: SetStateAction<TranscriptDisplayMode> };

/** The one live line: the partial of whoever spoke last, with the label the row will get. */
export function livePartialOf(state: MeetingTranscriptState): { label: 'Me' | 'Them'; text: string } | null {
  if (state.liveSpeaker === 'user') return state.myPartial ? { label: 'Me', text: state.myPartial } : null;
  return state.isThemSpeaking ? { label: 'Them', text: state.currentThemPartial } : null;
}

function resolve<T>(current: T, next: SetStateAction<T>): T {
  return typeof next === 'function' ? (next as (previous: T) => T)(current) : next;
}

export function meetingTranscriptReducer(
  state: MeetingTranscriptState,
  action: MeetingTranscriptAction
): MeetingTranscriptState {
  switch (action.type) {
    case 'segmentUpserted':
      return { ...state, transcriptSegments: upsertTranscriptSegment(state.transcriptSegments, action.event, action.now) };
    case 'themPartial':
      return { ...state, isThemSpeaking: true, currentThemPartial: action.text, liveSpeaker: 'them' };
    case 'mePartial':
      return { ...state, myPartial: action.text, liveSpeaker: 'user' };
    case 'meSpeakingEnded':
      return { ...state, myPartial: '', liveSpeaker: 'them' };
    case 'meArrival':
      // Own speech is never translated, so its `skipped` says nothing about whether translation is on.
      return {
        ...state,
        transcriptSegments: upsertTranscriptSegment(state.transcriptSegments, action.event, action.now),
        myPartial: '',
        liveSpeaker: 'them',
      };
    case 'themArrival':
      return {
        ...state,
        transcriptSegments: upsertTranscriptSegment(state.transcriptSegments, action.event, action.now),
        isThemSpeaking: false,
        currentThemPartial: '',
        transcriptDisplayMode: action.displayMode ?? state.transcriptDisplayMode,
        translationEnabled: translationEnabledAfterEvent(state.translationEnabled, action.event.translationState),
      };
    case 'themSpeakingEnded':
      return { ...state, isThemSpeaking: false };
    case 'settingsChanged': {
      const { patch } = action;
      return {
        ...state,
        transcriptDisplayMode: patch.displayMode ?? state.transcriptDisplayMode,
        translationEnabled: patch.enabled ?? state.translationEnabled,
        targetLanguage: patch.targetLanguage ?? state.targetLanguage,
        sourceLanguage: patch.sourceLanguage ?? state.sourceLanguage,
      };
    }
    case 'sttLanguageLoaded':
      return action.speaker === 'them'
        ? { ...state, theirLanguage: action.language }
        : { ...state, myLanguage: action.language };
    case 'displayModeChanged':
      return { ...state, transcriptDisplayMode: resolve(state.transcriptDisplayMode, action.mode) };
  }
}
