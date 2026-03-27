import { LLMHelper } from "../core/LLMHelper";
import { CLARIFY_MODE_PROMPT } from "./prompts";

export class ClarifyLLM {
    private llmHelper: LLMHelper;

    constructor(llmHelper: LLMHelper) {
        this.llmHelper = llmHelper;
    }

    /**
     * Generate a clarification question
     */
    async generate(context: string): Promise<string> {
        if (!context.trim()) return "";
        try {
            const stream = this.llmHelper.streamChat(context, undefined, undefined, CLARIFY_MODE_PROMPT);
            let fullResponse = "";
            for await (const chunk of stream) fullResponse += chunk;
            return fullResponse.trim();
        } catch (error) {
            console.error("[ClarifyLLM] Generation failed:", error);
            return "";
        }
    }

    /**
     * Generate a clarification question (Streamed)
     */
    async *generateStream(context: string): AsyncGenerator<string> {
        if (!context.trim()) return;
        try {
            yield* this.llmHelper.streamChat(context, undefined, undefined, CLARIFY_MODE_PROMPT);
        } catch (error) {
            console.error("[ClarifyLLM] Streaming generation failed:", error);
        }
    }
}
