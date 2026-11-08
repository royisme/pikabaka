// Data shapes shared by the main process and the renderer typings.

export interface Meeting {
    id: string;
    title: string;
    date: string; // ISO string
    startTimeMs?: number;
    duration: string;
    summary: string;
    detailedSummary?: {
        overview?: string;
        actionItems: string[];
        keyPoints: string[];
        actionItemsTitle?: string;
        keyPointsTitle?: string;
    };
    transcript?: Array<{
        speaker: string;
        text: string;
        timestamp: number;
    }>;
    usage?: Array<{
        type: 'assist' | 'followup' | 'chat' | 'followup_questions';
        timestamp: number;
        question?: string;
        answer?: string;
        items?: string[];
    }>;
    isProcessed?: boolean;
}

// One recorded answer or question in a meeting.
export type MeetingUsage = NonNullable<Meeting['usage']>[number];

// Edits the renderer sends for a meeting summary.
export type MeetingSummaryUpdates = {
    overview?: string;
    actionItems?: string[];
    keyPoints?: string[];
    actionItemsTitle?: string;
    keyPointsTitle?: string;
};

// What the renderer sends to start a meeting.
export type MeetingStartMetadata = {
    title?: string;
    audio?: { inputDeviceId?: string | null; outputDeviceId?: string | null };
};
