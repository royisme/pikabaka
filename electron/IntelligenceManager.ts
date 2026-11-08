// IntelligenceManager.ts
// Thin facade that delegates to focused sub-modules.
// Maintains full backward compatibility — all existing callers continue to work unchanged.
//
// Sub-modules:
//   SessionTracker     — state, transcript arrays, context management, epoch compaction
//   IntelligenceEngine — LLM mode routing (6 modes), event emission
//   MeetingPersistence — meeting stop/save/recovery

import { EventEmitter } from 'events';
import { LLMHelper } from './core/LLMHelper';
import { SessionTracker } from './core/SessionTracker';
import { IntelligenceEngine } from './core/IntelligenceEngine';
import { MeetingPersistence } from './core/MeetingPersistence';
import type { MeetingStartMetadata, MeetingUsage } from './db/types';
import type { RAGManager } from './rag/RAGManager';

// Re-export types for backward compatibility
export type { TranscriptSegment, ContextItem } from './core/SessionTracker';
export type { IntelligenceMode, IntelligenceModeEvents } from './core/IntelligenceEngine';

/**
 * IntelligenceManager - Facade for the intelligence layer.
 * 
 * Delegates to:
 * - SessionTracker:     context, transcripts, epoch summaries
 * - IntelligenceEngine: LLM modes (assist, followUp, catchUp, ask, manual)
 * - MeetingPersistence: meeting stop/save/recovery
 */
export class IntelligenceManager extends EventEmitter {
    private session: SessionTracker;
    private engine: IntelligenceEngine;
    private persistence: MeetingPersistence;

    constructor(llmHelper: LLMHelper, getRAGManager: () => RAGManager | null = () => null) {
        super();
        this.session = new SessionTracker();
        this.engine = new IntelligenceEngine(llmHelper, this.session);
        this.persistence = new MeetingPersistence(this.session, llmHelper, getRAGManager);

        // Forward all engine events through the facade
        this.forwardEngineEvents();
    }

    /**
     * Forward all events from IntelligenceEngine through this facade
     * so existing listeners on IntelligenceManager continue to work.
     */
    private forwardEngineEvents(): void {
        const events = [
            'assist_update',
            'refined_answer', 'refined_answer_token',
            'catch_up', 'catch_up_token', 'ask', 'ask_token',
            'manual_answer_started', 'manual_answer_result',
            'mode_changed', 'error'
        ];

        for (const event of events) {
            this.engine.on(event, (...args: unknown[]) => {
                this.emit(event, ...args);
            });
        }
    }

    // ============================================
    // LLM Initialization (delegates to engine)
    // ============================================

    initializeLLMs(): void {
        // Cancel any in-flight streams before swapping LLM clients
        this.engine.reset();
        this.engine.initializeLLMs();
    }

    reinitializeLLMs(): void {
        this.engine.reset();
        this.engine.reinitializeLLMs();
    }

    // ============================================
    // Context Management (delegates to session)
    // ============================================

    setMeetingMetadata(metadata: MeetingStartMetadata | null): void {
        this.session.setMeetingMetadata(metadata);
    }

    addTranscript(segment: import('./core/SessionTracker').TranscriptSegment, skipRefinementCheck: boolean = false): void {
        if (skipRefinementCheck) {
            // Direct add without refinement detection
            this.session.addTranscript(segment);
        } else {
            // Let the engine handle transcript + refinement detection
            this.engine.handleTranscript(segment, false);
        }
    }

    addAssistantMessage(text: string): void {
        this.session.addAssistantMessage(text);
    }

    getContext(lastSeconds: number = 120) {
        return this.session.getContext(lastSeconds);
    }

    getLastAssistantMessage(): string | null {
        return this.session.getLastAssistantMessage();
    }

    getFormattedContext(lastSeconds: number = 120): string {
        return this.session.getFormattedContext(lastSeconds);
    }

    getLastThemTurn(): string | null {
        return this.session.getLastThemTurn();
    }

    logUsage(type: MeetingUsage['type'], question: string, answer: string): void {
        this.session.logUsage(type, question, answer);
    }

    // ============================================
    // Transcript Handling (delegates to engine)
    // ============================================

    handleTranscript(segment: import('./core/SessionTracker').TranscriptSegment): void {
        this.engine.handleTranscript(segment);
    }

    // ============================================
    // Mode Executors (delegates to engine)
    // ============================================

    async runAssistMode(): Promise<string | null> {
        return this.engine.runAssistMode();
    }

    async runFollowUp(intent: string, userRequest?: string): Promise<string | null> {
        return this.engine.runFollowUp(intent, userRequest);
    }

    async runCatchUp(): Promise<string | null> {
        return this.engine.runCatchUp();
    }

    async runAsk(): Promise<string | null> {
        return this.engine.runAsk();
    }

    async runManualAnswer(question: string): Promise<string | null> {
        return this.engine.runManualAnswer(question);
    }

    // ============================================
    // State Management
    // ============================================

    getActiveMode() {
        return this.engine.getActiveMode();
    }

    setMode(mode: import('./core/IntelligenceEngine').IntelligenceMode): void {
        this.engine.setMode(mode);
    }

    // ============================================
    // Meeting Lifecycle (delegates to persistence)
    // ============================================

    startMeeting(metadata?: MeetingStartMetadata): string | null {
        return this.persistence.startMeeting(metadata);
    }

    async stopMeeting(stoppedAtMs: number = Date.now()): Promise<string | null> {
        // An answer still streaming belongs to the meeting that just ended: its tokens reach whichever
        // overlay is listening, which after a restart is the empty one of the next meeting.
        this.engine.cancelGeneration();
        return this.persistence.stopMeeting(stoppedAtMs);
    }

    async recoverUnprocessedMeetings(): Promise<void> {
        return this.persistence.recoverUnprocessedMeetings();
    }

    // ============================================
    // Reset (resets all sub-modules)
    // ============================================

    /**
     * resetEngine: Cancel in-flight LLM streams WITHOUT touching session state.
     * Use this when swapping API keys or providers mid-session so the transcript
     * is not wiped. (full reset() also clears the session — only use that at
     * end of meeting or explicit session teardown.)
     */
    resetEngine(): void {
        this.engine.reset();
    }

    /** Stops the answer being generated, keeping the session. */
    cancelGeneration(): void {
        this.engine.cancelGeneration();
    }

    reset(): void {
        this.session.reset();
        this.engine.reset();
    }
}
