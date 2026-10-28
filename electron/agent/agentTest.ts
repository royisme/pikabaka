import { redactConnectionError } from '../services/connectionSecrets';
import { classifyTranslationError } from '../transcript/translationError';
import { buildAgentModel } from './models';
import { loadAgentRuntime } from './loader';
import type { Connection } from '../services/aiConnections';

export interface AgentTestResult {
  success: boolean;
  /** What the model answered to the plain question. */
  reply?: string;
  /** Whether the model asked to use a tool when it was offered one; null when this was not checked. */
  toolCalls?: boolean | null;
  totalMs?: number;
  error?: string;
}

const TEXT_QUESTION = 'Reply with the single word: ready';
const TOOL_QUESTION = 'Call the echo tool with the word "ping". Do not answer in text.';

function describe(connection: Connection, error: unknown, errorMessage?: string): string {
  const message = redactConnectionError(errorMessage ?? error, connection).message.replace(/\s+/g, ' ').slice(0, 300);
  const status = Number((error as { status?: unknown } | null)?.status);
  return `${classifyTranslationError(error ?? errorMessage)}${Number.isFinite(status) ? ` (HTTP ${status})` : ''}: ${message}`;
}

/**
 * Runs the agent's model the way the agent does (same connection, same registration with pi-ai) on two
 * invented questions: a plain one, then one that offers a tool. The text of the questions is fixed and
 * invented; provider messages still need secret redaction.
 */
export async function testAgentModel(connection: Connection, modelId: string, supportsImages: boolean): Promise<AgentTestResult> {
  const startedAt = Date.now();
  try {
    const runtime = await loadAgentRuntime();
    const { models, ref } = await buildAgentModel(connection, modelId, supportsImages);
    const model = models.getModel(ref.provider, ref.modelId);
    if (!model) return { success: false, error: 'The model could not be registered.' };

    const plain = await models.complete(model, {
      systemPrompt: 'You are a connection test.',
      messages: [{ role: 'user', content: TEXT_QUESTION, timestamp: Date.now() }],
    });
    if (plain.stopReason === 'error' || plain.stopReason === 'aborted') {
      return { success: false, totalMs: Date.now() - startedAt, error: describe(connection, undefined, plain.errorMessage ?? `The request ended with ${plain.stopReason}.`) };
    }
    const reply = plain.content.flatMap((part) => (part.type === 'text' ? [part.text] : [])).join('').trim();

    // The agent needs tools: a model that cannot call one will fail a real question.
    let toolCalls: boolean | null = null;
    try {
      const withTool = await models.complete(model, {
        systemPrompt: 'You are a connection test.',
        messages: [{ role: 'user', content: TOOL_QUESTION, timestamp: Date.now() }],
        tools: [{ name: 'echo', description: 'Returns the word it is given.', parameters: runtime.Type.Object({ word: runtime.Type.String() }) }],
      });
      toolCalls = withTool.stopReason === 'error' ? false : withTool.content.some((part) => part.type === 'toolCall');
    } catch {
      toolCalls = false;
    }
    return { success: true, reply: reply || '(no text)', toolCalls, totalMs: Date.now() - startedAt };
  } catch (error: unknown) {
    return { success: false, totalMs: Date.now() - startedAt, error: describe(connection, error) };
  }
}
