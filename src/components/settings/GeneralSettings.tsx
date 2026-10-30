import React, { useState, useEffect, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
    Check, ChevronDown, ExternalLink, Eye, Ghost, MessageSquare, Mic, Monitor, Moon, Palette,
    PointerOff, Power, Shield, Sun, Terminal, AlertCircle
} from 'lucide-react';
import { useWindowEvent } from '../../hooks/useWindowEvent';
import { useMainEvent } from '../../hooks/useMainEvent';
import { useLocalStorageValue } from '../../hooks/useLocalStorageValue';
import { useResolvedTheme } from '../../hooks/useResolvedTheme';
import {
    clampOverlayOpacity,
    OVERLAY_OPACITY_MIN,
    getDefaultOverlayOpacity,
} from '../../lib/overlayAppearance';

/**
 * The "General" tab: its state, effects and handlers run in the settings overlay's own render
 * (the shell calls the hook unconditionally, in the same order every time); below only draws them.
 */

export function useGeneralSettings(isOpen: boolean) {
    const isLight = useResolvedTheme() === 'light';
    const queryClient = useQueryClient();

    // General Settings (queries + main event subscriptions)
    const { data: isUndetectable = false } = useQuery<boolean>({ queryKey: ['undetectable'], queryFn: () => window.electronAPI?.getUndetectable?.() ?? Promise.resolve(false), enabled: isOpen && !!window.electronAPI?.getUndetectable });
    useMainEvent(window.electronAPI?.onUndetectableChanged, (newState: boolean) => {
        queryClient.setQueryData(['undetectable'], newState);
    });

    const { data: isMousePassthrough = false } = useQuery<boolean>({ queryKey: ['overlay-mouse-passthrough'], queryFn: () => window.electronAPI?.getOverlayMousePassthrough?.() ?? Promise.resolve(false), enabled: isOpen && !!window.electronAPI?.getOverlayMousePassthrough });
    useMainEvent(window.electronAPI?.onOverlayMousePassthroughChanged, (enabled: boolean) => {
        queryClient.setQueryData(['overlay-mouse-passthrough'], enabled);
    });

    const { data: openOnLogin = false } = useQuery<boolean>({ queryKey: ['settings', 'open-at-login'], queryFn: () => window.electronAPI?.getOpenAtLogin?.() ?? Promise.resolve(false), enabled: isOpen && !!window.electronAPI?.getOpenAtLogin });

    const { data: themeMode = 'system' } = useQuery<'system' | 'light' | 'dark'>({ queryKey: ['settings', 'theme-mode'], queryFn: async () => {
            const res = await window.electronAPI?.getThemeMode?.();
            return (res?.mode as 'system' | 'light' | 'dark') ?? 'system';
        }, enabled: isOpen && !!window.electronAPI?.getThemeMode });

    const { data: verboseLogging = false } = useQuery<boolean>({ queryKey: ['settings', 'verbose-logging'], queryFn: () => window.electronAPI?.getVerboseLogging?.() ?? Promise.resolve(false), enabled: isOpen && !!window.electronAPI?.getVerboseLogging });

    const { data: permissionStatus = null } = useQuery<{ microphone: string; screen: string } | null>({ queryKey: ['settings', 'permission-status'], queryFn: () => window.electronAPI?.getPermissionStatus?.() ?? Promise.resolve(null), enabled: isOpen && !!window.electronAPI?.getPermissionStatus });

    const [isThemeDropdownOpen, setIsThemeDropdownOpen] = useState(false);
    const themeDropdownRef = useRef<HTMLDivElement>(null);

    useWindowEvent(
        'mousedown',
        (event) => {
            if (isThemeDropdownOpen && themeDropdownRef.current && !themeDropdownRef.current.contains(event.target as Node)) {
                setIsThemeDropdownOpen(false);
            }
        },
        'document'
    );

    const [storedTranscript, setStoredTranscript] = useLocalStorageValue('pika_them_transcript');
    const showTranscript = storedTranscript !== 'false';

    // Overlay Opacity state
    const [overlayOpacity, setOverlayOpacity] = useState<number>(() => {
        const stored = localStorage.getItem('pika_overlay_opacity');
        const parsed = stored ? parseFloat(stored) : NaN;
        // Treat missing value or the old default (0.65) as "not user-set"
        const isUserSet = Number.isFinite(parsed) && parsed !== getDefaultOverlayOpacity();
        return isUserSet ? clampOverlayOpacity(parsed) : getDefaultOverlayOpacity();
    });

    // When the theme changes and the user hasn't saved a custom value, reset to theme-aware default
    const resolvedTheme = useResolvedTheme();
    const [prevTheme, setPrevTheme] = useState(resolvedTheme);
    if (resolvedTheme !== prevTheme) {
        setPrevTheme(resolvedTheme);
        const stored = localStorage.getItem('pika_overlay_opacity');
        const parsed = stored ? parseFloat(stored) : NaN;
        const isUserSet = Number.isFinite(parsed) && parsed !== getDefaultOverlayOpacity();
        if (!isUserSet) {
            const next = getDefaultOverlayOpacity();
            setOverlayOpacity(next);
        }
    }

    const handleOpacityChange = (val: number) => {
        setOverlayOpacity(val);
        // Keep the live meeting overlay in sync while the slider moves.
        window.electronAPI?.setOverlayOpacity?.(val);
    };

    useEffect(() => {
        // Debounce storage writes; handleOpacityChange sends live IPC updates.
        const timeoutId = setTimeout(() => {
            localStorage.setItem('pika_overlay_opacity', String(overlayOpacity));
        }, 150);
        return () => clearTimeout(timeoutId);
    }, [overlayOpacity]);

    // Theme Handlers
    const handleSetTheme = async (mode: 'system' | 'light' | 'dark') => {
        queryClient.setQueryData(['settings', 'theme-mode'], mode);
        if (window.electronAPI?.setThemeMode) {
            await window.electronAPI.setThemeMode(mode);
        }
    };

    return {
        isLight,
        isUndetectable,
        isMousePassthrough,
        openOnLogin,
        themeMode,
        verboseLogging,
        permissionStatus,
        queryClient,
        isThemeDropdownOpen,
        setIsThemeDropdownOpen,
        themeDropdownRef,
        storedTranscript,
        setStoredTranscript,
        showTranscript,
        overlayOpacity,
        handleOpacityChange,
        handleSetTheme,
    };
}

export function renderGeneralSettings(state: ReturnType<typeof useGeneralSettings>) {
    const {
        isLight,
        isUndetectable,
        isMousePassthrough,
        openOnLogin,
        themeMode,
        verboseLogging,
        permissionStatus,
        queryClient,
        isThemeDropdownOpen,
        setIsThemeDropdownOpen,
        themeDropdownRef,
        setStoredTranscript,
        showTranscript,
        overlayOpacity,
        handleOpacityChange,
        handleSetTheme,
    } = state;

    return (
        <div className="space-y-6 animated fadeIn">
            <div className="space-y-3.5">
                {/* UndetectableToggle */}
                <div className={`${isLight ? 'bg-bg-card' : 'bg-bg-item-surface'} rounded-xl p-5 border border-border-subtle flex items-center justify-between transition-all ${isUndetectable ? 'shadow-lg shadow-blue-500/10' : ''}`}>
                    <div className="flex flex-col gap-1">
                        <div className="flex items-center gap-2">
                            {isUndetectable ? (
                                <svg
                                    width="18"
                                    height="18"
                                    viewBox="0 0 24 24"
                                    fill="none"
                                    stroke="currentColor"
                                    strokeWidth="2"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    className="text-text-primary"
                                >
                                    <path d="M12 2a8 8 0 0 0-8 8v12l3-3 2.5 2.5L12 19l2.5 2.5L17 19l3 3V10a8 8 0 0 0-8-8z" fill="currentColor" stroke="currentColor" />
                                    <path d="M9 10h.01" stroke="var(--bg-item-surface)" strokeWidth="2.5" />
                                    <path d="M15 10h.01" stroke="var(--bg-item-surface)" strokeWidth="2.5" />
                                </svg>
                            ) : (
                                <Ghost size={18} className="text-text-primary" />
                            )}
                            <h3 className="text-lg font-bold text-text-primary">Hide from screen share</h3>
                        </div>
                        <p className="text-xs text-text-secondary">
                            Asks macOS and Windows to keep Pika's windows out of screen sharing and recording. Not guaranteed: macOS apps that record with ScreenCaptureKit can still capture them. Not supported on Linux.
                        </p>
                    </div>
                    <button
                        type="button"
                        role="switch"
                        aria-label="Hide from screen share"
                        aria-pressed={isUndetectable}
                        aria-checked={isUndetectable}
                        onClick={() => {
                            const newState = !isUndetectable;
                            queryClient.setQueryData(['undetectable'], newState);
                            window.electronAPI?.setUndetectable(newState);
                            // Analytics: Undetectable Mode Toggle
                        }}
                        className={`w-11 h-6 shrink-0 rounded-full relative transition-colors ${isUndetectable ? 'bg-accent-primary' : 'bg-bg-toggle-switch border border-border-muted'}`}
                    >
                        <div className={`absolute top-1 left-1 w-4 h-4 rounded-full bg-white transition-transform ${isUndetectable ? 'translate-x-5' : 'translate-x-0'}`} />
                    </button>
                </div>

                {/* Mouse Passthrough Toggle — Adapted from public PR #113 */}
                <div className={`${isLight ? 'bg-bg-card' : 'bg-bg-item-surface'} rounded-xl p-5 border border-border-subtle flex items-center justify-between transition-all ${isMousePassthrough ? 'shadow-lg shadow-sky-500/10' : ''}`}>
                    <div className="flex flex-col gap-1">
                        <div className="flex items-center gap-2">
                            <PointerOff size={18} className={isMousePassthrough ? 'text-state-info' : 'text-text-primary'} />
                            <h3 className="text-lg font-bold text-text-primary">Mouse Passthrough</h3>
                        </div>
                        <p className="text-xs text-text-secondary">
                            Overlay stays visible but lets all mouse clicks pass through to the app beneath.
                        </p>
                    </div>
                    <div
                        onClick={() => {
                            const newState = !isMousePassthrough;
                            queryClient.setQueryData(['overlay-mouse-passthrough'], newState);
                            window.electronAPI?.setOverlayMousePassthrough(newState);
                        }}
                        className={`w-11 h-6 rounded-full relative transition-colors cursor-pointer ${isMousePassthrough ? 'bg-state-info' : 'bg-bg-toggle-switch border border-border-muted'}`}
                    >
                        <div className={`absolute top-1 left-1 w-4 h-4 rounded-full bg-white transition-transform ${isMousePassthrough ? 'translate-x-5' : 'translate-x-0'}`} />
                    </div>
                </div>

                <div>
                    <h3 className="text-lg font-bold text-text-primary mb-1">General settings</h3>
                    <p className="text-xs text-text-secondary mb-2">Customize how Pika works for you</p>

                    {/* System Permissions Status */}
                    {permissionStatus && (
                        <div className={`${isLight ? 'bg-bg-card' : 'bg-bg-item-surface'} rounded-xl p-4 border border-border-subtle mb-3`}>
                            <div className="flex items-center gap-2 mb-3">
                                <Shield size={16} className="text-text-secondary" />
                                <h4 className="text-sm font-bold text-text-primary">System Permissions</h4>
                            </div>
                            <div className="space-y-2">
                                {([
                                    { key: 'microphone' as const, label: 'Microphone', icon: <Mic size={15} /> },
                                    { key: 'screen' as const, label: 'Screen Recording', icon: <Monitor size={15} /> },
                                ]).map(({ key, label, icon }) => {
                                    const granted = permissionStatus[key] === 'granted';
                                    return (
                                        <div key={key} className="flex items-center justify-between">
                                            <div className="flex items-center gap-2.5">
                                                <span className="text-text-tertiary">{icon}</span>
                                                <span className="text-xs text-text-primary">{label}</span>
                                            </div>
                                            {granted ? (
                                                <div className="flex items-center gap-1.5">
                                                    <Check size={13} className="text-state-success" />
                                                    <span className="text-xs text-state-success">Granted</span>
                                                </div>
                                            ) : (
                                                <button
                                                    onClick={() => window.electronAPI?.openPrivacySettings(key)}
                                                    className="flex items-center gap-1.5 text-xs text-state-warning hover:text-amber-300 transition-colors"
                                                >
                                                    <AlertCircle size={13} />
                                                    <span>Not granted</span>
                                                    <ExternalLink size={11} />
                                                </button>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    )}

                    <div className={`rounded-xl border ${isLight ? 'bg-bg-card border-border-subtle divide-y divide-border-subtle' : 'bg-transparent border-transparent divide-y divide-border-subtle/20'}`}>
                    <div className="space-y-0">
                        {/* Open at Login */}
                        <div className="flex items-center justify-between px-4 py-3">
                            <div className="flex items-center gap-4">
                                <div className="w-10 h-10 bg-bg-item-surface rounded-lg border border-border-subtle flex items-center justify-center text-text-tertiary">
                                    <Power size={20} />
                                </div>
                                <div>
                                    <h3 className="text-sm font-bold text-text-primary">Open Pika when you log in</h3>
                                    <p className="text-xs text-text-secondary mt-0.5">Pika will open automatically when you log in to your computer</p>
                                </div>
                            </div>
                            <div
                                onClick={() => {
                                    const newState = !openOnLogin;
                                    queryClient.setQueryData(['settings', 'open-at-login'], newState);
                                    window.electronAPI?.setOpenAtLogin(newState);
                                }}
                                className={`w-11 h-6 rounded-full relative transition-colors ${openOnLogin ? 'bg-accent-primary' : 'bg-bg-toggle-switch border border-border-muted'}`}
                            >
                                <div className={`absolute top-1 left-1 w-4 h-4 rounded-full bg-white transition-transform ${openOnLogin ? 'translate-x-5' : 'translate-x-0'}`} />
                            </div>
                        </div>

                        {/* Debug Logging */}
                        <div className="flex items-center justify-between px-4 py-3">
                            <div className="flex items-center gap-4">
                                <div className={`w-10 h-10 bg-bg-item-surface rounded-lg border flex items-center justify-center transition-colors ${verboseLogging ? 'border-state-warning-border text-state-warning' : 'border-border-subtle text-text-tertiary'}`}>
                                    <Terminal size={20} />
                                </div>
                                <div>
                                    <h3 className="text-sm font-bold text-text-primary">Verbose debug logging</h3>
                                    <p className="text-xs text-text-secondary mt-0.5">Print detailed audio, STT, and pipeline diagnostics to the terminal</p>
                                </div>
                            </div>
                            <div
                                onClick={() => {
                                    const newState = !verboseLogging;
                                    queryClient.setQueryData(['settings', 'verbose-logging'], newState);
                                    window.electronAPI?.setVerboseLogging?.(newState);
                                }}
                                className={`w-11 h-6 rounded-full relative transition-colors ${verboseLogging ? 'bg-state-warning' : 'bg-bg-toggle-switch border border-border-muted'}`}
                            >
                                <div className={`absolute top-1 left-1 w-4 h-4 rounded-full bg-white transition-transform ${verboseLogging ? 'translate-x-5' : 'translate-x-0'}`} />
                            </div>
                        </div>

                        {/* Live transcript */}
                        <div className="flex items-center justify-between px-4 py-3">
                            <div className="flex items-center gap-4">
                                <div className="w-10 h-10 bg-bg-item-surface rounded-lg border border-border-subtle flex items-center justify-center text-text-tertiary">
                                    <MessageSquare size={20} />
                                </div>
                                <div>
                                    <h3 className="text-sm font-bold text-text-primary">Live transcript</h3>
                                    <p className="text-xs text-text-secondary mt-0.5">Show the live transcript for both the other party and you</p>
                                </div>
                            </div>
                            <div
                                onClick={() => {
                                    setStoredTranscript(showTranscript ? 'false' : 'true');
                                }}
                                className={`w-11 h-6 rounded-full relative transition-colors ${showTranscript ? 'bg-accent-primary' : 'bg-bg-toggle-switch border border-border-muted'}`}
                            >
                                <div className={`absolute top-1 left-1 w-4 h-4 rounded-full bg-white transition-transform ${showTranscript ? 'translate-x-5' : 'translate-x-0'}`} />
                            </div>
                        </div>


                        {/* Theme */}
                        <div className="flex items-center justify-between px-4 py-3">
                            <div className="flex items-center gap-4">
                                <div className="w-10 h-10 bg-bg-item-surface rounded-lg border border-border-subtle flex items-center justify-center text-text-tertiary">
                                    <Palette size={20} />
                                </div>
                                <div>
                                    <h3 className="text-sm font-bold text-text-primary">Theme</h3>
                                    <p className="text-xs text-text-secondary mt-0.5">Customize how Pika looks on your device</p>
                                </div>
                            </div>

                            <div className="relative" ref={themeDropdownRef}>
                                <button
                                    onClick={() => setIsThemeDropdownOpen(!isThemeDropdownOpen)}
                                    className="bg-bg-component hover:bg-bg-elevated border border-border-subtle text-text-primary px-3 py-1.5 rounded-lg text-xs font-medium transition-colors flex items-center gap-2 min-w-[110px] justify-between"
                                >
                                    <div className="flex items-center gap-2 overflow-hidden">
                                        <span className="text-text-secondary shrink-0">
                                            {themeMode === 'system' && <Monitor size={14} />}
                                            {themeMode === 'light' && <Sun size={14} />}
                                            {themeMode === 'dark' && <Moon size={14} />}
                                        </span>
                                        <span className="capitalize text-ellipsis overflow-hidden whitespace-nowrap">{themeMode}</span>
                                    </div>
                                    <ChevronDown size={12} className={`shrink-0 transition-transform ${isThemeDropdownOpen ? 'rotate-180' : ''}`} />
                                </button>

                                {/* Dropdown Menu */}
                                {isThemeDropdownOpen && (
                                    <div className="absolute right-0 top-full mt-1 min-w-full w-max bg-bg-elevated border border-border-subtle rounded-lg shadow-xl overflow-hidden z-20 p-1 animated fadeIn select-none">
                                        {[
                                            { mode: 'system', label: 'System', icon: <Monitor size={14} /> },
                                            { mode: 'light', label: 'Light', icon: <Sun size={14} /> },
                                            { mode: 'dark', label: 'Dark', icon: <Moon size={14} /> }
                                        ].map((option) => (
                                            <button
                                                key={option.mode}
                                                onClick={() => {
                                                    handleSetTheme(option.mode as any);
                                                    setIsThemeDropdownOpen(false);
                                                }}
                                                className={`w-full text-left px-2 py-1.5 rounded-md text-xs flex items-center gap-2 transition-colors ${themeMode === option.mode ? 'text-text-primary bg-bg-item-active/50' : 'text-text-secondary hover:bg-bg-input hover:text-text-primary'}`}
                                            >
                                                <span className={themeMode === option.mode ? 'text-text-primary' : 'text-text-secondary group-hover:text-text-primary'}>{option.icon}</span>
                                                <span className="font-medium">{option.label}</span>
                                            </button>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </div>

                    </div>
                    </div>

                        <div className={`${isLight ? 'bg-bg-card' : 'bg-bg-item-surface'} rounded-xl p-5 border border-border-subtle mt-4`}>
                            <div className="flex items-center justify-between mb-3">
                                <label htmlFor="overlay-opacity" className="flex items-center gap-2 text-xs font-medium text-text-secondary">
                                    <Eye size={13} className="text-text-secondary" />
                                    Overlay opacity
                                </label>
                                <span className="text-xs font-semibold text-text-primary tabular-nums">
                                    {Math.round(overlayOpacity * 100)}%
                                </span>
                            </div>

                            <input
                                id="overlay-opacity"
                                type="range"
                                aria-describedby="overlay-opacity-help"
                                min={OVERLAY_OPACITY_MIN}
                                max={1.0}
                                step={0.01}
                                value={overlayOpacity}
                                onChange={(e) => handleOpacityChange(parseFloat(e.target.value))}
                                className="w-full h-1.5 rounded-full appearance-none bg-border-muted accent-accent-primary"
                                style={{ WebkitAppearance: 'none' } as React.CSSProperties}
                            />

                            <p id="overlay-opacity-help" className="text-xs text-text-tertiary mt-2">
                                Lowering this makes the panel only slightly more transparent; an opacity floor keeps text behind it hidden.
                            </p>
                        </div>

                </div>

            </div>

        </div>
    );
}
