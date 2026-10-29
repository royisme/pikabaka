import { LLMHelper } from "../core/LLMHelper";
import { taskPrompt, buildCodeHintMessage } from "./prompts";

export class CodeHintLLM {
    private llmHelper: LLMHelper;

    constructor(llmHelper: LLMHelper) {
        this.llmHelper = llmHelper;
    }

    async *generateStream(
        imagePaths?: string[],
        questionContext?: string,
        questionSource?: 'screenshot' | 'transcript' | null,
        transcriptContext?: string
    ): AsyncGenerator<string> {
        try {
            const message = buildCodeHintMessage(
                questionContext ?? null,
                questionSource ?? null,
                transcriptContext ?? null
            );

            yield* this.llmHelper.streamChat(
                message,
                imagePaths,
                undefined,
                taskPrompt('codeHint')
            );
        } catch (error) {
            console.error("[CodeHintLLM] Stream failed:", error);
            yield "I couldn't analyze the screenshot. Make sure your code is visible and try again.";
        }
    }
}
