import { LLMHelper } from "../core/LLMHelper";
import { taskPrompt } from "./prompts";

export class AnswerLLM {
    private llmHelper: LLMHelper;

    constructor(llmHelper: LLMHelper) {
        this.llmHelper = llmHelper;
    }

    /**
     * Generate a spoken answer the user could say
     */
    async generate(question: string, context?: string): Promise<string> {
        try {
            // Use LLMHelper's streamChat but collect all tokens since this method is non-streaming
            const stream = this.llmHelper.streamChat(question, undefined, context, taskPrompt('answer'));

            let fullResponse = "";
            for await (const chunk of stream) {
                fullResponse += chunk;
            }
            return fullResponse.trim();

        } catch (error) {
            console.error("[AnswerLLM] Generation failed:", error);
            return "";
        }
    }
}
