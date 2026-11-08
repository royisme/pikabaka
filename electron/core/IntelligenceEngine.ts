// IntelligenceEngine.ts
// LLM mode routing and orchestration.
// Extracted from IntelligenceManager to decouple LLM logic from state management.

import { EventEmitter } from 'events';
import { LLMHelper } from './LLMHelper';
import { SessionTracker, TranscriptSegment, ContextItem } from './SessionTracker';
import { AnswerLLM, AssistLLM, AskLLM, FollowUpLLM, RecapLLM } from '../llm';

// Mode types
export type IntelligenceMode = 'idle' | 'assist' | 'follow_up' | 'catch_up' | 'ask' | 'manual';

// Refinement intent detection (refined to avoid false positives)
function detectRefinementIntent(userText: string): { isRefinement: boolean; intent: string } {
    const lowercased = userText.toLowerCase().trim();
    const refinementPatterns = [
        { pattern: /make it longer|expand on this|elaborate more/i, intent: 'expand' },
        { pattern: /rephrase that|say it differently|put it another way/i, intent: 'rephrase' },
        { pattern: /give me an example|provide an instance/i, intent: 'add_example' },
        { pattern: /make it more confident|be more assertive|sound stronger/i, intent: 'more_confident' },
        { pattern: /make it casual|be less formal|sound relaxed/i, intent: 'more_casual' },
        { pattern: /make it formal|be more professional|sound professional/i, intent: 'more_formal' },
        { pattern: /simplify this|make it simpler|explain specifically/i, intent: 'simplify' },
    ];

    for (const { pattern, intent } of refinementPatterns) {
        if (pattern.test(lowercased)) {
            return { isRefinement: true, intent };
        }
    }

    return { isRefinement: false, intent: '' };
}

// Events emitted by IntelligenceEngine
export interface IntelligenceModeEvents {
    'assist_update': (insight: string) => void;
    'refined_answer': (answer: string, intent: string) => void;
    'refined_answer_token': (token: string, intent: string) => void;
    'catch_up': (summary: string) => void;
    'catch_up_token': (token: string) => void;
    'ask': (question: string) => void;
    'ask_token': (token: string) => void;
    'manual_answer_started': () => void;
    'manual_answer_result': (answer: string, question: string) => void;
    'mode_changed': (mode: IntelligenceMode) => void;
    'error': (error: Error, mode: IntelligenceMode) => void;
}

export class IntelligenceEngine extends EventEmitter {
    // Mode state
    private activeMode: IntelligenceMode = 'idle';

    // Mode-specific LLMs
    private answerLLM: AnswerLLM | null = null;
    private assistLLM: AssistLLM | null = null;
    private askLLM: AskLLM | null = null;
    private followUpLLM: FollowUpLLM | null = null;
    private recapLLM: RecapLLM | null = null;

    // Concurrency tracking
    private assistCancellationToken: AbortController | null = null;
    private currentGenerationId: number = 0;
    // Each run claims ++currentGenerationId before its first await; a run that no longer holds it writes nothing
    // (no token, session row, usage or final event) and never sets the mode the newer run owns.

    // Keep reference to LLMHelper for client access
    private llmHelper: LLMHelper;

    // Reference to SessionTracker for context
    private session: SessionTracker;

    // Timestamps for tracking
    private lastTranscriptTime: number = 0;

    constructor(llmHelper: LLMHelper, session: SessionTracker) {
        super();
        this.llmHelper = llmHelper;
        this.session = session;
        this.initializeLLMs();
    }

    getLLMHelper(): LLMHelper {
        return this.llmHelper;
    }

    getRecapLLM(): RecapLLM | null {
        return this.recapLLM;
    }

    // ============================================
    // LLM Initialization
    // ============================================

    /**
     * Initialize or Re-Initialize mode-specific LLMs with shared Gemini client and Groq client
     * Must be called after API keys are updated.
     */
    initializeLLMs(): void {
        console.log(`[IntelligenceEngine] Initializing LLMs with LLMHelper`);
        this.answerLLM = new AnswerLLM(this.llmHelper);
        this.assistLLM = new AssistLLM(this.llmHelper);
        this.askLLM = new AskLLM(this.llmHelper);
        this.followUpLLM = new FollowUpLLM(this.llmHelper);
        this.recapLLM = new RecapLLM(this.llmHelper);

        // Sync RecapLLM reference to SessionTracker for epoch compaction
        this.session.setRecapLLM(this.recapLLM);
    }

    reinitializeLLMs(): void {
        this.initializeLLMs();
    }

    // ============================================
    // Transcript Handling (delegates to SessionTracker)
    // ============================================

    /**
     * Process transcript from native audio, and trigger follow-up if appropriate
     */
    handleTranscript(segment: TranscriptSegment, skipRefinementCheck: boolean = false): void {
        const result = this.session.handleTranscript(segment);
        this.lastTranscriptTime = Date.now();

        // Check for follow-up intent if user is speaking
        if (result && !skipRefinementCheck && result.role === 'user' && this.session.getLastAssistantMessage()) {
            const { isRefinement, intent } = detectRefinementIntent(segment.text.trim());
            if (isRefinement) {
                this.runFollowUp(intent, segment.text.trim());
            }
        }
    }

    // ============================================
    // Mode Executors
    // ============================================

    /**
     * MODE 1: Assist (Passive)
     * Low-priority observational insights
     */
    async runAssistMode(): Promise<string | null> {
        if (this.activeMode !== 'idle' && this.activeMode !== 'assist') {
            return null;
        }

        const isCurrent = this.beginRun();

        if (this.assistCancellationToken) {
            this.assistCancellationToken.abort();
        }

        this.assistCancellationToken = new AbortController();
        this.setMode('assist');

        try {
            if (!this.assistLLM) {
                this.setMode('idle');
                return null;
            }

            const context = this.session.getFormattedContext(60);
            if (!context) {
                this.setMode('idle');
                return null;
            }

            const insight = await this.assistLLM.generate(context);

            // A stale run says nothing and leaves the mode of the newer run alone.
            if (!isCurrent()) return null;
            if (this.assistCancellationToken?.signal.aborted) {
                return null;
            }

            if (insight) {
                this.emit('assist_update', insight);
            }
            this.setMode('idle');
            return insight;

        } catch (error) {
            if (!isCurrent()) return null;
            if ((error as Error).name === 'AbortError') {
                return null;
            }
            this.emit('error', error as Error, 'assist');
            this.setMode('idle');
            return null;
        }
    }

    /**
     * MODE 3: Follow-Up (Refinement)
     * Modify the last assistant message
     */
    async runFollowUp(intent: string, userRequest?: string): Promise<string | null> {
        console.log(`[IntelligenceEngine] runFollowUp called with intent: ${intent}`);
        const lastMsg = this.session.getLastAssistantMessage();
        if (!lastMsg) {
            console.warn('[IntelligenceEngine] No lastAssistantMessage found for follow-up');
            return null;
        }

        const isCurrent = this.beginRun();
        this.setMode('follow_up');

        try {
            if (!this.followUpLLM) {
                console.error('[IntelligenceEngine] FollowUpLLM not initialized');
                this.setMode('idle');
                return null;
            }

            const context = this.session.getFormattedContext(60);
            const refinementRequest = userRequest || intent;

            let fullRefined = "";
            const stream = this.followUpLLM.generateStream(
                lastMsg,
                refinementRequest,
                context
            );
            let streamAborted = false;

            for await (const token of stream) {
                if (!isCurrent()) {
                    console.log('[IntelligenceEngine] _follow_up stream aborted by new generation');
                    // Leaving the loop closes the generator; the newer run owns the mode, the session and the final event.
                    streamAborted = true;
                    break;
                }
                this.emit('refined_answer_token', token, intent);
                fullRefined += token;
            }

            if (!isCurrent()) return null;
            if (!streamAborted && fullRefined) {
                this.session.addAssistantMessage(fullRefined);
                this.emit('refined_answer', fullRefined, intent);

                const intentMap: Record<string, string> = {
                    'expand': 'Expand Answer',
                    'rephrase': 'Rephrase Answer',
                    'add_example': 'Add Example',
                    'more_confident': 'Make More Confident',
                    'more_casual': 'Make More Casual',
                    'more_formal': 'Make More Formal',
                    'simplify': 'Simplify Answer'
                };

                const displayQuestion = userRequest || intentMap[intent] || `Refining: ${intent}`;

                this.session.pushUsage({
                    type: 'followup',
                    timestamp: Date.now(),
                    question: displayQuestion,
                    answer: fullRefined
                });
            }

            if (!isCurrent()) return null;
            this.setMode('idle');
            return fullRefined;

        } catch (error) {
            if (!isCurrent()) return null;
            this.emit('error', error as Error, 'follow_up');
            this.setMode('idle');
            return null;
        }
    }

    /**
     * MODE 4: Catch up (Summary)
     * Neutral conversation summary
     */
    async runCatchUp(): Promise<string | null> {
        console.log('[IntelligenceEngine] runCatchUp called');
        const isCurrent = this.beginRun();
        this.setMode('catch_up');

        try {
            if (!this.recapLLM) {
                console.error('[IntelligenceEngine] RecapLLM not initialized');
                this.setMode('idle');
                return null;
            }

            const context = this.session.getFormattedContext(300);
            if (!context) {
                console.warn('[IntelligenceEngine] No context available for catch up');
                this.setMode('idle');
                return null;
            }

            let fullSummary = "";
            const stream = this.recapLLM.generateStream(context);
            let streamAborted = false;

            for await (const token of stream) {
                if (!isCurrent()) {
                    console.log('[IntelligenceEngine] _catch_up stream aborted by new generation');
                    streamAborted = true;
                    break;
                }
                this.emit('catch_up_token', token);
                fullSummary += token;
            }

            // An iterator that ends after a cancel yields no token, so the run is checked again before writing.
            if (!isCurrent()) return null;
            if (!streamAborted && fullSummary) {
                this.emit('catch_up', fullSummary);

                this.session.pushUsage({
                    type: 'chat',
                    timestamp: Date.now(),
                    question: 'Catch up',
                    answer: fullSummary
                });
            }
            this.setMode('idle');
            return fullSummary;

        } catch (error) {
            if (!isCurrent()) return null;
            this.emit('error', error as Error, 'catch_up');
            this.setMode('idle');
            return null;
        }
    }

    /**
     * MODE: Ask
     * The one question the user should ask the other party next
     */
    async runAsk(): Promise<string | null> {
        console.log('[IntelligenceEngine] runAsk called');
        const isCurrent = this.beginRun();
        this.setMode('ask');

        try {
            if (!this.askLLM) {
                console.error('[IntelligenceEngine] AskLLM not initialized');
                this.setMode('idle');
                return null;
            }

            const rawContext = this.session.getFormattedContext(180);
            // If no transcript yet, use a generic prompt — the LLM will ask a scoping question
            const context = rawContext || '[No transcript available yet. The user just joined the conversation. Generate an opening question to understand the scope of the conversation.]';

            let fullQuestion = "";
            const stream = this.askLLM.generateStream(context);
            let streamAborted = false;

            for await (const token of stream) {
                if (!isCurrent()) {
                    console.log('[IntelligenceEngine] _ask stream aborted by new generation');
                    streamAborted = true;
                    break;
                }
                this.emit('ask_token', token);
                fullQuestion += token;
            }

            // The iterator can also end while cancelled without yielding a token, so the id is checked here too.
            if (streamAborted || !isCurrent()) return null;

            // Only update history and emit final if not aborted
            if (fullQuestion && isCurrent()) {
                this.emit('ask', fullQuestion);
                this.session.addAssistantMessage(fullQuestion);

                this.session.pushUsage({
                    type: 'chat',
                    timestamp: Date.now(),
                    question: 'Ask',
                    answer: fullQuestion
                });
            }
            this.setMode('idle');
            return fullQuestion;

        } catch (error) {
            if (!isCurrent()) return null;
            this.emit('error', error as Error, 'ask');
            this.setMode('idle');
            return null;
        }
    }

    /**
     * MODE 5: Manual Answer (Fallback)
     * Explicit bypass when auto-detection fails
     */
    async runManualAnswer(question: string): Promise<string | null> {
        this.emit('manual_answer_started');
        const isCurrent = this.beginRun();
        this.setMode('manual');

        try {
            if (!this.answerLLM) {
                this.setMode('idle');
                return null;
            }

            const context = this.session.getFormattedContext(120);
            const answer = await this.answerLLM.generate(question, context);

            // A stale run writes nothing: no session row, no usage, no answer, no mode change.
            if (!isCurrent()) return null;
            if (answer) {
                this.session.addAssistantMessage(answer);
                this.emit('manual_answer_result', answer, question);

                this.session.pushUsage({
                    type: 'chat',
                    timestamp: Date.now(),
                    question: question,
                    answer: answer
                });
            }

            this.setMode('idle');
            return answer;

        } catch (error) {
            if (!isCurrent()) return null;
            this.emit('error', error as Error, 'manual');
            this.setMode('idle');
            return null;
        }
    }

    // ============================================
    // State Management
    // ============================================

    /**
     * Claims this run's generation id. A run that no longer holds it writes nothing
     * (no token, session row, usage or final event) and never sets the mode the newer run owns.
     */
    private beginRun(): () => boolean {
        const generation = ++this.currentGenerationId;
        return () => this.currentGenerationId === generation;
    }

    private setMode(mode: IntelligenceMode): void {
        if (this.activeMode !== mode) {
            this.activeMode = mode;
            this.emit('mode_changed', mode);
        }
    }

    getActiveMode(): IntelligenceMode {
        return this.activeMode;
    }

    /**
     * Reset engine state (cancels any in-flight operations)
     */
    /**
     * Stops whatever answer is being generated: every stream loop compares its generation id with this one
     * at the next token and ends itself. The session history is left alone.
     */
    cancelGeneration(): void {
        this.activeMode = 'idle';
        this.currentGenerationId++; // Increment to break all active LLM streams
        if (this.assistCancellationToken) {
            this.assistCancellationToken.abort();
            this.assistCancellationToken = null;
        }
    }

    reset(): void {
        this.cancelGeneration();
    }
}
