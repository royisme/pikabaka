// Summarises a whole meeting transcript in parts. The old summary cut the transcript at 10,000
// characters, so anything said later in a long call never reached it. Here every part is read, each
// part is turned into notes, and the notes are merged. Nothing here logs transcript text.

export interface SummaryData {
    overview?: string;
    keyPoints: string[];
    actionItems: string[];
}

type Generate = (systemPrompt: string, context: string) => Promise<string>;

const CHUNK_CHARS = 9000;

export const PARTIAL_PROMPT = `You are reading one part of a longer meeting. Extract what a later reader must not lose: decisions, numbers, names, dates, commitments and open questions.

RULES:
- Do NOT invent information that is not in the text; owners and dates only when they were spoken
- Short bullets, one concrete fact each, no explanations of concepts

Return ONLY valid JSON (no markdown code blocks):
{
  "keyPoints": ["up to 10 specific bullets from this part"],
  "actionItems": ["tasks, next steps or follow-ups from this part; empty array if none"]
}`;

export const MERGE_PROMPT = `You are a silent meeting summarizer. The context is a list of notes taken from consecutive parts of ONE meeting, in order. Merge them into concise internal meeting notes that keep the decisions, numbers, names and dates from every part, including the beginning, the middle and the end.

RULES:
- Do NOT invent information that is not in the notes
- Drop repetition; keep every distinct decision and action item
- Do NOT use filler phrases like "The meeting covered..." or "Discussed various..."
- Do NOT mention transcripts, AI, or summaries
- Sound like a senior PM's internal notes. Short bullets, no sub-bullets.

Return ONLY valid JSON (no markdown code blocks):
{
  "overview": "1-2 sentence description of what was discussed",
  "keyPoints": ["3-10 specific bullets, each one concrete topic, decision or point"],
  "actionItems": ["specific next steps, assigned tasks or follow-ups; empty array if none"]
}`;

/** Splits on line boundaries into parts of about `size` characters; a line longer than that is cut. */
export function splitIntoChunks(text: string, size: number = CHUNK_CHARS): string[] {
    const chunks: string[] = [];
    let current = '';
    for (const rawLine of text.split('\n')) {
        let line = rawLine;
        while (line.length > size) {
            if (current) { chunks.push(current); current = ''; }
            chunks.push(line.slice(0, size));
            line = line.slice(size);
        }
        if (current && current.length + line.length + 1 > size) {
            chunks.push(current);
            current = '';
        }
        current = current ? `${current}\n${line}` : line;
    }
    if (current.trim()) chunks.push(current);
    return chunks;
}

export function parseSummary(generated: string): SummaryData | null {
    const match = generated.match(/```json\n([\s\S]*?)\n```/);
    try {
        const value = JSON.parse((match ? match[1] : generated).trim());
        if (typeof value !== 'object' || value === null) return null;
        const strings = (list: unknown) => (Array.isArray(list) ? list.filter((item): item is string => typeof item === 'string') : []);
        return {
            ...(typeof value.overview === 'string' ? { overview: value.overview } : {}),
            keyPoints: strings(value.keyPoints),
            actionItems: strings(value.actionItems),
        };
    } catch {
        return null;
    }
}

/**
 * `single` is the prompt for a transcript that fits in one part. A longer one is read part by part
 * and merged. A part that fails is skipped; if none succeeds the result is null.
 */
export async function summarizeMeeting(context: string, generate: Generate, single: string): Promise<SummaryData | null> {
    const chunks = splitIntoChunks(context);
    if (chunks.length <= 1) {
        const generated = await generate(single, context);
        return generated ? parseSummary(generated) : null;
    }
    const notes: SummaryData[] = [];
    for (let index = 0; index < chunks.length; index++) {
        try {
            const generated = await generate(PARTIAL_PROMPT, chunks[index]);
            const parsed = generated ? parseSummary(generated) : null;
            if (parsed) notes.push(parsed);
            else console.warn(`[MeetingSummary] Part ${index + 1} of ${chunks.length} gave no usable notes`);
        } catch (error) {
            console.warn(`[MeetingSummary] Part ${index + 1} of ${chunks.length} failed:`, (error as Error).message);
        }
    }
    if (notes.length === 0) return null;
    const merged = notes
        .map((part, index) => `Part ${index + 1}\nKey points:\n${part.keyPoints.map(point => `- ${point}`).join('\n')}\nAction items:\n${part.actionItems.map(item => `- ${item}`).join('\n') || '- none'}`)
        .join('\n\n');
    const generated = await generate(MERGE_PROMPT, merged);
    return generated ? parseSummary(generated) : null;
}
