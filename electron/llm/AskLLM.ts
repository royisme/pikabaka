import { LLMHelper } from "../core/LLMHelper";
import { taskPrompt } from "./prompts";

export class AskLLM {
    private llmHelper: LLMHelper;

    constructor(llmHelper: LLMHelper) {
        this.llmHelper = llmHelper;
    }

    /**
     * Generate the question to ask
     */
    async generate(context: string): Promise<string> {
        if (!context.trim()) return "";
        try {
            const stream = this.llmHelper.streamChat(context, undefined, undefined, taskPrompt('ask'));
            let fullResponse = "";
            for await (const chunk of stream) fullResponse += chunk;
            return fullResponse.trim();
        } catch (error) {
            console.error("[AskLLM] Generation failed:", error);
            return "";
        }
    }

    /**
     * Generate the question to ask (Streamed)
     */
    async *generateStream(context: string): AsyncGenerator<string> {
        if (!context.trim()) return;
        try {
            yield* this.llmHelper.streamChat(context, undefined, undefined, taskPrompt('ask'));
        } catch (error) {
            console.error("[AskLLM] Streaming generation failed:", error);
        }
    }
}
