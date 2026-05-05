import React, { useEffect, useState } from 'react';
import { AlertCircle, ArrowRight, Briefcase, Calendar, CheckCircle, DownloadCloud, Ghost, Link as LinkIcon, RefreshCw, Zap } from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';
import icon from '../../assets/icon.png';
import MeetingDetails from './MeetingDetails';
import GlobalChatOverlay from './GlobalChatOverlay';
import LauncherHeader from './launcher/LauncherHeader';
import MeetingHistorySection from './launcher/MeetingHistorySection';
import { generateMeetingPDF } from '../utils/pdfGenerator';
import { analytics } from '../lib/analytics/analytics.service';
import { useShortcuts } from '../hooks/useShortcuts';
import { useProfileData } from '../hooks/useProfileData';
import { useResolvedTheme } from '../hooks/useResolvedTheme';
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
    const [meetings, setMeetings] = useState<Meeting[]>([]);
    const [isDetectable, setIsDetectable] = useState(false);
    const [isMeetingActive, setIsMeetingActive] = useState(false);
    const [selectedMeeting, setSelectedMeeting] = useState<Meeting | null>(null);
    const [forwardMeeting, setForwardMeeting] = useState<Meeting | null>(null);
    const [upcomingEvents, setUpcomingEvents] = useState<any[]>([]);
    const [isPrepared, setIsPrepared] = useState(false);
    const [preparedEvent, setPreparedEvent] = useState<any>(null);
    const [isRefreshing, setIsRefreshing] = useState(false);
    const [showNotification, setShowNotification] = useState(false);
    const [activeMenuId, setActiveMenuId] = useState<string | null>(null);
    const [menuEntered, setMenuEntered] = useState(false);
    const [isGlobalChatOpen, setIsGlobalChatOpen] = useState(false);
    const [submittedGlobalQuery, setSubmittedGlobalQuery] = useState('');
    const { isShortcutPressed } = useShortcuts();
    const { data: profileData } = useProfileData();
    const isLight = useResolvedTheme() === 'light';
    const fetchMeetings = () => {
        window.electronAPI?.getRecentMeetings?.().then(setMeetings).catch(err => console.error('Failed to fetch meetings:', err));
    };
    const fetchEvents = () => {
        window.electronAPI?.getUpcomingEvents?.().then(setUpcomingEvents).catch(err => console.error('Failed to fetch events:', err));
    };
    const handleRefresh = async () => {
        setIsRefreshing(true);
        analytics.trackCommandExecuted('refresh_calendar');
        try {
            if (window.electronAPI?.calendarRefresh) {
                setShowNotification(true);
                await window.electronAPI.calendarRefresh();
                fetchEvents();
                fetchMeetings();
                setTimeout(() => setShowNotification(false), 3000);
            } else {
                console.warn('electronAPI.calendarRefresh not found');
            }
        } catch (e) {
            console.error('Refresh failed in handleRefresh:', e);
        } finally {
            setTimeout(() => setIsRefreshing(false), 500);
        }
    };
    useEffect(() => {
        let mounted = true;
        console.log('Launcher mounted');
        window.electronAPI?.seedDemo?.().catch(err => console.error('Failed to seed demo:', err));
        window.electronAPI?.getUndetectable?.().then((undetectable) => { if (mounted) setIsDetectable(!undetectable); });
        const removeUndetectableListener = window.electronAPI?.onUndetectableChanged?.((undetectable) => setIsDetectable(!undetectable));
        fetchMeetings();
        fetchEvents();
        window.electronAPI?.getMeetingActive?.().then((active) => { if (mounted) setIsMeetingActive(active); }).catch(() => {});
        const removeMeetingStateListener = window.electronAPI?.onMeetingStateChanged?.(({ isActive }) => setIsMeetingActive(isActive));
        const removeMeetingsListener = window.electronAPI?.onMeetingsUpdated?.(() => {
            console.log('Received meetings-updated event');
            fetchMeetings();
        });
        const interval = setInterval(fetchEvents, 60000);
        return () => {
            mounted = false;
            removeMeetingsListener?.();
            removeUndetectableListener?.();
            removeMeetingStateListener?.();
            clearInterval(interval);
        };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
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
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [isShortcutPressed]);
    useEffect(() => setMenuEntered(false), [activeMenuId]);
    useEffect(() => {
        const handleClickOutside = () => setActiveMenuId(null);
        window.addEventListener('click', handleClickOutside);
        return () => window.removeEventListener('click', handleClickOutside);
    }, []);
    useEffect(() => {
        onPageChange?.(!selectedMeeting && !isGlobalChatOpen);
    }, [selectedMeeting, isGlobalChatOpen, onPageChange]);
    if (!window.electronAPI) {
        return <div className="p-10 text-white">Error: Electron API not initialized. Check preload script.</div>;
    }
    const nextMeeting = upcomingEvents.find(e => {
        const diff = new Date(e.startTime).getTime() - Date.now();
        return diff > -5 * 60000 && diff < 60 * 60000;
    });
    const showUpcomingHero = Boolean((isPrepared && preparedEvent) || nextMeeting);
    const toggleDetectable = () => {
        const newState = !isDetectable;
        setIsDetectable(newState);
        window.electronAPI?.setUndetectable(!newState);
        analytics.trackModeSelected(newState ? 'launcher' : 'undetectable');
    };
    const handleStartPreparedMeeting = async () => {
        if (!preparedEvent) return;
        analytics.trackCommandExecuted('start_prepared_meeting');
        try {
            await window.electronAPI.startMeeting({
                title: preparedEvent.title,
                calendarEventId: preparedEvent.id,
                source: 'calendar',
                audio: {
                    inputDeviceId: localStorage.getItem('preferredInputDeviceId'),
                    outputDeviceId: localStorage.getItem('preferredOutputDeviceId'),
                },
            });
            setIsPrepared(false);
        } catch (e) {
            console.error('Failed to start prepared meeting', e);
        }
    };
    const handleOpenMeeting = async (meeting: Meeting) => {
        setForwardMeeting(null);
        console.log('[Launcher] Opening meeting:', meeting.id);
        analytics.trackCommandExecuted('open_meeting_details');
        try {
            const fullMeeting = await window.electronAPI?.getMeetingDetails?.(meeting.id);
            if (fullMeeting) {
                setSelectedMeeting(fullMeeting);
                return;
            }
        } catch (err) {
            console.error('[Launcher] Failed to fetch meeting details:', err);
        }
        setSelectedMeeting(meeting);
    };
    const handleExportMeeting = async (meeting: Meeting) => {
        setActiveMenuId(null);
        analytics.trackPdfExported();
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
        if (success) setMeetings(prev => prev.filter(item => item.id !== meeting.id));
        setActiveMenuId(null);
    };
    const handleBack = () => {
        setForwardMeeting(selectedMeeting);
        setSelectedMeeting(null);
    };
    const handleForward = () => {
        if (forwardMeeting) {
            setSelectedMeeting(forwardMeeting);
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
                    analytics.trackCommandExecuted('ai_query_search');
                    setSubmittedGlobalQuery(query);
                    setIsGlobalChatOpen(true);
                }}
                onLiteralSearch={(query) => {
                    analytics.trackCommandExecuted('literal_search');
                    setSubmittedGlobalQuery(query);
                    setIsGlobalChatOpen(true);
                }}
                onOpenMeetingId={(meetingId) => {
                    const meeting = meetings.find(m => m.id === meetingId);
                    if (meeting) {
                        handleOpenMeeting(meeting);
                        analytics.trackCommandExecuted('open_meeting_from_search');
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
                                            <button onClick={handleRefresh} disabled={isRefreshing} className={`rounded-full p-2 text-text-secondary transition-colors hover:bg-bg-input hover:text-text-primary ${isRefreshing ? 'animate-spin text-state-info' : ''}`} title="Refresh State" aria-label="Refresh calendar and meetings">
                                                <RefreshCw size={18} />
                                            </button>
                                            <div className="flex min-w-36 items-center gap-3 rounded-full border border-border-muted bg-bg-elevated px-3 py-1.5">
                                                <Ghost size={14} className="text-text-secondary" />
                                                <span className="flex-1 text-xs font-medium text-text-secondary">{isDetectable ? 'Detectable' : 'Undetectable'}</span>
                                                <button type="button" onClick={toggleDetectable} className={`relative h-4 w-8 rounded-full transition-colors ${!isDetectable ? 'bg-accent-primary' : 'bg-bg-toggle-switch'}`} aria-label={isDetectable ? 'Switch to undetectable mode' : 'Switch to detectable mode'}>
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
                                                analytics.trackCommandExecuted('resume_meeting_from_launcher');
                                            } else {
                                                onStartMeeting();
                                                analytics.trackCommandExecuted('start_pika_cta');
                                            }
                                        }} whileHover={{ scale: 1.01 }} whileTap={{ scale: 0.99 }} className={`flex shrink-0 items-center justify-center gap-3 rounded-full px-6 py-3 font-celeb text-xl font-medium text-white shadow-lg ${isMeetingActive ? 'bg-state-success' : 'bg-state-info'}`}>
                                            {isMeetingActive ? <span className="h-2.5 w-2.5 rounded-full bg-white shadow-sm" /> : <img src={icon} alt="Logo" className="h-5 w-5 object-contain" />}
                                            {isMeetingActive ? 'Meeting ongoing' : 'Start Pika'}
                                        </motion.button>
                                    </div>
                                    {showUpcomingHero && (
                                        <div className="rounded-2xl border border-border-subtle bg-bg-elevated p-5 shadow-sm">
                                            {isPrepared && preparedEvent ? (
                                                <div className="flex items-center justify-between gap-4">
                                                    <div>
                                                        <span className="mb-2 inline-flex rounded-full border border-state-success/30 bg-state-success-soft px-3 py-1 text-xs font-bold text-state-success">READY TO JOIN</span>
                                                        <h2 className="text-2xl font-bold text-text-primary">{preparedEvent.title}</h2>
                                                        <p className="mt-2 flex items-center gap-2 text-xs text-text-secondary"><Calendar size={12} />{new Date(preparedEvent.startTime).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} - {new Date(preparedEvent.endTime).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}{preparedEvent.link && ' • Link Ready'}</p>
                                                    </div>
                                                    <div className="flex items-center gap-2">
                                                        <button type="button" onClick={handleStartPreparedMeeting} className="flex items-center gap-2 rounded-xl bg-state-success px-5 py-3 text-sm font-semibold text-white transition-transform active:scale-95">Start Meeting <ArrowRight size={16} /></button>
                                                        <button type="button" onClick={() => setIsPrepared(false)} className="rounded-xl px-4 py-3 text-xs font-medium text-text-tertiary transition-colors hover:text-text-primary">Cancel</button>
                                                    </div>
                                                </div>
                                            ) : nextMeeting ? (
                                                <div className="space-y-4">
                                                    <div>
                                                        <div className="mb-2 flex items-center gap-2"><span className="h-1.5 w-1.5 rounded-full bg-state-success" /><span className="text-xs font-bold uppercase tracking-wide text-state-success">Up Next</span><span className="text-xs text-text-tertiary">Starts in {Math.max(0, Math.ceil((new Date(nextMeeting.startTime).getTime() - Date.now()) / 60000))} min</span></div>
                                                        <h2 className="line-clamp-2 text-xl font-bold text-text-primary">{nextMeeting.title}</h2>
                                                        <div className="mt-2 flex items-center gap-2 text-xs text-text-secondary"><Calendar size={12} /><span>{new Date(nextMeeting.startTime).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} - {new Date(nextMeeting.endTime).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span>{nextMeeting.link && <><span className="opacity-50">|</span><LinkIcon size={12} /><span>Meeting Link Found</span></>}</div>
                                                    </div>
                                                    <div className="flex items-center gap-3 border-t border-border-subtle pt-4">
                                                        <button type="button" onClick={() => { setPreparedEvent(nextMeeting); setIsPrepared(true); }} className="flex flex-1 items-center justify-center gap-2 rounded-lg border border-border-muted bg-bg-item-surface px-4 py-2 text-xs font-medium text-text-primary transition-colors hover:bg-bg-item-active"><Zap size={13} className="text-state-warning" />Prepare</button>
                                                        <button type="button" onClick={onStartMeeting} className="rounded-lg px-4 py-2 text-xs font-medium text-text-secondary transition-colors hover:bg-bg-input hover:text-text-primary">Start now</button>
                                                    </div>
                                                </div>
                                            ) : null}
                                        </div>
                                    )}
                                </div>
                            </section>
                            {profileData?.hasActiveJD && profileData.activeJD && (
                                <div className="border-t border-border-subtle bg-bg-primary/50 px-8 py-3">
                                    <div className="mx-auto flex max-w-4xl items-center justify-between">
                                        <div className="flex items-center gap-3"><div className="flex h-7 w-7 items-center justify-center rounded-lg border border-accent-primary/20 bg-accent-primary/10"><Briefcase size={13} className="text-accent-primary" /></div><div><div className="flex items-center gap-2"><span className="text-xs font-semibold text-text-primary">{profileData.activeJD.title}</span><span className="rounded border border-accent-primary/20 bg-accent-primary/10 px-1.5 py-0.5 text-xs font-bold uppercase tracking-wide text-accent-primary">Active</span></div><span className="text-xs text-text-secondary">{profileData.activeJD.company}</span></div></div>
                                        <button onClick={() => onOpenSettings?.('profile')} className="rounded-full px-2.5 py-1 text-xs font-medium text-text-tertiary transition-colors hover:bg-bg-input hover:text-text-primary">Change</button>
                                    </div>
                                </div>
                            )}
                            <main className="custom-scrollbar flex-1 overflow-y-auto bg-bg-primary">
                                <section className="min-h-full px-8 py-8">
                                    <MeetingHistorySection meetings={meetings} onOpenMeeting={handleOpenMeeting} onExportMeeting={handleExportMeeting} onDeleteMeeting={handleDeleteMeeting} onStartMeeting={onStartMeeting} activeMenuId={activeMenuId} onMenuToggle={setActiveMenuId} menuEntered={menuEntered} onMenuEnteredChange={setMenuEntered} />
                                </section>
                            </main>
                        </motion.div>
                    )}
                </AnimatePresence>
            </div>
            <AnimatePresence>
                {showNotification && (
                    <motion.div initial={{ x: 300, opacity: 0, scale: 0.95 }} animate={{ x: 0, opacity: 1, scale: 1 }} exit={{ x: 300, opacity: 0, scale: 0.95 }} className="fixed bottom-10 right-10 z-modal flex items-center gap-4 rounded-2xl border border-border-subtle bg-bg-elevated/90 py-3 pl-4 pr-6 shadow-xl backdrop-blur-xl">
                        <div className="flex h-9 w-9 items-center justify-center rounded-full border border-border-subtle bg-state-info-soft"><RefreshCw size={15} className="animate-spin text-state-info" /></div>
                        <div className="flex flex-col gap-1"><span className="text-sm font-semibold text-text-primary">Refreshed</span><span className="text-xs text-text-tertiary">Synced with calendar</span></div>
                    </motion.div>
                )}
            </AnimatePresence>
            <GlobalChatOverlay isOpen={isGlobalChatOpen} onClose={() => { setIsGlobalChatOpen(false); setSubmittedGlobalQuery(''); }} initialQuery={submittedGlobalQuery} />
        </div>
    );
};
export default Launcher;
