export type AudioStatusInput = {
  meetingActive: boolean;
  isConnected: boolean;
  hasRecentSystemAudioChunk: boolean;
  hasRecentThemTranscript: boolean;
  lastError: string | null;
  /** When the meeting became active; null if it is not. */
  activeSince: number | null;
  /** When "connected, but no audio chunk and no transcript" began; null if that is not the case. */
  noSystemAudioSince: number | null;
  now: number;
  /** Name of the language translations are shown in, when translation is on. */
  translateInto?: string;
};

export type AudioStatusKey = 'off' | 'starting' | 'waiting' | 'listening' | 'live' | 'no-audio' | 'stopped';
export type AudioStatusLevel = 'info' | 'ok' | 'warn' | 'blocking';

export type AudioStatus = {
  key: AudioStatusKey;
  level: AudioStatusLevel;
  dot: 'neutral' | 'success' | 'warn' | 'danger';
  /** The status chip's words, and a form of at most 12 characters for narrow windows. */
  chip: string;
  chipShort: string;
  /** What an empty transcript area says; null when there are rows to show. */
  zone: { title: string | null; body: string } | null;
  action: 'fix-audio' | 'open-pika' | null;
  /** The real error text, for a details view; never shown as the main message. */
  detail: string | null;
};

/** A connection that has not come up after this long is a failure, not a slow start (the main process starts audio 5 to 7 s after the overlay opens). */
export const STARTUP_GRACE_MS = 10_000;
/** Connected but silent for this long: nothing is reaching Pika. */
export const NO_AUDIO_AFTER_MS = 8_000;

const PERMISSION_HELP = 'Check that Pika has Screen & System Audio Recording permission.';

/** One answer to "is Pika hearing the call", from the facts the main process reports. */
export function audioStatus(input: AudioStatusInput): AudioStatus {
  const detail = input.lastError?.trim() || null;
  const sinceStart = input.activeSince === null ? 0 : input.now - input.activeSince;

  if (!input.meetingActive) {
    return {
      key: 'off', level: 'info', dot: 'neutral', chip: 'Not listening', chipShort: 'Idle',
      zone: { title: null, body: 'Not listening. Start a meeting from the Pika window.' },
      action: 'open-pika', detail: null,
    };
  }

  if (!input.isConnected) {
    if (!detail && sinceStart < STARTUP_GRACE_MS) {
      return {
        key: 'starting', level: 'info', dot: 'neutral', chip: 'Starting audio…', chipShort: 'Starting…',
        zone: { title: null, body: 'Connecting to call audio. This takes a few seconds.' },
        action: null, detail: null,
      };
    }
    return stopped(detail);
  }

  if (input.hasRecentThemTranscript) {
    return { key: 'live', level: 'ok', dot: 'success', chip: 'Live', chipShort: 'Live', zone: null, action: null, detail: null };
  }

  if (input.hasRecentSystemAudioChunk) {
    const into = input.translateInto ? ` in ${input.translateInto}` : '';
    return {
      key: 'listening', level: 'info', dot: 'neutral', chip: 'Listening', chipShort: 'Listening',
      zone: { title: null, body: `Listening. Their words appear here${into}.` },
      action: null, detail: null,
    };
  }

  if (detail) return stopped(detail);

  if (input.noSystemAudioSince !== null && input.now - input.noSystemAudioSince >= NO_AUDIO_AFTER_MS) {
    return {
      key: 'no-audio', level: 'warn', dot: 'warn', chip: 'No call audio', chipShort: 'No audio',
      zone: {
        title: 'No sound from the call yet.',
        body: `If they are talking, Pika is not receiving it. Check that the call plays on your output device. ${PERMISSION_HELP}`,
      },
      action: 'fix-audio', detail: null,
    };
  }

  return {
    key: 'waiting', level: 'info', dot: 'neutral', chip: 'Waiting for audio', chipShort: 'Waiting…',
    zone: { title: null, body: 'Waiting for sound from the call.' },
    action: null, detail: null,
  };
}

function stopped(detail: string | null): AudioStatus {
  return {
    key: 'stopped', level: 'blocking', dot: 'danger', chip: 'Transcription stopped', chipShort: 'Stopped',
    zone: { title: 'Transcription stopped.', body: detail ? truncate(detail, 160) : PERMISSION_HELP },
    action: 'fix-audio', detail,
  };
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}
