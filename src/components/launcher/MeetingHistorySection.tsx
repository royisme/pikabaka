import React, { useEffect, useMemo, useState } from 'react';
import type { Meeting } from '../Launcher';
import EmptyState from './EmptyState';
import MeetingBucket, { type BucketLabel } from './MeetingBucket';
import SearchToolbar, { type TimeFilter } from './SearchToolbar';

interface MeetingHistorySectionProps {
    meetings: Meeting[];
    onOpenMeeting: (meeting: Meeting) => void;
    onExportMeeting: (meeting: Meeting) => void;
    onDeleteMeeting: (meeting: Meeting) => void;
    onStartMeeting: () => void;
    activeMenuId: string | null;
    onMenuToggle: (meetingId: string | null) => void;
    menuEntered: boolean;
    onMenuEnteredChange: (entered: boolean) => void;
}

type MeetingBuckets = Record<BucketLabel, Meeting[]>;

const BUCKETS: Array<{ label: BucketLabel; defaultExpanded: boolean; virtualized?: boolean }> = [
    { label: 'Today', defaultExpanded: true },
    { label: 'Yesterday', defaultExpanded: true },
    { label: 'This Week', defaultExpanded: true },
    { label: 'This Month', defaultExpanded: false },
    { label: 'Earlier', defaultExpanded: false, virtualized: true },
];

const createEmptyBuckets = (): MeetingBuckets => ({
    Today: [],
    Yesterday: [],
    'This Week': [],
    'This Month': [],
    Earlier: [],
});

const startOfDay = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate());

const startOfWeek = (date: Date) => {
    const day = date.getDay();
    const diff = day === 0 ? 6 : day - 1;
    const weekStart = startOfDay(date);
    weekStart.setDate(weekStart.getDate() - diff);
    return weekStart;
};

const getMeetingDate = (meeting: Meeting) => {
    if (meeting.date === 'Today') return new Date();
    const date = new Date(meeting.date);
    return Number.isNaN(date.getTime()) ? null : date;
};

const getBucketLabel = (meeting: Meeting): BucketLabel => {
    const meetingDate = getMeetingDate(meeting);
    if (!meetingDate) return 'Earlier';

    const now = new Date();
    const today = startOfDay(now);
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    const meetingDay = startOfDay(meetingDate);

    if (meetingDay.getTime() === today.getTime()) return 'Today';
    if (meetingDay.getTime() === yesterday.getTime()) return 'Yesterday';
    if (meetingDay >= startOfWeek(now)) return 'This Week';
    if (meetingDate.getFullYear() === now.getFullYear() && meetingDate.getMonth() === now.getMonth()) return 'This Month';
    return 'Earlier';
};

const matchesTimeFilter = (meeting: Meeting, filter: TimeFilter) => {
    if (filter === 'all') return true;
    const meetingDate = getMeetingDate(meeting);
    if (!meetingDate) return false;

    const now = new Date();
    const meetingDay = startOfDay(meetingDate);
    const today = startOfDay(now);

    if (filter === 'today') return meetingDay.getTime() === today.getTime();
    if (filter === 'week') return meetingDay >= startOfWeek(now);
    return meetingDate.getFullYear() === now.getFullYear() && meetingDate.getMonth() === now.getMonth();
};

const getSearchableText = (meeting: Meeting) => [
    meeting.title,
    meeting.summary,
    meeting.detailedSummary?.actionItems?.join(' '),
    meeting.detailedSummary?.keyPoints?.join(' '),
    meeting.transcript?.map((entry) => `${entry.speaker} ${entry.text}`).join(' '),
].filter(Boolean).join(' ').toLowerCase();

const MeetingHistorySection: React.FC<MeetingHistorySectionProps> = ({
    meetings,
    onOpenMeeting,
    onExportMeeting,
    onDeleteMeeting,
    onStartMeeting,
    activeMenuId,
    onMenuToggle,
    menuEntered,
    onMenuEnteredChange,
}) => {
    const [query, setQuery] = useState('');
    const [debouncedQuery, setDebouncedQuery] = useState('');
    const [filter, setFilter] = useState<TimeFilter>('all');

    useEffect(() => {
        const timer = window.setTimeout(() => setDebouncedQuery(query.trim().toLowerCase()), 250);
        return () => window.clearTimeout(timer);
    }, [query]);

    const filteredMeetings = useMemo(() => {
        return meetings.filter((meeting) => {
            if (!matchesTimeFilter(meeting, filter)) return false;
            if (!debouncedQuery) return true;
            return getSearchableText(meeting).includes(debouncedQuery);
        });
    }, [meetings, debouncedQuery, filter]);

    const buckets = useMemo(() => {
        return filteredMeetings.reduce((acc, meeting) => {
            acc[getBucketLabel(meeting)].push(meeting);
            return acc;
        }, createEmptyBuckets());
    }, [filteredMeetings]);

    const isInitialEmpty = meetings.length === 0;
    const hasNoResults = !isInitialEmpty && filteredMeetings.length === 0;

    return (
        <div className="max-w-4xl mx-auto space-y-6">
            <SearchToolbar query={query} onQueryChange={setQuery} filter={filter} onFilterChange={setFilter} />

            {isInitialEmpty ? (
                <EmptyState type="empty" onStartMeeting={onStartMeeting} />
            ) : hasNoResults ? (
                <EmptyState type="no-results" />
            ) : (
                <div className="space-y-7">
                    {BUCKETS.map((bucket) => (
                        <MeetingBucket
                            key={bucket.label}
                            label={bucket.label}
                            meetings={buckets[bucket.label]}
                            defaultExpanded={bucket.defaultExpanded}
                            virtualized={bucket.virtualized}
                            onOpenMeeting={onOpenMeeting}
                            onExportMeeting={onExportMeeting}
                            onDeleteMeeting={onDeleteMeeting}
                            activeMenuId={activeMenuId}
                            onMenuToggle={onMenuToggle}
                            menuEntered={menuEntered}
                            onMenuEnteredChange={onMenuEnteredChange}
                        />
                    ))}
                </div>
            )}
        </div>
    );
};

export default MeetingHistorySection;
