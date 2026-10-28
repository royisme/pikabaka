import { DatabaseManager, type Meeting } from '../db/DatabaseManager';
import type { RAGManager } from './RAGManager';

export function buildMeetingSummaryText(meeting: Pick<Meeting, 'detailedSummary'>): string {
    const summary = meeting.detailedSummary;
    // Placeholder/legacy text and the overview are not part of the summary index.
    return [
        ...(summary?.keyPoints || []).filter(point => point.trim()),
        ...(summary?.actionItems || []).filter(item => item.trim()).map(item => `Action: ${item}`)
    ].join('. ');
}

export function refreshCommittedMeetingSummary(ragManager: RAGManager | null, meetingId: string): void {
    if (!ragManager) return;
    try {
        const meeting = DatabaseManager.getInstance().getMeetingDetails(meetingId);
        if (!meeting) return;
        ragManager.refreshMeetingSummary(meetingId, buildMeetingSummaryText(meeting));
        void ragManager.getEmbeddingPipeline().processQueue().catch(error => {
            console.error('[SummaryIndex] Queue processing failed:', error instanceof Error ? error.message : error);
        });
    } catch (error) {
        console.error('[SummaryIndex] Refresh failed:', error instanceof Error ? error.message : error);
    }
}
