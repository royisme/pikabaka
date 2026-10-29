import React, { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from 'react-query';
import { AlertCircle, CheckCircle, DownloadCloud, Ghost, RefreshCw } from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';
import MeetingDetails from './MeetingDetails';
import GlobalChatOverlay from './GlobalChatOverlay';
import LauncherHeader from './launcher/LauncherHeader';
import MeetingHistorySection from './launcher/MeetingHistorySection';
import { generateMeetingPDF } from '../utils/pdfGenerator';
import { useShortcuts } from '../hooks/useShortcuts';
import { useResolvedTheme } from '../hooks/useResolvedTheme';
import { useMainEvent } from '../hooks/useMainEvent';
import { useWindowEvent } from '../hooks/useWindowEvent';
export interface Meeting {
    id: string; title: string; date: string; duration: string; summary: string;
    detailedSummary?: { actionItems: string[]; keyPoints: string[] };
    transcript?: Array<{ speaker: string; text: string; timestamp: number }>;
    usage?: Array<{ type: 'assist' | 'followup' | 'chat' | 'followup_questions'; timestamp: number; question?: string; answer?: string; items?: string[] }>;
    participants?: unknown[]; participantCount?: number; active?: boolean; time?: string;
}
interface LauncherProps {
    onStartMeeting: () => void;
    onOpenSettings: (tab?: string) => void;
    onPageChange?: (isMain: boolean) => void;
    ollamaPullStatus?: 'idle' | 'downloading' | 'complete' | 'failed';
    ollamaPullPercent?: number;
    ollamaPullMessage?: string;
}
const Launcher: React.FC<LauncherProps> = ({
    onStartMeeting,
    onOpenSettings,
    onPageChange,
    ollamaPullStatus = 'idle',
    ollamaPullPercent = 0,
    ollamaPullMessage = '',
}) => {
    const queryClient = useQueryClient();
    const { data: meetings = [], refetch: refetchMeetings } = useQuery<Meeting[]>(
        ['recent-meetings'],
        () => window.electronAPI?.getRecentMeetings?.() ?? []
    );
    const { data: undetectable = false } = useQuery<boolean>(
        ['undetectable'],
        async () => (await window.electronAPI?.getUndetectable?.()) ?? false
    );
    const isDetectable = !undetectable;

    const { data: isMeetingActive = false } = useQuery<boolean>(
        ['meeting-active'],
        async () => (await window.electronAPI?.getMeetingActive?.()) ?? false
    );

    const [selectedMeeting, setSelectedMeeting] = useState<Meeting | null>(null);
    const [forwardMeeting, setForwardMeeting] = useState<Meeting | null>(null);
    const [isRefreshing, setIsRefreshing] = useState(false);
    const [activeMenuId, setActiveMenuId] = useState<string | null>(null);
    const [menuEntered, setMenuEntered] = useState(false);
    const [isGlobalChatOpen, setIsGlobalChatOpen] = useState(false);
    const [submittedGlobalQuery, setSubmittedGlobalQuery] = useState('');
    const { isShortcutPressed } = useShortcuts();
    const isLight = useResolvedTheme() === 'light';

    const updateSelectedMeeting = (meeting: Meeting | null) => {
        setSelectedMeeting(meeting);
        onPageChange?.(!meeting && !isGlobalChatOpen);
    };

    const updateGlobalChatOpen = (open: boolean) => {
        setIsGlobalChatOpen(open);
        onPageChange?.(!selectedMeeting && !open);
    };

    const handleMenuToggle = (id: string | null) => {
        setActiveMenuId(id);
        setMenuEntered(false);
    };

    const handleRefresh = async () => {
        setIsRefreshing(true);
        try {
            await refetchMeetings();
        } catch (e) {
            console.error('Refresh failed in handleRefresh:', e);
        } finally {
            setTimeout(() => setIsRefreshing(false), 500);
        }
    };

    // External seed trigger on mount
    useEffect(() => {
        window.electronAPI?.seedDemo?.().catch(err => console.error('Failed to seed demo:', err));
    }, []);

    // Main process event subscriptions
    useMainEvent(window.electronAPI?.onUndetectableChanged, (val) => {
        queryClient.setQueryData(['undetectable'], val);
    });
    useMainEvent(window.electronAPI?.onMeetingStateChanged, ({ isActive }) => {
        queryClient.setQueryData(['meeting-active'], isActive);
    });
    // onMeetingsUpdated takes a 0-arg callback, so useMainEvent type does not fit; kept as effect
    useEffect(() => window.electronAPI?.onMeetingsUpdated?.(() => {
        void refetchMeetings();
    }), [refetchMeetings]);

    // Window shortcuts
    useWindowEvent('keydown', (e: KeyboardEvent) => {
        if (isShortcutPressed(e, 'toggleVisibility')) {
            e.preventDefault();
            window.electronAPI.toggleWindow();
        } else if (isShortcutPressed(e, 'moveWindowUp')) {
            e.preventDefault();
            window.electronAPI.moveWindowUp?.();
        } else if (isShortcutPressed(e, 'moveWindowDown')) {
            e.preventDefault();
            window.electronAPI.moveWindowDown?.();
        } else if (isShortcutPressed(e, 'moveWindowLeft')) {
            e.preventDefault();
            window.electronAPI.moveWindowLeft?.();
        } else if (isShortcutPressed(e, 'moveWindowRight')) {
            e.preventDefault();
            window.electronAPI.moveWindowRight?.();
        }
    });

    // Close menu on click outside
    useWindowEvent('click', () => {
        handleMenuToggle(null);
    });
    if (!window.electronAPI) {
        return <div className="p-10 text-white">Error: Electron API not initialized. Check preload script.</div>;
    }
    const toggleDetectable = () => {
        const nextDetectable = !isDetectable;
        queryClient.setQueryData(['undetectable'], !nextDetectable);
        window.electronAPI?.setUndetectable?.(!nextDetectable);
    };
    const handleOpenMeeting = async (meeting: Meeting) => {
        setForwardMeeting(null);
        console.log('[Launcher] Opening meeting:', meeting.id);
        try {
            const fullMeeting = await window.electronAPI?.getMeetingDetails?.(meeting.id);
            if (fullMeeting) {
                updateSelectedMeeting(fullMeeting);
                return;
            }
        } catch (err) {
            console.error('[Launcher] Failed to fetch meeting details:', err);
        }
        updateSelectedMeeting(meeting);
    };
    const handleExportMeeting = async (meeting: Meeting) => {
        handleMenuToggle(null);
        try {
            const fullMeeting = await window.electronAPI?.getMeetingDetails?.(meeting.id);
            generateMeetingPDF(fullMeeting || meeting);
        } catch (e) {
            console.error('Failed to fetch details for PDF', e);
            generateMeetingPDF(meeting);
        }
    };
    const handleDeleteMeeting = async (meeting: Meeting) => {
        const success = await window.electronAPI?.deleteMeeting?.(meeting.id);
        if (success) {
            queryClient.setQueryData<Meeting[]>(['recent-meetings'], (prev = []) => prev.filter(item => item.id !== meeting.id));
        }
        handleMenuToggle(null);
    };
    const handleBack = () => {
        setForwardMeeting(selectedMeeting);
        updateSelectedMeeting(null);
    };
    const handleForward = () => {
        if (forwardMeeting) {
            updateSelectedMeeting(forwardMeeting);
            setForwardMeeting(null);
        }
    };
    return (
        <div className="flex h-full w-full flex-col overflow-hidden bg-bg-primary font-sans text-text-primary selection:bg-accent-secondary/30">
            <LauncherHeader
                meetings={meetings}
                selectedMeeting={selectedMeeting}
                forwardMeeting={forwardMeeting}
                onBack={handleBack}
                onForward={handleForward}
                onOpenSettings={() => onOpenSettings()}
                onAIQuery={(query) => {
                    setSubmittedGlobalQuery(query);
                    updateGlobalChatOpen(true);
                }}
                onLiteralSearch={(query) => {
                    setSubmittedGlobalQuery(query);
                    updateGlobalChatOpen(true);
                }}
                onOpenMeetingId={(meetingId) => {
                    const meeting = meetings.find(m => m.id === meetingId);
                    if (meeting) {
                        handleOpenMeeting(meeting);
                    }
                }}
            />
            <div className="relative flex flex-1 flex-col overflow-hidden">
                {!isDetectable && <div className="pointer-events-none absolute inset-1 z-modal rounded-2xl border-2 border-dashed border-border-muted" />}
                <AnimatePresence mode="wait">
                    {selectedMeeting ? (
                        <motion.div key="details" className="flex-1 overflow-hidden" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }}>
                            <MeetingDetails meeting={selectedMeeting} onBack={handleBack} onOpenSettings={onOpenSettings} />
                        </motion.div>
                    ) : (
                        <motion.div key="launcher" className="flex flex-1 flex-col overflow-hidden" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }}>
                            <section className={`${isLight ? 'bg-bg-primary' : 'bg-bg-elevated'} shrink-0 border-b border-border-subtle px-8 py-6`}>
                                <div className="mx-auto max-w-4xl space-y-5">
                                    <div className="flex items-center justify-between gap-4">
                                        <div className="flex items-center gap-4">
                                            <h1 className="font-celeb-light text-3xl font-medium tracking-wide text-text-primary">My Pika</h1>
                                            <button onClick={handleRefresh} disabled={isRefreshing} className={`rounded-full p-2 text-text-secondary transition-colors hover:bg-bg-input hover:text-text-primary ${isRefreshing ? 'animate-spin text-state-info' : ''}`} title="Refresh State" aria-label="Refresh meetings">
                                                <RefreshCw size={18} />
                                            </button>
                                            <div className="flex min-w-36 shrink-0 items-center gap-3 rounded-full border border-border-muted bg-bg-elevated px-3 py-1.5">
                                                <Ghost size={14} className="text-text-secondary" />
                                                <span className="flex-1 whitespace-nowrap text-xs font-medium text-text-secondary">Hide from screen share</span>
                                                <button type="button" role="switch" onClick={toggleDetectable} className={`relative h-4 w-8 shrink-0 rounded-full transition-colors ${!isDetectable ? 'bg-accent-primary' : 'bg-bg-toggle-switch'}`} aria-label="Hide from screen share" aria-pressed={!isDetectable} aria-checked={!isDetectable}>
                                                    <span className={`absolute top-0.5 h-3 w-3 rounded-full bg-white shadow-sm transition-all ${!isDetectable ? 'left-4' : 'left-0.5'}`} />
                                                </button>
                                            </div>
                                        </div>
                                        <div className="flex flex-1 justify-center">
                                            <AnimatePresence>
                                                {ollamaPullStatus !== 'idle' && (
                                                    <motion.div initial={{ opacity: 0, scale: 0.95, y: 8 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95, y: 8 }} className="flex items-center gap-2 rounded-full border border-border-subtle bg-bg-elevated/80 px-4 py-2 shadow-sm backdrop-blur-xl">
                                                        {ollamaPullStatus === 'downloading' ? <DownloadCloud size={14} className="shrink-0 animate-pulse text-state-info" /> : ollamaPullStatus === 'complete' ? <CheckCircle size={14} className="shrink-0 text-state-success" /> : <AlertCircle size={14} className="shrink-0 text-state-danger" />}
                                                        <div className="flex flex-col">
                                                            <span className="whitespace-nowrap text-xs font-medium text-text-secondary">{ollamaPullStatus === 'downloading' ? `Setting up AI memory... ${ollamaPullPercent}%` : ollamaPullMessage}</span>
                                                            {ollamaPullStatus === 'downloading' && <div className="mt-1 h-1 overflow-hidden rounded-full bg-bg-input"><div className="h-full rounded-full bg-state-info transition-all duration-300" style={{ width: `${ollamaPullPercent}%` }} /></div>}
                                                        </div>
                                                    </motion.div>
                                                )}
                                            </AnimatePresence>
                                        </div>
                                        <motion.button aria-keyshortcuts="Meta+1" onClick={() => {
                                            if (isMeetingActive) {
                                                window.electronAPI?.setWindowMode?.('overlay', true);
                                            } else {
                                                onStartMeeting();
                                            }
                                        }} whileHover={{ scale: 1.01 }} whileTap={{ scale: 0.99 }} className={`flex shrink-0 items-center justify-center gap-3 rounded-full px-6 py-3 font-celeb text-xl font-medium text-on-primary shadow-lg ${isMeetingActive ? 'bg-secondary' : 'bg-primary'}`}>
                                            {isMeetingActive && <span className="h-2.5 w-2.5 rounded-full bg-on-primary shadow-sm" />}
                                            {isMeetingActive ? 'Meeting ongoing' : 'Start Pika'}
                                        </motion.button>
                                    </div>
                                </div>
                            </section>
                            <main className="custom-scrollbar flex-1 overflow-y-auto bg-bg-primary">
                                <section className="min-h-full px-8 py-8">
                                    <MeetingHistorySection meetings={meetings} onOpenMeeting={handleOpenMeeting} onExportMeeting={handleExportMeeting} onDeleteMeeting={handleDeleteMeeting} onStartMeeting={onStartMeeting} activeMenuId={activeMenuId} onMenuToggle={handleMenuToggle} menuEntered={menuEntered} onMenuEnteredChange={setMenuEntered} />
                                </section>
                            </main>
                        </motion.div>
                    )}
                </AnimatePresence>
            </div>
            <GlobalChatOverlay isOpen={isGlobalChatOpen} onClose={() => { updateGlobalChatOpen(false); setSubmittedGlobalQuery(''); }} initialQuery={submittedGlobalQuery} />
        </div>
    );
};
export default Launcher;
