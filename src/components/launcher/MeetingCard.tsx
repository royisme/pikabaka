import React from 'react';
import { Clock, Download, FileAudio, FileText, MoreHorizontal, RefreshCw, Trash2, Users } from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';
import type { Meeting } from '../Launcher';

interface MeetingCardProps {
    meeting: Meeting;
    onOpen: (meeting: Meeting) => void;
    onExport: (meeting: Meeting) => void;
    onDelete: (meeting: Meeting) => void;
    activeMenuId: string | null;
    onMenuToggle: (meetingId: string | null) => void;
    menuEntered: boolean;
    onMenuEnteredChange: (entered: boolean) => void;
    style?: React.CSSProperties;
}

const getParticipantsCount = (meeting: Meeting): number | null => {
    const raw = (meeting as Meeting & { participants?: unknown; participantCount?: unknown }).participants;
    const explicitCount = (meeting as Meeting & { participantCount?: unknown }).participantCount;

    if (Array.isArray(raw)) return raw.length;
    if (typeof explicitCount === 'number') return explicitCount;
    return null;
};

const getSummaryPreview = (summary?: string) => {
    if (!summary?.trim()) return 'No AI summary yet.';
    const firstSentence = summary.trim().split(/(?<=[.!?])\s+/)[0] || summary.trim();
    return firstSentence.length > 150 ? `${firstSentence.slice(0, 147).trim()}...` : firstSentence;
};

const formatTime = (dateStr: string) => {
    if (dateStr === 'Today') return 'Just now';
    const date = new Date(dateStr);
    if (Number.isNaN(date.getTime())) return dateStr;
    return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
};

const formatDuration = (duration?: string) => {
    if (!duration) return '00:00';
    if (duration.includes(':')) return duration;
    const minutes = parseInt(duration.replace('min', '').trim(), 10) || 0;
    return `${minutes} min`;
};

const MeetingCard: React.FC<MeetingCardProps> = ({
    meeting,
    onOpen,
    onExport,
    onDelete,
    activeMenuId,
    onMenuToggle,
    menuEntered,
    onMenuEnteredChange,
    style,
}) => {
    const isProcessing = meeting.title === 'Processing...';
    const participantCount = getParticipantsCount(meeting);
    const hasTranscript = Boolean(meeting.transcript?.length);
    const hasSummary = Boolean(meeting.summary?.trim());
    const isMenuOpen = activeMenuId === meeting.id;

    return (
        <div style={style} className={style ? 'px-1 pb-3' : undefined}>
            <motion.article
                layoutId={`meeting-${meeting.id}`}
                tabIndex={0}
                role="button"
                aria-label={`Open meeting ${meeting.title}`}
                onClick={() => onOpen(meeting)}
                onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        onOpen(meeting);
                    }
                }}
                whileHover={{ y: -1 }}
                transition={{ duration: 0.16, ease: 'easeOut' }}
                className="group relative cursor-pointer rounded-2xl border border-border-subtle bg-bg-elevated/70 p-4 shadow-sm outline-none transition-colors hover:border-border-muted hover:bg-bg-elevated focus:border-accent-primary/50 focus:ring-2 focus:ring-accent-primary/20"
            >
                <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                            {isProcessing && <RefreshCw size={14} className="shrink-0 animate-spin text-state-info" />}
                            <h4 className={`truncate text-base font-semibold ${isProcessing ? 'italic text-state-info' : 'text-text-primary'}`}>
                                {meeting.title || 'Untitled meeting'}
                            </h4>
                        </div>
                        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-text-secondary">
                            <span className="inline-flex items-center gap-1">
                                <Clock size={13} />
                                {formatTime(meeting.date)}
                            </span>
                            <span>{formatDuration(meeting.duration)}</span>
                            {participantCount !== null && (
                                <span className="inline-flex items-center gap-1">
                                    <Users size={13} />
                                    {participantCount}
                                </span>
                            )}
                        </div>
                    </div>

                    <div className="flex items-center gap-2 pr-8 text-text-tertiary">
                        <span title={hasTranscript ? 'Transcript ready' : 'Transcript unavailable'} className={hasTranscript ? 'text-state-success' : ''}>
                            <FileText size={15} />
                        </span>
                        <span title={hasSummary ? 'AI summary ready' : 'Recording or summary pending'} className={hasSummary ? 'text-accent-primary' : ''}>
                            <FileAudio size={15} />
                        </span>
                    </div>
                </div>

                <p className="mt-3 line-clamp-2 text-sm leading-relaxed text-text-secondary">
                    {isProcessing ? 'Finalizing transcript and AI summary...' : getSummaryPreview(meeting.summary)}
                </p>

                <div className="absolute right-3 top-3">
                    <button
                        type="button"
                        className="rounded-full p-1.5 text-text-tertiary opacity-0 transition-all hover:bg-bg-input hover:text-text-primary group-hover:opacity-100 focus:opacity-100 focus:outline-none focus:ring-2 focus:ring-accent-primary/20"
                        aria-label={`Open actions for ${meeting.title}`}
                        onClick={(event) => {
                            event.stopPropagation();
                            onMenuToggle(isMenuOpen ? null : meeting.id);
                        }}
                    >
                        <MoreHorizontal size={16} />
                    </button>
                </div>

                <AnimatePresence>
                    {isMenuOpen && (
                        <motion.div
                            initial={{ opacity: 0, scale: 0.96, y: 6 }}
                            animate={{ opacity: 1, scale: 1, y: 0 }}
                            exit={{ opacity: 0, scale: 0.96, y: 4 }}
                            transition={{ duration: 0.1 }}
                            className="absolute right-3 top-10 z-50 w-28 overflow-hidden rounded-xl border border-border-subtle bg-bg-elevated shadow-xl"
                            onClick={(event) => event.stopPropagation()}
                            onMouseEnter={() => onMenuEnteredChange(true)}
                            onMouseLeave={() => {
                                if (menuEntered) onMenuToggle(null);
                            }}
                        >
                            <div className="flex flex-col gap-1 p-1">
                                <button
                                    type="button"
                                    className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs text-text-primary transition-colors hover:bg-bg-input"
                                    onClick={() => onExport(meeting)}
                                >
                                    <Download size={13} />
                                    Export
                                </button>
                                <button
                                    type="button"
                                    className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs text-state-danger transition-colors hover:bg-state-danger-soft"
                                    onClick={() => onDelete(meeting)}
                                >
                                    <Trash2 size={13} />
                                    Delete
                                </button>
                            </div>
                        </motion.div>
                    )}
                </AnimatePresence>
            </motion.article>
        </div>
    );
};

export default MeetingCard;
