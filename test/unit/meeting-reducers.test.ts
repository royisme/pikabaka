import t from 'tap';
import { initialMeetingChatFlags, meetingChatFlagsReducer } from '../../src/hooks/meetingChatFlagsReducer';
import { initialMeetingTranscriptState, livePartialOf, meetingTranscriptReducer } from '../../src/hooks/meetingTranscriptReducer';

/**
 * The reducers are the only writers of the overlay's live state, so their transitions are checked
 * directly. Every line of transcript text here is invented for the test.
 */

const partial = 'We can review the blue widget on Tuesday.';
const final = 'We can review the blue widget on Tuesday.';
const translation = '我们可以在周二评审蓝色部件。';

t.test('the transcript reducer owns the live line and the translation settings', async (t) => {
  let state = meetingTranscriptReducer(initialMeetingTranscriptState, { type: 'themPartial', text: partial });
  t.equal(state.isThemSpeaking, true, 'a partial line marks the other party as speaking');
  t.equal(state.currentThemPartial, partial);
  t.equal(state.transcriptSegments.length, 0, 'a partial line is not a row');

  state = meetingTranscriptReducer(state, {
    type: 'themArrival',
    now: 1000,
    event: {
      final: true,
      text: final,
      segmentId: 'invented-1',
      speaker: 'them',
      timestamp: 1,
      translationState: 'complete',
      translatedText: translation,
    },
    displayMode: 'both',
  });
  t.equal(state.isThemSpeaking, false, 'an arrival ends the speaking line');
  t.equal(state.currentThemPartial, '');
  t.equal(state.transcriptSegments.length, 1);
  t.equal(state.transcriptSegments[0].sourceText, final);
  t.equal(state.transcriptSegments[0].speakerLabel, 'Them');
  t.equal(state.transcriptSegments[0].translatedText, translation);
  t.equal(state.transcriptDisplayMode, 'both', 'the arrival carries the mode the request started with');
  t.equal(state.translationEnabled, true, 'a translated arrival turns translation on');

  state = meetingTranscriptReducer(state, { type: 'themSpeakingEnded' });
  t.equal(state.isThemSpeaking, false);

  state = meetingTranscriptReducer(state, {
    type: 'settingsChanged',
    patch: { enabled: false, targetLanguage: 'japanese' },
  });
  t.equal(state.translationEnabled, false);
  t.equal(state.targetLanguage, 'japanese');
  t.equal(state.sourceLanguage, 'auto', 'a field the patch omits keeps its value');
  t.equal(state.transcriptDisplayMode, 'both', 'the patch does not touch the mode');

  state = meetingTranscriptReducer(state, { type: 'sttLanguageLoaded', speaker: 'them', language: 'korean' });
  t.equal(state.theirLanguage, 'korean');
  t.equal(state.myLanguage, 'english-us', 'the other speaker keeps their own language');

  state = meetingTranscriptReducer(state, {
    type: 'displayModeChanged',
    mode: (mode) => (mode === 'both' ? 'original' : mode),
  });
  t.equal(state.transcriptDisplayMode, 'original', 'the exposed setter still accepts a value or an updater');
});

t.test('the chat flags reducer tracks one answer request', async (t) => {
  let state = meetingChatFlagsReducer(initialMeetingChatFlags, { type: 'processingChanged', value: true });
  t.equal(state.isProcessing, true);
  t.equal(state.canRetry, false, 'a running request does not offer retry by itself');

  state = meetingChatFlagsReducer(state, { type: 'retryChanged', canRetry: true });
  t.same(state, { isProcessing: true, canRetry: true });

  state = meetingChatFlagsReducer(state, { type: 'processingChanged', value: false });
  t.same(state, { isProcessing: false, canRetry: true }, 'the finished request keeps its retry');
});

t.test('the live line shows whoever spoke last, and the user has one too', async (t) => {
  let state = meetingTranscriptReducer(initialMeetingTranscriptState, { type: 'mePartial', text: partial });
  t.same(livePartialOf(state), { label: 'Me', text: partial }, 'the user\'s partial is shown with the Me label');
  t.equal(state.transcriptSegments.length, 0, 'a partial line is not a row');

  state = meetingTranscriptReducer(state, { type: 'themPartial', text: 'Invented reply.' });
  t.same(livePartialOf(state), { label: 'Them', text: 'Invented reply.' }, 'the latest speaker wins');

  state = meetingTranscriptReducer(state, { type: 'mePartial', text: 'Invented question?' });
  t.same(livePartialOf(state), { label: 'Me', text: 'Invented question?' });

  state = meetingTranscriptReducer(state, {
    type: 'meArrival',
    now: 1000,
    event: { final: true, text: final, segmentId: 'invented-me-1', speaker: 'user', speakerLabel: 'Me', timestamp: 1, translationState: 'skipped' },
  });
  t.equal(state.myPartial, '', 'the row replaces the user\'s live line');
  t.equal(state.transcriptSegments.length, 1);
  t.equal(state.transcriptSegments[0].speakerLabel, 'Me');
  t.same(livePartialOf(state), { label: 'Them', text: 'Invented reply.' }, 'the other party\'s line shows again');
  t.equal(state.translationEnabled, false, 'own speech does not turn translation on');
});

t.test('a stale user line can be ended without a row', async (t) => {
  let state = meetingTranscriptReducer(initialMeetingTranscriptState, { type: 'mePartial', text: partial });
  state = meetingTranscriptReducer(state, { type: 'themPartial', text: 'Invented reply.' });
  state = meetingTranscriptReducer(state, { type: 'mePartial', text: 'Invented question?' });
  state = meetingTranscriptReducer(state, { type: 'meSpeakingEnded' });
  t.equal(state.myPartial, '');
  t.same(livePartialOf(state), { label: 'Them', text: 'Invented reply.' });
  state = meetingTranscriptReducer(initialMeetingTranscriptState, { type: 'mePartial', text: partial });
  state = meetingTranscriptReducer(state, { type: 'meSpeakingEnded' });
  t.equal(livePartialOf(state), null, 'nothing is left on the live line');
});
