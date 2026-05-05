import React, { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';
import { List } from 'react-window';
import type { Meeting } from '../Launcher';
import MeetingCard from './MeetingCard';

export type BucketLabel = 'Today' | 'Yesterday' | 'This Week' | 'This Month' | 'Earlier';

interface MeetingBucketProps {
    label: BucketLabel;
    meetings: Meeting[];
    defaultExpanded: boolean;
    virtualized?: boolean;
    onOpenMeeting: (meeting: Meeting) => void;
    onExportMeeting: (meeting: Meeting) => void;
    onDeleteMeeting: (meeting: Meeting) => void;
    activeMenuId: string | null;
    onMenuToggle: (meetingId: string | null) => void;
    menuEntered: boolean;
    onMenuEnteredChange: (entered: boolean) => void;
}

interface VirtualRowProps {
    meetings: Meeting[];
    onOpenMeeting: (meeting: Meeting) => void;
    onExportMeeting: (meeting: Meeting) => void;
    onDeleteMeeting: (meeting: Meeting) => void;
    activeMenuId: string | null;
    onMenuToggle: (meetingId: string | null) => void;
    menuEntered: boolean;
    onMenuEnteredChange: (entered: boolean) => void;
}

const ROW_HEIGHT = 132;
const MAX_VIRTUAL_HEIGHT = 528;

const VirtualMeetingRow = ({
    index,
    style,
    meetings,
    onOpenMeeting,
    onExportMeeting,
    onDeleteMeeting,
    activeMenuId,
    onMenuToggle,
    menuEntered,
    onMenuEnteredChange,
}: VirtualRowProps & { index: number; style: React.CSSProperties; ariaAttributes?: unknown }): React.ReactElement | null => (
    <MeetingCard
        meeting={meetings[index]}
        style={style}
        onOpen={onOpenMeeting}
        onExport={onExportMeeting}
        onDelete={onDeleteMeeting}
        activeMenuId={activeMenuId}
        onMenuToggle={onMenuToggle}
        menuEntered={menuEntered}
        onMenuEnteredChange={onMenuEnteredChange}
    />
);

const MeetingBucket: React.FC<MeetingBucketProps> = ({
    label,
    meetings,
    defaultExpanded,
    virtualized = false,
    onOpenMeeting,
    onExportMeeting,
    onDeleteMeeting,
    activeMenuId,
    onMenuToggle,
    menuEntered,
    onMenuEnteredChange,
}) => {
    const [isExpanded, setIsExpanded] = useState(defaultExpanded);

    if (meetings.length === 0) return null;

    const listHeight = Math.min(meetings.length * ROW_HEIGHT, MAX_VIRTUAL_HEIGHT);

    return (
        <section className="space-y-3">
            <button
                type="button"
                onClick={() => setIsExpanded((value) => !value)}
                className="flex w-full items-center justify-between rounded-xl px-2 py-1 text-left transition-colors hover:bg-bg-elevated focus:outline-none focus:ring-2 focus:ring-accent-primary/20"
                aria-expanded={isExpanded}
            >
                <div className="flex items-center gap-2">
                    <h3 className="text-sm font-semibold text-text-primary">{label}</h3>
                    <span className="rounded-full bg-bg-input px-2 py-0.5 text-xs font-medium text-text-secondary">{meetings.length}</span>
                </div>
                <ChevronDown size={16} className={`text-text-tertiary transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
            </button>

            <AnimatePresence initial={false}>
                {isExpanded && (
                    <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.18, ease: 'easeOut' }}
                        className="overflow-hidden"
                    >
                        {virtualized ? (
                            <List<VirtualRowProps>
                                className="custom-scrollbar"
                                rowComponent={VirtualMeetingRow}
                                rowCount={meetings.length}
                                rowHeight={ROW_HEIGHT}
                                rowProps={{
                                    meetings,
                                    onOpenMeeting,
                                    onExportMeeting,
                                    onDeleteMeeting,
                                    activeMenuId,
                                    onMenuToggle,
                                    menuEntered,
                                    onMenuEnteredChange,
                                }}
                                overscanCount={3}
                                style={{ height: listHeight }}
                            />
                        ) : (
                            <div className="space-y-3">
                                {meetings.map((meeting) => (
                                    <MeetingCard
                                        key={meeting.id}
                                        meeting={meeting}
                                        onOpen={onOpenMeeting}
                                        onExport={onExportMeeting}
                                        onDelete={onDeleteMeeting}
                                        activeMenuId={activeMenuId}
                                        onMenuToggle={onMenuToggle}
                                        menuEntered={menuEntered}
                                        onMenuEnteredChange={onMenuEnteredChange}
                                    />
                                ))}
                            </div>
                        )}
                    </motion.div>
                )}
            </AnimatePresence>
        </section>
    );
};

export default MeetingBucket;
