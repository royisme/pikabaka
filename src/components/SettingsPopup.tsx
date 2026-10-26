import React, { useState, useLayoutEffect, useRef } from 'react';
import { MessageSquare, Link, Camera, Heart, User } from 'lucide-react';
import { useQuery, useQueryClient } from 'react-query';
import { useShortcuts } from '../hooks/useShortcuts';
import { useResolvedTheme } from '../hooks/useResolvedTheme';
import { useMainEvent } from '../hooks/useMainEvent';
import { useLocalStorageValue } from '../hooks/useLocalStorageValue';
import { useProfileStatus } from '../hooks/useProfileStatus';

const SettingsPopup = () => {
    const queryClient = useQueryClient();
    const { shortcuts } = useShortcuts();
    const isLightTheme = useResolvedTheme() === 'light';

    // Profile status query
    const { data: profileStatus } = useProfileStatus();
    const hasProfile = profileStatus?.hasProfile ?? false;
    const [draftProfileMode, setDraftProfileMode] = useState<boolean | null>(null);
    const profileMode = draftProfileMode ?? profileStatus?.profileMode ?? false;

    // Undetectable state: read via query, stream via useMainEvent
    const { data: undetectableData } = useQuery<boolean>(
        ['undetectable'],
        () => window.electronAPI?.getUndetectable?.() ?? Promise.resolve(false)
    );
    const isUndetectable = undetectableData ?? false;
    useMainEvent(window.electronAPI?.onUndetectableChanged, (newState: boolean) => {
        queryClient.setQueryData(['undetectable'], newState);
        localStorage.setItem('pika_undetectable', String(newState));
    });

    // Live transcript: external store via useLocalStorageValue
    const [storedTranscript, setStoredTranscript] = useLocalStorageValue('pika_interviewer_transcript');
    const showTranscript = storedTranscript !== 'false';

    // Action button mode: read via query, stream via useMainEvent
    const actionButtonModeQuery = useQuery<'recap' | 'brainstorm'>(
        ['action-button-mode'],
        async () => {
            const mode = await window.electronAPI?.getActionButtonMode?.();
            return mode ?? 'recap';
        }
    );
    const actionButtonMode = actionButtonModeQuery.data ?? 'recap';
    useMainEvent(window.electronAPI?.onActionButtonModeChanged, (mode: 'recap' | 'brainstorm') => {
        queryClient.setQueryData(['action-button-mode'], mode);
    });

    const contentRef = useRef<HTMLDivElement>(null);

    // Auto-resize Window
    useLayoutEffect(() => {
        if (!contentRef.current) return;

        const observer = new ResizeObserver((entries) => {
            for (const entry of entries) {
                const rect = entry.target.getBoundingClientRect();
                // Send exact dimensions to Electron
                try {
                    // @ts-ignore
                    window.electronAPI?.updateContentDimensions({
                        width: Math.ceil(rect.width),
                        height: Math.ceil(rect.height)
                    });
                } catch (e) {
                    console.warn("Failed to update dimensions", e);
                }
            }
        });

        observer.observe(contentRef.current);
        return () => observer.disconnect();
    }, []);

    const popupPanelClass = isLightTheme
        ? 'bg-[#F3F4F6]/92 border-black/10 shadow-black/10'
        : 'bg-[#1E1E1E]/80 border-white/10 shadow-black/40';
    const itemHoverClass = isLightTheme ? 'hover:bg-black/[0.04]' : 'hover:bg-white/5';
    const labelInactiveClass = isLightTheme ? 'text-text-tertiary group-hover:text-slate-900' : 'text-text-secondary group-hover:text-text-primary';
    const iconInactiveClass = isLightTheme ? 'text-text-secondary group-hover:text-text-tertiary' : 'text-text-secondary group-hover:text-slate-300';
    const dividerClass = isLightTheme ? 'bg-black/[0.06]' : 'bg-white/[0.04]';
    const shortcutKeyClass = isLightTheme
        ? 'border-black/10 bg-black/[0.04] text-text-tertiary'
        : 'border-white/10 bg-white/5 text-text-secondary';
    const defaultToggleTrackClass = isLightTheme ? 'bg-black/[0.22]' : 'bg-white/10';
    const toggleKnobClass = isLightTheme ? 'bg-white shadow-[0_1px_4px_rgba(0,0,0,0.18)]' : 'bg-black shadow-sm';

    return (
        <div className="w-fit h-fit bg-transparent flex flex-col">
            <div ref={contentRef} className={`w-[200px] max-h-[280px] backdrop-blur-md border rounded-[16px] overflow-hidden shadow-2xl p-2 flex flex-col animate-scale-in origin-top-left ${popupPanelClass}`}>
                <div className="flex-1 overflow-y-auto scrollbar-hide flex flex-col min-h-0">

                {/* Undetectability */}
                <div className={`flex items-center justify-between px-3 py-2 rounded-lg transition-colors duration-200 group cursor-default ${itemHoverClass}`}>
                    <div className="flex items-center gap-3">
                        <CustomGhost
                            className={`w-4 h-4 transition-colors ${isUndetectable ? (isLightTheme ? 'text-slate-900' : 'text-white') : iconInactiveClass}`}
                            fill={isUndetectable ? "currentColor" : "none"}
                            stroke={isUndetectable ? "none" : "currentColor"}
                            eyeColor={isUndetectable ? (isLightTheme ? "white" : "black") : (isLightTheme ? "#334155" : "white")}
                        />
                        <span className={`text-[12px] font-medium transition-colors ${isUndetectable ? (isLightTheme ? 'text-slate-950' : 'text-white') : labelInactiveClass}`}>{isUndetectable ? 'Undetectable' : 'Detectable'}</span>
                    </div>
                    <button
                        onClick={() => {
                            const newState = !isUndetectable;
                            queryClient.setQueryData(['undetectable'], newState);
                            localStorage.setItem('pika_undetectable', String(newState));
                            window.electronAPI?.setUndetectable(newState);
                        }}
                        className={`w-[30px] h-[18px] rounded-full p-[1.5px] transition-all duration-300 ease-spring active:scale-[0.92] ${isUndetectable
                            ? (isLightTheme ? 'bg-slate-900 shadow-[0_2px_8px_rgba(15,23,42,0.18)]' : 'bg-white shadow-[0_2px_8px_rgba(255,255,255,0.2)]')
                            : defaultToggleTrackClass}`}
                    >
                        <div className={`w-[15px] h-[15px] rounded-full transition-transform duration-300 ease-spring ${toggleKnobClass} ${isUndetectable ? 'translate-x-[12px]' : 'translate-x-0'}`} />
                    </button>
                </div>


                {/* Interviewer Transcript Toggle */}
                <div className={`flex items-center justify-between px-3 py-2 rounded-lg transition-colors duration-200 group cursor-default ${itemHoverClass}`}>
                    <div className="flex items-center gap-3">
                        <MessageSquare
                            className={`w-3.5 h-3.5 transition-colors ${showTranscript ? 'text-state-success' : iconInactiveClass}`}
                            fill={showTranscript ? "currentColor" : "none"}
                        />
                        <span className={`text-[12px] font-medium transition-colors ${showTranscript ? (isLightTheme ? 'text-slate-950' : 'text-white') : labelInactiveClass}`}>Live transcript</span>
                    </div>
                    <button
                        onClick={() => {
                            const newState = !showTranscript;
                            setStoredTranscript(String(newState));
                            // Dispatch event for same-window listeners
                            window.dispatchEvent(new Event('storage'));
                        }}
                        className={`w-[30px] h-[18px] rounded-full p-[1.5px] transition-all duration-300 ease-spring active:scale-[0.92] ${showTranscript ? 'bg-state-success shadow-[0_2px_10px_rgba(16,185,129,0.3)]' : defaultToggleTrackClass}`}
                    >
                        <div className={`w-[15px] h-[15px] rounded-full transition-transform duration-300 ease-spring ${toggleKnobClass} ${showTranscript ? 'translate-x-[12px]' : 'translate-x-0'}`} />
                    </button>
                </div>

                {/* Interview Mode (Brainstorm) Toggle */}
                <div className={`flex items-center justify-between px-3 py-2 rounded-lg transition-colors duration-200 group cursor-default ${itemHoverClass}`}>
                    <div className="flex items-center gap-3">
                        <svg
                            xmlns="http://www.w3.org/2000/svg"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            className={`w-3.5 h-3.5 transition-colors ${actionButtonMode === 'brainstorm' ? 'text-violet-400' : iconInactiveClass}`}
                        >
                            <line x1="6" y1="3" x2="6" y2="15" />
                            <circle cx="18" cy="6" r="3" />
                            <circle cx="6" cy="18" r="3" />
                            <path d="M18 9a9 9 0 0 1-9 9" />
                        </svg>
                        <span className={`text-[12px] font-medium transition-colors ${actionButtonMode === 'brainstorm' ? (isLightTheme ? 'text-slate-950' : 'text-white') : labelInactiveClass}`}>Interview mode</span>
                    </div>
                    <button
                        onClick={async () => {
                            const newMode: 'recap' | 'brainstorm' = actionButtonMode === 'brainstorm' ? 'recap' : 'brainstorm';
                            queryClient.setQueryData(['action-button-mode'], newMode);
                            try {
                                await window.electronAPI?.setActionButtonMode?.(newMode);
                            } catch (e) { console.error(e); }
                        }}
                        className={`w-[30px] h-[18px] rounded-full p-[1.5px] transition-all duration-300 ease-spring active:scale-[0.92] ${actionButtonMode === 'brainstorm' ? 'bg-violet-500 shadow-[0_2px_10px_rgba(139,92,246,0.3)]' : defaultToggleTrackClass}`}
                    >
                        <div className={`w-[15px] h-[15px] rounded-full transition-transform duration-300 ease-spring ${toggleKnobClass} ${actionButtonMode === 'brainstorm' ? 'translate-x-[12px]' : 'translate-x-0'}`} />
                    </button>
                </div>

                {/* Profile Mode Toggle */}
                {hasProfile && (
                    <div className={`flex items-center justify-between px-3 py-2 rounded-lg transition-colors duration-200 group ${itemHoverClass} cursor-default`}>
                        <div className="flex items-center gap-3">
                            <User
                                className={`w-3.5 h-3.5 transition-colors ${profileMode ? 'text-accent-primary' : iconInactiveClass}`}
                                fill={profileMode ? "currentColor" : "none"}
                            />
                            <span className={`text-[12px] font-medium transition-colors ${profileMode ? (isLightTheme ? 'text-slate-950' : 'text-white') : labelInactiveClass}`}>Profile Mode</span>
                        </div>
                        <button
                            onClick={async () => {
                                const newState = !profileMode;
                                setDraftProfileMode(newState);
                                try {
                                    await window.electronAPI?.profileSetMode?.(newState);
                                    await queryClient.invalidateQueries(['profile', 'status']);
                                } catch (e) {
                                    console.error(e);
                                } finally {
                                    setDraftProfileMode(null);
                                }
                            }}
                            className={`w-[30px] h-[18px] rounded-full p-[1.5px] transition-all duration-300 ease-spring active:scale-[0.92] ${profileMode ? 'bg-accent-primary shadow-[0_2px_10px_rgba(var(--color-accent-primary),0.3)]' : defaultToggleTrackClass}`}
                        >
                            <div className={`w-[15px] h-[15px] rounded-full transition-transform duration-300 ease-spring ${toggleKnobClass} ${profileMode ? 'translate-x-[12px]' : 'translate-x-0'}`} />
                        </button>
                    </div>
                )}

                <div className={`h-px my-0.5 mx-2 ${dividerClass}`} />

                {/* Show/Hide Pika */}
                <div className={`flex items-center justify-between px-3 py-2 rounded-lg transition-colors duration-200 group interaction-base interaction-press ${itemHoverClass}`}>
                    <div className="flex items-center gap-3">
                        <MessageSquare className={`w-3.5 h-3.5 transition-colors ${iconInactiveClass}`} />
                        <span className={`text-[12px] transition-colors ${labelInactiveClass}`}>Show or hide Pika</span>
                    </div>
                    <div className="flex gap-1">
                        {/* Dynamic Keys for Toggle Visibility */}
                        {(shortcuts.toggleVisibility || ['⌘', 'B']).map((key, index) => (
                            <div key={index} className={`px-1.5 py-0.5 rounded border text-[11px] font-medium min-w-[20px] text-center ${shortcutKeyClass}`}>
                                {key}
                            </div>
                        ))}
                    </div>
                </div>

                {/* Screenshot */}
                <div className={`flex items-center justify-between px-3 py-2 rounded-lg transition-colors duration-200 group interaction-base interaction-press ${itemHoverClass}`}>
                    <div className="flex items-center gap-3">
                        <Camera className={`w-3.5 h-3.5 transition-colors ${iconInactiveClass}`} />
                        <span className={`text-[12px] transition-colors ${labelInactiveClass}`}>Take screenshot</span>
                    </div>
                    <div className="flex gap-1">
                        {/* Dynamic Keys for Take Screenshot */}
                        {(shortcuts.takeScreenshot || ['⌘', 'H']).map((key, index) => (
                            <div key={index} className={`px-1.5 py-0.5 rounded border text-[11px] font-medium min-w-[20px] text-center ${shortcutKeyClass}`}>
                                {key}
                            </div>
                        ))}
                    </div>
                </div>

                <div className={`h-px my-0.5 mx-2 ${dividerClass}`} />

                {/* Donate */}
                <div
                    // @ts-ignore
                    onClick={() => window.electronAPI.openExternal('https://buymeacoffee.com/royisme')}
                    className="flex items-center justify-between px-3 py-2 hover:bg-pink-500/10 rounded-lg transition-colors duration-200 group interaction-base interaction-press"
                >
                    <div className="flex items-center gap-3">
                        <Heart className="w-3.5 h-3.5 text-pink-400 group-hover:fill-pink-400 transition-all duration-300" />
                        <span className={`text-[12px] transition-colors ${isLightTheme ? 'text-text-tertiary group-hover:text-pink-700' : 'text-text-secondary group-hover:text-pink-100'}`}>Donate</span>
                    </div>
                    <div className="opacity-60 group-hover:opacity-100 transition-opacity">
                        <Link className={`w-3 h-3 group-hover:text-pink-400 ${isLightTheme ? 'text-text-tertiary' : 'text-text-secondary'}`} />
                    </div>
                </div>

                </div>
            </div>
        </div>
    );
};

interface CustomGhostProps {
    className?: string;
    fill?: string;
    stroke?: string;
    eyeColor?: string;
}

// Custom Ghost with dynamic eye color support
const CustomGhost = ({ className, fill, stroke, eyeColor }: CustomGhostProps) => (
    <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill={fill || "none"}
        stroke={stroke || "currentColor"}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className={className}
    >
        {/* Body */}
        <path d="M12 2a8 8 0 0 0-8 8v12l3-3 2.5 2.5L12 19l2.5 2.5L17 19l3 3V10a8 8 0 0 0-8-8z" />
        {/* Eyes - No stroke, just fill */}
        <path
            d="M9 10h.01 M15 10h.01"
            stroke={eyeColor || "currentColor"}
            strokeWidth="2.5" // Slightly bolder for visibility
            fill="none"
        />
    </svg>
);

export default SettingsPopup;
