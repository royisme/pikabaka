// MeetingPersistence.ts
// Handles meeting lifecycle: stop, save, and recovery.
// Extracted from IntelligenceManager to decouple DB operations from LLM orchestration.

import { CredentialsManager } from '../services/CredentialsManager';
import { redactConnectionError } from '../services/connectionSecrets';
import { summarizeMeeting } from './meetingSummary';
import { renameMeetingFolder } from '../agent/workspace';
import { SessionTracker, TranscriptSegment } from './SessionTracker';
import { LLMHelper } from './LLMHelper';
import { DatabaseManager, Meeting } from '../db/DatabaseManager';
import type { RAGManager } from '../rag/RAGManager';
import { refreshCommittedMeetingSummary } from '../rag/meetingSummaryIndex';
const crypto = require('crypto');

function contextFromTranscript(transcript: Array<{ speaker: string; text: string }>): string {
    return transcript.map(t => {
        const label = t.speaker === 'interviewer' ? 'INTERVIEWER' :
            t.speaker === 'user' ? 'ME' : 'ASSISTANT';
        return `[${label}]: ${t.text}`;
    }).join('\n');
}

export class MeetingPersistence {
    private session: SessionTracker;
    private llmHelper: LLMHelper;

    constructor(session: SessionTracker, llmHelper: LLMHelper, private getRAGManager: () => RAGManager | null = () => null) {
        this.session = session;
        this.llmHelper = llmHelper;
        this.session.setUsageRecorder((meetingId, usage) => {
            DatabaseManager.getInstance().addInteraction(meetingId, usage);
        });
    }

    /**
     * Creates the meeting's identity and its row before capture starts, so every assembled
     * transcript line can be written to the record as it happens. Returns the meeting id, or null
     * when the row could not be created (the meeting is then saved whole at stop, as before).
     */
    public startMeeting(metadata?: { title?: string } | null): string | null {
        const startTime = Date.now();
        let meetingId: string | null = crypto.randomUUID();
        try {
            DatabaseManager.getInstance().createMeeting({
                id: meetingId!,
                title: metadata?.title || 'Untitled Session',
                startTimeMs: startTime,
                createdAt: new Date(startTime).toISOString(),
            });
        } catch (err) {
            console.error('[MeetingPersistence] Could not create the meeting record:', (err as Error).message);
            meetingId = null;
        }
        this.session.startSession(meetingId, startTime);
        return meetingId;
    }

    /**
     * Stops the meeting immediately, snapshots data, and triggers background processing.
     * Returns immediately so UI can switch.
     */
    public async stopMeeting(stoppedAtMs: number = Date.now()): Promise<string | null> {
        console.log('[MeetingPersistence] Stopping meeting and queueing save...');

        // 0. Force-save any pending interim transcript
        this.session.flushInterimTranscript();

        // 1. Snapshot valid data BEFORE resetting
        const meetingId = this.session.getMeetingId();
        const durationMs = stoppedAtMs - this.session.getSessionStartTime();
        if (durationMs < 1000) {
            console.log("Meeting too short, ignoring.");
            if (meetingId) DatabaseManager.getInstance().deleteMeeting(meetingId);
            this.session.reset();
            return null;
        }

        const snapshot = {
            transcript: [...this.session.getFullTranscript()],
            usage: [...this.session.getFullUsage()],
            startTime: this.session.getSessionStartTime(),
            durationMs: durationMs,
            context: this.session.getFullSessionContext()
        };

        // Snapshot the title before resetting the session.
        const metadataSnapshot = this.session.getMeetingMetadata();

        // 2. Reset state immediately so new meeting can start or UI is clean
        this.session.reset();

        const savedMeetingId = meetingId ?? crypto.randomUUID();
        let fullSave = meetingId === null;

        // Commit the placeholder before background processing can finish.
        try {
            const db = DatabaseManager.getInstance();
            if (meetingId) {
                fullSave = !db.completeMeeting(meetingId, {
                    title: 'Processing...',
                    durationMs,
                    summaryJson: JSON.stringify({
                        legacySummary: 'Generating summary...',
                        detailedSummary: { actionItems: [], keyPoints: [] }
                    }),
                    isProcessed: false
                });
            }
            if (fullSave) {
                const minutes = Math.floor(durationMs / 60000);
                const seconds = ((durationMs % 60000) / 1000).toFixed(0);
                const placeholder: Meeting = {
                    id: savedMeetingId,
                    title: 'Processing...',
                    date: new Date().toISOString(),
                    duration: `${minutes}:${Number(seconds) < 10 ? '0' : ''}${seconds}`,
                    summary: 'Generating summary...',
                    detailedSummary: { actionItems: [], keyPoints: [] },
                    transcript: snapshot.transcript,
                    usage: snapshot.usage,
                    isProcessed: false
                };
                db.saveMeeting(placeholder, snapshot.startTime, durationMs);
            }
            // Notify Frontend
            const wins = require('electron').BrowserWindow.getAllWindows();
            wins.forEach((w: any) => w.webContents.send('meetings-updated'));
        } catch (e) {
            console.error('Failed to save placeholder', (e as Error).message);
        }

        this.processAndSaveMeeting(snapshot, savedMeetingId, metadataSnapshot, fullSave).catch(err => {
            console.error('[MeetingPersistence] Background processing failed:', (err as Error).message);
        });
        return savedMeetingId;
    }

    /**
     * Heavy lifting: LLM Title, Summary, and DB Write
     */
    private async processAndSaveMeeting(
        data: { transcript: TranscriptSegment[], usage: any[], startTime: number, durationMs: number, context: string },
        meetingId: string,
        metadata?: { title?: string } | null,
        fullSave = false
    ): Promise<void> {
        let title = "Untitled Session";
        let summaryData: { actionItems: string[], keyPoints: string[] } = { actionItems: [], keyPoints: [] };

        if (metadata?.title) title = metadata.title;
        const summaryUse = CredentialsManager.getInstance().resolveModelUse('summary');
        const secrets = 'connection' in summaryUse ? summaryUse.connection : undefined;

        // The summary reads the whole record in pika.db; the live session's context is compacted and lossy.
        let context = data.context;
        let lineCount = data.transcript.length;
        if (!fullSave) {
            try {
                const recorded = DatabaseManager.getInstance().getMeetingDetails(meetingId)?.transcript;
                if (recorded?.length) {
                    context = contextFromTranscript(recorded);
                    lineCount = recorded.length;
                }
            } catch (e) {
                console.error('Could not read the recorded transcript', (e as Error).message);
            }
        }

        try {
            // Generate a title only when none was provided.
            if (!metadata || !metadata.title) {
                const titlePrompt = `Generate a concise 3-6 word title for this meeting context. Output ONLY the title text. Do not use quotes or conversational filler.`;
                const generatedTitle = await this.llmHelper.generateMeetingSummary(titlePrompt, context.substring(0, 5000));
                if (generatedTitle) title = generatedTitle.replace(/["*]/g, '').trim();
            }

            // Generate Structured Summary
            if (lineCount > 2) {
                const summaryPrompt = `You are a silent meeting summarizer. Convert this conversation into concise internal meeting notes.
    
    RULES:
    - Do NOT invent information not present in the context
    - You MAY infer implied action items or next steps if they are logical consequences of the discussion
    - Do NOT explain or define concepts mentioned
    - Do NOT use filler phrases like "The meeting covered..." or "Discussed various..."
    - Do NOT mention transcripts, AI, or summaries
    - Do NOT sound like an AI assistant
    - Sound like a senior PM's internal notes
    
    STYLE: Calm, neutral, professional, skim-friendly. Short bullets, no sub-bullets.
    
    Return ONLY valid JSON (no markdown code blocks):
    {
      "overview": "1-2 sentence description of what was discussed",
      "keyPoints": ["3-6 specific bullets - each = one concrete topic or point discussed"],
      "actionItems": ["specific next steps, assigned tasks, or implied follow-ups. If absolutely none found, return empty array"]
    }`;

                const generate = (prompt: string, context: string) => this.llmHelper.generateMeetingSummary(prompt, context);
                const summary = await summarizeMeeting(context, generate, summaryPrompt, secrets);
                if (summary) summaryData = summary;
                else console.error('Failed to produce a meeting summary');
            } else {
                console.log("Transcript too short for summary generation.");
            }
        } catch (e) {
            console.error('Error generating meeting metadata', redactConnectionError(e, secrets).message);
        }

        try {
            const minutes = Math.floor(data.durationMs / 60000);
            const seconds = ((data.durationMs % 60000) / 1000).toFixed(0);
            const durationStr = `${minutes}:${Number(seconds) < 10 ? '0' : ''}${seconds}`;

            const meetingData: Meeting = {
                id: meetingId,
                title: title,
                date: new Date().toISOString(),
                duration: durationStr,
                summary: "See detailed summary",
                detailedSummary: summaryData,
                transcript: data.transcript,
                usage: data.usage,
                isProcessed: true
            };

            const db = DatabaseManager.getInstance();
            let committed = true;
            if (fullSave) {
                db.saveMeeting(meetingData, data.startTime, data.durationMs);
            } else {
                committed = db.completeMeeting(meetingId, {
                    title,
                    durationMs: data.durationMs,
                    summaryJson: JSON.stringify({
                        legacySummary: meetingData.summary,
                        detailedSummary: summaryData
                    }),
                    isProcessed: true
                });
            }
            if (committed) refreshCommittedMeetingSummary(this.getRAGManager(), meetingId);

            // The meeting folder carries the title from now on (renamed once; a missing folder is fine).
            void renameMeetingFolder(meetingId, title).catch(() => {});

            // Metadata was already snapshotted before session.reset() — nothing to clear here.

            // Notify Frontend to refresh list
            const wins = require('electron').BrowserWindow.getAllWindows();
            wins.forEach((w: any) => w.webContents.send('meetings-updated'));

        } catch (error) {
            console.error('[MeetingPersistence] Failed to save meeting:', (error as Error).message);
        }
    }

    /**
     * Recover meetings that were started but not fully processed (e.g. app crash)
     */
    public async recoverUnprocessedMeetings(): Promise<void> {
        console.log('[MeetingPersistence] Checking for unprocessed meetings...');
        const db = DatabaseManager.getInstance();
        const unprocessed = db.getUnprocessedMeetings();

        if (unprocessed.length === 0) {
            console.log('[MeetingPersistence] No unprocessed meetings found.');
            return;
        }

        console.log(`[MeetingPersistence] Found ${unprocessed.length} unprocessed meetings. recovering...`);

        for (const m of unprocessed) {
            if (m.id === this.session.getMeetingId()) continue;
            try {
                const details = db.getMeetingDetails(m.id);
                if (!details) continue;

                console.log(`[MeetingPersistence] Recovering meeting ${m.id}...`);

                const context = contextFromTranscript(details.transcript ?? []);

                const parts = (details.duration || '0:00').split(':');
                // EC-07 fix: guard against malformed duration strings (e.g. corrupted DB row)
                const mins = parseInt(parts[0]) || 0;
                const secs = parseInt(parts[1]) || 0;
                const storedDurationMs = ((mins * 60) + secs) * 1000;
                const startTime = details.startTimeMs ?? Date.parse(details.date);
                const transcript = details.transcript ?? [];
                const lastSegment = transcript[transcript.length - 1];
                const durationMs = storedDurationMs || Math.max(0, (lastSegment?.timestamp ?? startTime) - startTime);

                const snapshot = {
                    transcript: transcript as TranscriptSegment[],
                    usage: details.usage ?? [],
                    startTime: startTime,
                    durationMs: durationMs,
                    context: context
                };

                await this.processAndSaveMeeting(snapshot, m.id, {
                    title: ['Untitled Session', 'Processing...'].includes(details.title) ? undefined : details.title
                });
                console.log(`[MeetingPersistence] Recovered meeting ${m.id}`);

            } catch (e) {
                console.error(`[MeetingPersistence] Failed to recover meeting ${m.id}`, (e as Error).message);
            }
        }
    }
}
