// electron/rag/TranscriptPreprocessor.ts
// Enhanced transcript cleaning for RAG - extends existing transcriptCleaner.ts patterns
// Adds semantic detection (questions, decisions, action items)

export interface RawSegment {
    speaker: string;
    text: string;
    timestamp: number;  // ms
}

export interface CleanedSegment {
    speaker: string;
    text: string;
    startMs: number;
    endMs: number;
    isQuestion: boolean;
    isDecision: boolean;
    isActionItem: boolean;
}

// Filler words to remove (extended from transcriptCleaner.ts)
const FILLERS = new Set([
    'uh', 'um', 'ah', 'hmm', 'hm', 'er', 'erm',
    'like', 'you know', 'i mean', 'basically', 'actually',
    'so', 'well', 'anyway', 'anyways'
]);

const ACKNOWLEDGEMENTS = new Set([
    'okay', 'ok', 'yeah', 'yes', 'right', 'sure', 'got it',
    'gotcha', 'uh-huh', 'uh huh', 'mm-hmm', 'mm hmm', 'mhm',
    'cool', 'great', 'nice', 'perfect', 'alright', 'all right'
]);

// Detection patterns for semantic markers
const QUESTION_PATTERNS = [
    /\?$/,
    /^(what|who|when|where|why|how|can|could|would|should|is|are|do|does|did)\b/i
];

const DECISION_PATTERNS = [
    /\b(decided|agreed|confirmed|approved|let's go with|we'll do|going with)\b/i
];

const ACTION_PATTERNS = [
    /\b(will|going to|need to|should|must|action item|todo|follow up|follow-up)\b/i,
    /\b(by|before|deadline|next week|tomorrow|end of day|eod)\b/i
];

/**
 * Clean a single text segment - remove fillers and normalize
 */
function cleanText(text: string): string {
    let result = text.trim();

    // Remove repeated words (yeah yeah, okay okay)
    result = result.replace(/\b(\w+)(\s+\1)+\b/gi, '$1');

    // Split into words and filter fillers
    const words = result.split(/\s+/);
    const cleaned = words.filter(word => {
        const normalized = word.toLowerCase().replace(/[.,!?;:]/g, '');
        return !FILLERS.has(normalized) && !ACKNOWLEDGEMENTS.has(normalized);
    });

    // Reconstruct
    result = cleaned.join(' ').trim();

    // Clean up punctuation
    result = result.replace(/\s+([.,!?;:])/g, '$1');
    result = result.replace(/([.,!?;:])+/g, '$1');
    result = result.replace(/\s+/g, ' ');

    return result;
}

/**
 * Normalize speaker labels for consistency
 */
function normalizeSpeaker(speaker: string): string {
    const lower = speaker.toLowerCase();
    if (lower === 'interviewer' || lower === 'speaker') {
        return 'Speaker';
    }
    if (lower === 'user' || lower === 'me') {
        return 'You';
    }
    if (lower === 'assistant' || lower === 'pika' || lower === 'natively') {
        return 'Pika';
    }
    // Keep original if it looks like a name
    return speaker;
}

/**
 * Check if text contains a question
 */
function detectQuestion(text: string): boolean {
    return QUESTION_PATTERNS.some(pattern => pattern.test(text));
}

/**
 * Check if text contains a decision marker
 */
function detectDecision(text: string): boolean {
    return DECISION_PATTERNS.some(pattern => pattern.test(text));
}

/**
 * Check if text contains an action item marker
 */
function detectActionItem(text: string): boolean {
    return ACTION_PATTERNS.some(pattern => pattern.test(text));
}

/**
 * Merge consecutive segments from the same speaker
 * This reduces fragmentation from real-time transcription
 */
function mergeConsecutiveSpeakerSegments(
    segments: RawSegment[]
): { speaker: string; text: string; startMs: number; endMs: number }[] {
    if (segments.length === 0) return [];

    const merged: { speaker: string; text: string; startMs: number; endMs: number }[] = [];
    let current = {
        speaker: segments[0].speaker,
        text: segments[0].text,
        startMs: segments[0].timestamp,
        endMs: segments[0].timestamp
    };

    for (let i = 1; i < segments.length; i++) {
        const seg = segments[i];
        const gap = seg.timestamp - current.endMs;

        // Merge if same speaker and gap < 5 seconds
        if (seg.speaker === current.speaker && gap < 5000) {
            current.text += ' ' + seg.text;
            current.endMs = seg.timestamp;
        } else {
            merged.push(current);
            current = {
                speaker: seg.speaker,
                text: seg.text,
                startMs: seg.timestamp,
                endMs: seg.timestamp
            };
        }
    }

    merged.push(current);
    return merged;
}

/**
 * Main preprocessing pipeline
 * Takes raw transcript segments and returns cleaned, annotated segments
 */
export function preprocessTranscript(segments: RawSegment[]): CleanedSegment[] {
    if (segments.length === 0) return [];

    // 1. Merge consecutive segments from same speaker
    const merged = mergeConsecutiveSpeakerSegments(segments);

    // 2. Clean and annotate each segment
    const cleaned: CleanedSegment[] = [];

    for (const seg of merged) {
        const text = cleanText(seg.text);

        // Skip if too short after cleaning (less than 3 words)
        const wordCount = text.split(/\s+/).filter(w => w.length > 0).length;
        if (wordCount < 3) continue;

        cleaned.push({
            speaker: normalizeSpeaker(seg.speaker),
            text,
            startMs: seg.startMs,
            endMs: seg.endMs,
            isQuestion: detectQuestion(text),
            isDecision: detectDecision(text),
            isActionItem: detectActionItem(text)
        });
    }

    return cleaned;
}

/**
 * Estimate token count for a text string
 * Rough estimate: 1 token ≈ 4 characters for English
 */
export function estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
}
