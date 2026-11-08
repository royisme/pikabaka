/** Interpreting settings kept in the credentials file (the same owner as transcriptCorrection*). */

export const VOICE_PROVIDERS = ['fishaudio', 'elevenlabs'] as const;
export type VoiceProviderId = typeof VOICE_PROVIDERS[number];

export interface VoiceChoice { voiceId: string; cloned: boolean; consentAt?: string }

/** What the renderer sees. The Fish Audio key is never part of it. */
export interface InterpretingSettings {
    enabled: boolean;
    noticeAcceptedAt?: string;
    provider: VoiceProviderId;
    voices: Partial<Record<VoiceProviderId, VoiceChoice>>;
    outputLabel: string;
}

export interface InterpretingCredentials {
    interpretingEnabled?: boolean;
    interpretingNoticeAcceptedAt?: string;
    interpretingProvider?: VoiceProviderId;
    fishAudioApiKey?: string;
    interpretingVoices?: Partial<Record<VoiceProviderId, VoiceChoice>>;
    interpretingOutputLabel?: string;
}

export function readInterpreting(c: InterpretingCredentials): InterpretingSettings {
    return {
        enabled: c.interpretingEnabled || false,
        noticeAcceptedAt: c.interpretingNoticeAcceptedAt,
        provider: c.interpretingProvider || 'fishaudio',
        voices: c.interpretingVoices || {},
        outputLabel: c.interpretingOutputLabel || '',
    };
}

export function applyInterpreting(c: InterpretingCredentials, patch: Partial<InterpretingSettings>): void {
    if (patch.enabled !== undefined) c.interpretingEnabled = patch.enabled;
    if (patch.noticeAcceptedAt !== undefined) c.interpretingNoticeAcceptedAt = patch.noticeAcceptedAt;
    if (patch.provider !== undefined) c.interpretingProvider = patch.provider;
    if (patch.voices !== undefined) c.interpretingVoices = patch.voices;
    if (patch.outputLabel !== undefined) c.interpretingOutputLabel = patch.outputLabel;
}

const isProvider = (value: unknown): value is VoiceProviderId => VOICE_PROVIDERS.some(id => id === value);

/** Checks a renderer payload field by field and throws the first problem; nothing is applied on a throw. */
export function parseInterpretingPatch(input: unknown): Partial<InterpretingSettings> {
    if (typeof input !== 'object' || input === null) throw new Error('Interpreting settings must be an object.');
    const raw = input as Record<string, unknown>;
    const patch: Partial<InterpretingSettings> = {};
    if (raw.enabled !== undefined) {
        if (typeof raw.enabled !== 'boolean') throw new Error('Interpreting "enabled" must be true or false.');
        patch.enabled = raw.enabled;
    }
    if (raw.noticeAcceptedAt !== undefined) {
        if (typeof raw.noticeAcceptedAt !== 'string') throw new Error('Interpreting "noticeAcceptedAt" must be a string.');
        patch.noticeAcceptedAt = raw.noticeAcceptedAt;
    }
    if (raw.provider !== undefined) {
        if (!isProvider(raw.provider)) throw new Error(`Unknown voice service: ${String(raw.provider)}. Use ${VOICE_PROVIDERS.join(' or ')}.`);
        patch.provider = raw.provider;
    }
    if (raw.outputLabel !== undefined) {
        if (typeof raw.outputLabel !== 'string') throw new Error('Interpreting "outputLabel" must be a string.');
        patch.outputLabel = raw.outputLabel;
    }
    if (raw.voices !== undefined) {
        if (typeof raw.voices !== 'object' || raw.voices === null) throw new Error('Interpreting "voices" must be an object.');
        const voices: Partial<Record<VoiceProviderId, VoiceChoice>> = {};
        for (const [id, value] of Object.entries(raw.voices)) {
            if (!isProvider(id)) throw new Error(`Unknown voice service: ${id}. Use ${VOICE_PROVIDERS.join(' or ')}.`);
            const v = value as Partial<VoiceChoice> | null;
            if (!v || typeof v.voiceId !== 'string' || typeof v.cloned !== 'boolean' || (v.consentAt !== undefined && typeof v.consentAt !== 'string')) {
                throw new Error(`The ${id} voice needs a text voiceId and a true or false cloned.`);
            }
            voices[id] = v.consentAt === undefined ? { voiceId: v.voiceId, cloned: v.cloned } : { voiceId: v.voiceId, cloned: v.cloned, consentAt: v.consentAt };
        }
        patch.voices = voices;
    }
    return patch;
}
