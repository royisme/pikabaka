import { EventEmitter } from 'events';
import type { TranscriptSegment } from './SessionTracker';
import { QuestionDetector, QuestionDetection } from './QuestionDetector';
import { SettingsManager, AutoAnswerMode, AutoAnswerSettings } from '../services/SettingsManager';

export type { AutoAnswerMode, AutoAnswerSettings } from '../services/SettingsManager';
export type AutoAnswerStatus = 'off' | 'detecting' | 'detected' | 'generating' | 'answered' | 'skipped' | 'error';

export interface AutoAnswerState {
    mode: AutoAnswerMode;
    status: AutoAnswerStatus;
    question?: string;
    confidence?: number;
    type?: QuestionDetection['type'];
    reason?: string;
    answer?: string | null;
    error?: string;
    updatedAt: number;
}

type AnswerRunner = (question: string, confidence: number, imagePaths?: string[]) => Promise<string | null>;

type AutoAnswerControllerEvents = {
    auto_answer_settings_changed: (settings: AutoAnswerSettings) => void;
    auto_answer_question_detected: (detection: QuestionDetection, settings: AutoAnswerSettings) => void;
    auto_answer_generation_started: (detection: QuestionDetection) => void;
    auto_answer_complete: (payload: { detection: QuestionDetection; answer: string | null }) => void;
    auto_answer_error: (payload: { detection?: QuestionDetection; error: string }) => void;
    auto_answer_skipped: (payload: { detection: QuestionDetection; reason: string }) => void;
};

export const DEFAULT_AUTO_ANSWER_SETTINGS: AutoAnswerSettings = {
    mode: 'off',
    minConfidence: 0.62,
    cooldownMs: 12_000,
    includeRecentScreenshots: false,
};

export function normalizeAutoAnswerSettings(raw: Partial<AutoAnswerSettings> | undefined | null): AutoAnswerSettings {
    const mode = raw?.mode === 'detect_only' || raw?.mode === 'auto_answer' || raw?.mode === 'off'
        ? raw.mode
        : DEFAULT_AUTO_ANSWER_SETTINGS.mode;
    const minConfidence = typeof raw?.minConfidence === 'number' && Number.isFinite(raw.minConfidence)
        ? Math.min(0.95, Math.max(0.4, raw.minConfidence))
        : DEFAULT_AUTO_ANSWER_SETTINGS.minConfidence;
    const cooldownMs = typeof raw?.cooldownMs === 'number' && Number.isFinite(raw.cooldownMs)
        ? Math.min(120_000, Math.max(3_000, raw.cooldownMs))
        : DEFAULT_AUTO_ANSWER_SETTINGS.cooldownMs;
    return {
        mode,
        minConfidence,
        cooldownMs,
        includeRecentScreenshots: raw?.includeRecentScreenshots === true,
    };
}

export class AutoAnswerController extends EventEmitter {
    private readonly detector = new QuestionDetector();
    private settings: AutoAnswerSettings;
    private state: AutoAnswerState;
    private activeDetection: QuestionDetection | null = null;
    private lastGenerationAt = 0;
    private screenshotProvider: () => string[] = () => [];

    constructor(private readonly answerRunner: AnswerRunner) {
        super();
        this.settings = normalizeAutoAnswerSettings(SettingsManager.getInstance().get('autoAnswer'));
        this.state = { mode: this.settings.mode, status: this.settings.mode === 'off' ? 'off' : 'detecting', updatedAt: Date.now() };
    }

    public on<K extends keyof AutoAnswerControllerEvents>(eventName: K, listener: AutoAnswerControllerEvents[K]): this {
        return super.on(eventName, listener as (...args: any[]) => void);
    }

    public emit<K extends keyof AutoAnswerControllerEvents>(eventName: K, ...args: Parameters<AutoAnswerControllerEvents[K]>): boolean {
        return super.emit(eventName, ...args);
    }

    public getSettings(): AutoAnswerSettings {
        this.settings = normalizeAutoAnswerSettings(SettingsManager.getInstance().get('autoAnswer'));
        return { ...this.settings };
    }

    public setSettings(patch: Partial<AutoAnswerSettings>): AutoAnswerSettings {
        const merged = normalizeAutoAnswerSettings({ ...this.getSettings(), ...patch });
        SettingsManager.getInstance().set('autoAnswer', merged);
        this.settings = merged;
        if (merged.mode === 'off') {
            this.activeDetection = null;
            this.detector.reset();
        }
        this.state = {
            ...this.state,
            mode: merged.mode,
            status: merged.mode === 'off' ? 'off' : 'detecting',
            updatedAt: Date.now(),
        };
        this.emit('auto_answer_settings_changed', this.getSettings());
        return this.getSettings();
    }

    public setScreenshotProvider(provider: () => string[]): void {
        this.screenshotProvider = provider;
    }

    public getState(): AutoAnswerState {
        return { ...this.state };
    }

    public reset(): void {
        this.detector.reset();
        this.activeDetection = null;
        this.state = { mode: this.getSettings().mode, status: this.getSettings().mode === 'off' ? 'off' : 'detecting', updatedAt: Date.now() };
    }

    public handleTranscript(segment: TranscriptSegment): void {
        const settings = this.getSettings();
        if (settings.mode === 'off') {
            this.state = { mode: settings.mode, status: 'off', updatedAt: Date.now() };
            return;
        }

        const detection = this.detector.detect(segment);
        if (!detection || detection.confidence < settings.minConfidence) {
            this.state = { ...this.state, mode: settings.mode, status: 'detecting', updatedAt: Date.now() };
            return;
        }

        this.state = {
            mode: settings.mode,
            status: 'detected',
            question: detection.question,
            confidence: detection.confidence,
            type: detection.type,
            reason: detection.reason,
            updatedAt: Date.now(),
        };
        this.emit('auto_answer_question_detected', detection, settings);

        if (settings.mode !== 'auto_answer') return;

        const now = Date.now();
        if (now - this.lastGenerationAt < settings.cooldownMs) {
            this.state = { ...this.state, status: 'skipped', updatedAt: now };
            this.emit('auto_answer_skipped', { detection, reason: 'cooldown' });
            return;
        }
        if (this.activeDetection) {
            this.state = { ...this.state, status: 'skipped', updatedAt: now };
            this.emit('auto_answer_skipped', { detection, reason: 'generation already in progress' });
            return;
        }

        this.activeDetection = detection;
        this.lastGenerationAt = now;
        this.state = { ...this.state, status: 'generating', updatedAt: now };
        this.emit('auto_answer_generation_started', detection);

        const imagePaths = settings.includeRecentScreenshots ? this.screenshotProvider().slice(-3) : undefined;
        void this.answerRunner(detection.question, detection.confidence, imagePaths)
            .then((answer) => {
                if (this.activeDetection !== detection) return;
                this.activeDetection = null;
                this.state = {
                    mode: this.getSettings().mode,
                    status: 'answered',
                    question: detection.question,
                    confidence: detection.confidence,
                    type: detection.type,
                    reason: detection.reason,
                    answer,
                    updatedAt: Date.now(),
                };
                this.emit('auto_answer_complete', { detection, answer });
            })
            .catch((error) => {
                if (this.activeDetection !== detection) return;
                this.activeDetection = null;
                const message = error instanceof Error ? error.message : String(error || 'Auto Answer failed');
                this.state = {
                    mode: this.getSettings().mode,
                    status: 'error',
                    question: detection.question,
                    confidence: detection.confidence,
                    type: detection.type,
                    reason: detection.reason,
                    error: message,
                    updatedAt: Date.now(),
                };
                this.emit('auto_answer_error', { detection, error: message });
            });
    }
}
