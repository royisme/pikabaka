import React from 'react';
import { ArrowLeft, ArrowRight, Settings } from 'lucide-react';
import type { Meeting } from '../Launcher';
import TopSearchPill from '../TopSearchPill';
import WindowControls from '../WindowControls';
import { isMac } from '../../utils/platformUtils';

interface LauncherHeaderProps {
    meetings: Meeting[];
    selectedMeeting: Meeting | null;
    forwardMeeting: Meeting | null;
    onBack: () => void;
    onForward: () => void;
    onOpenSettings: () => void;
    onAIQuery: (query: string) => void;
    onLiteralSearch: (query: string) => void;
    onOpenMeetingId: (meetingId: string) => void;
}

const LauncherHeader: React.FC<LauncherHeaderProps> = ({
    meetings,
    selectedMeeting,
    forwardMeeting,
    onBack,
    onForward,
    onOpenSettings,
    onAIQuery,
    onLiteralSearch,
    onOpenMeetingId,
}) => (
    <header className="drag-region relative z-sticky flex h-10 w-full shrink-0 select-none items-center justify-between border-b border-border-subtle bg-bg-secondary pl-0">
        <div className="no-drag flex items-center gap-1">
            {isMac && <div className="w-16" />}
            <button onClick={selectedMeeting ? onBack : undefined} disabled={!selectedMeeting} aria-label="Back to meetings" className={`ml-2 mt-1 flex items-center justify-center p-1 transition-colors ${selectedMeeting ? 'text-text-secondary hover:text-text-primary' : 'cursor-default text-text-tertiary opacity-50'}`}>
                <ArrowLeft size={16} />
            </button>
            <button onClick={onForward} disabled={!forwardMeeting} aria-label="Forward to meeting details" className={`mt-1 flex items-center justify-center p-1 transition-colors ${forwardMeeting ? 'text-text-secondary hover:text-text-primary' : 'cursor-default text-text-tertiary opacity-0'}`}>
                <ArrowRight size={16} />
            </button>
        </div>

        <TopSearchPill meetings={meetings} onAIQuery={onAIQuery} onLiteralSearch={onLiteralSearch} onOpenMeeting={onOpenMeetingId} />

        <div className={`no-drag flex shrink-0 items-center gap-3 ${isMac ? 'mr-1' : ''}`}>
            <button onClick={onOpenSettings} className="p-2 text-text-secondary transition-colors hover:text-text-primary" aria-label="Open settings">
                <Settings size={18} />
            </button>
            {!isMac && <WindowControls />}
        </div>
    </header>
);

export default LauncherHeader;
