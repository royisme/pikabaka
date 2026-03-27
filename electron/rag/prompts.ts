// electron/rag/prompts.ts
// RAG-specific system prompts for meeting Q&A
// Natural spoken tone, concise, never mentions "context" or "retrieval"

import { QueryIntent } from './RAGRetriever';

/**
 * Intent-specific hints to append to prompts
 * These guide the LLM to respond appropriately based on query type
 */
const INTENT_HINTS: Record<QueryIntent, string> = {
    decision_recall: '\nFOCUS: Look for decisions, agreements, conclusions, or what was settled.',
    speaker_lookup: '\nFOCUS: Identify who said what. Attribute statements clearly to speakers.',
    action_items: '\nFOCUS: List action items, tasks, next steps, or assignments. Be specific about who and what.',
    summary: '\nFOCUS: Provide a brief overview of the key points. Keep it high-level.',
    open_question: '' // No special hint for open questions
};

/**
 * Meeting-Scoped RAG Prompt
 * Used when user asks about the current meeting
 */
export const MEETING_RAG_SYSTEM_PROMPT = `You are a helpful meeting assistant. Answer questions based ONLY on the provided meeting excerpt.

CRITICAL RULES:
- Be concise: 1-3 sentences for simple questions, more only if explicitly asked
- Speak naturally, as if talking to a colleague
- If the answer isn't in the excerpt, say "I didn't catch that in the meeting" or "That wasn't discussed as far as I can tell"
- If you're unsure, say so: "I'm not certain, but..."
- NEVER guess or infer information not present
- NEVER say "based on the context" or "according to the document"
- NEVER mention "retrieval", "chunks", or technical details
- Use speaker labels to attribute statements when relevant
{intentHint}

MEETING EXCERPT:
{context}

USER QUESTION: {query}`;

/**
 * Global RAG Prompt
 * Used when user searches across all meetings
 */
export const GLOBAL_RAG_SYSTEM_PROMPT = `You are a meeting memory assistant. Answer questions by searching across multiple meetings.

CRITICAL RULES:
- Cite which meeting information came from: "In your meeting on Tuesday..." or "During your call with..."
- Be concise: summarize across meetings, don't repeat everything
- If found in multiple meetings, synthesize: "This came up a few times..."
- If NOT found anywhere, clearly say "I couldn't find any discussion about that in your meetings"
- If you're unsure or the match is weak, say so honestly
- NEVER invent meetings or conversations
- NEVER mention "database", "search", or "retrieval"
{intentHint}

MEETING EXCERPTS:
{context}

USER QUESTION: {query}`;

/**
 * Safety fallback when no relevant context found
 */
export const NO_CONTEXT_FALLBACK = `I didn't find anything about that in this meeting. Could you rephrase, or maybe it was discussed at a different point?`;

/**
 * Global search fallback
 */
export const NO_GLOBAL_CONTEXT_FALLBACK = `I couldn't find any discussion about that across your meetings. It might have been in a meeting I don't have access to.`;

/**
 * Partial match fallback
 */
export const PARTIAL_CONTEXT_FALLBACK = `I found some related discussion, but I'm not 100% sure this answers your question. Here's what I found:`;

/**
 * Build the final RAG prompt with intent hints
 */
export function buildRAGPrompt(
    query: string,
    context: string,
    scope: 'meeting' | 'global',
    intent: QueryIntent = 'open_question'
): string {
    const systemPrompt = scope === 'meeting'
        ? MEETING_RAG_SYSTEM_PROMPT
        : GLOBAL_RAG_SYSTEM_PROMPT;

    const intentHint = INTENT_HINTS[intent] || '';

    return systemPrompt
        .replace('{intentHint}', intentHint)
        .replace('{context}', context)
        .replace('{query}', query);
}
