import React, { useEffect, useState } from 'react';
import { useQuery } from 'react-query';
import { ArrowDownCircle, ArrowUpCircle, CheckCircle, AlertCircle, LoaderCircle } from 'lucide-react';
import packageJson from '../../package.json';
import { useMainEvent } from '../hooks/useMainEvent';

type UpdateStatus =
    | { kind: 'idle' | 'checking' | 'uptodate' }
    | { kind: 'downloading'; version: string; percent?: number }
    | { kind: 'ready'; version: string }
    | { kind: 'error'; message: string };

function relativeTime(timestamp: number, now: number): string {
    const seconds = Math.max(0, Math.floor((now - timestamp) / 1000));
    if (seconds < 10) return 'just now';
    if (seconds < 60) return `${seconds} sec ago`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)} hr ago`;
    const days = Math.floor(seconds / 86400);
    return `${days} ${days === 1 ? 'day' : 'days'} ago`;
}

export const UpdatesCard: React.FC = () => {
    const [eventStatus, setEventStatus] = useState<UpdateStatus | null>(null);
    const [checkedAt, setCheckedAt] = useState<number | null>(null);
    const [autoCheckDraft, setAutoCheckDraft] = useState<boolean>();
    const [now, setNow] = useState(Date.now);
    const { data, error } = useQuery(
        ['update-state'],
        () => window.electronAPI.getUpdateState(),
        { cacheTime: 0, retry: false, refetchOnWindowFocus: false, refetchOnReconnect: false }
    );

    useEffect(() => {
        const timer = setInterval(() => setNow(Date.now()), 30000);
        return () => clearInterval(timer);
    }, []);

    useMainEvent<void>(window.electronAPI.onUpdateChecking, () => setEventStatus({ kind: 'checking' }));
    useMainEvent(window.electronAPI.onUpdateAvailable, (info: { version: string }) => {
        setEventStatus({ kind: 'downloading', version: info.version });
        setCheckedAt(Date.now());
        setNow(Date.now());
    });
    useMainEvent(window.electronAPI.onDownloadProgress, (progress: { percent: number }) => {
        if (status.kind === 'downloading') {
            setEventStatus({ ...status, percent: progress.percent });
        }
    });
    useMainEvent(window.electronAPI.onUpdateDownloaded, (info: { version: string }) => {
        setEventStatus({ kind: 'ready', version: info.version });
    });
    useMainEvent(window.electronAPI.onUpdateNotAvailable, () => {
        setEventStatus({ kind: 'uptodate' });
        setCheckedAt(Date.now());
        setNow(Date.now());
    });
    useMainEvent(window.electronAPI.onUpdateError, (message: string) => {
        setEventStatus({ kind: 'error', message });
    });

    const status: UpdateStatus = eventStatus ?? (error
        ? { kind: 'error', message: error instanceof Error ? error.message : String(error) }
        : data?.downloadedVersion ? { kind: 'ready', version: data.downloadedVersion }
        : data?.availableVersion ? { kind: 'downloading', version: data.availableVersion }
        : data?.checking ? { kind: 'checking' }
        : data?.lastCheckedAt ? { kind: 'uptodate' }
        : { kind: 'idle' });
    const autoCheck = autoCheckDraft ?? data?.autoCheck ?? true;
    const lastCheckedAt = checkedAt ?? data?.lastCheckedAt;
    const busy = status.kind === 'checking' || status.kind === 'downloading';
    const ready = status.kind === 'ready';
    const statusText = status.kind === 'checking' ? 'Checking for updates'
        : status.kind === 'uptodate' ? 'Up to date'
        : status.kind === 'downloading' ? `Downloading version ${status.version}${status.percent === undefined ? '' : ` · ${Math.round(status.percent)}%`}`
        : status.kind === 'ready' ? `Version ${status.version} is ready to install`
        : status.kind === 'error' ? 'Could not check for updates'
        : 'Not checked yet';
    const StatusIcon = busy ? LoaderCircle : ready ? ArrowUpCircle : status.kind === 'error' ? AlertCircle : CheckCircle;

    const showError = (error: unknown) => {
        setEventStatus({ kind: 'error', message: error instanceof Error ? error.message : String(error) });
    };

    const handleAction = async () => {
        try {
            if (ready) {
                await window.electronAPI.restartAndInstall();
            } else {
                setEventStatus({ kind: 'checking' });
                await window.electronAPI.checkForUpdates();
            }
        } catch (error) {
            showError(error);
        }
    };

    const toggleAutoCheck = async () => {
        const next = !autoCheck;
        setAutoCheckDraft(next);
        try {
            await window.electronAPI.setAutoCheckUpdates(next);
        } catch (error) {
            showError(error);
        }
    };

    return (
        <section className="rounded-xl border border-border-subtle bg-bg-item-surface p-6">
            <h5 className="flex items-center gap-2 text-sm font-semibold text-text-primary mb-5">
                <ArrowDownCircle size={18} className="text-accent-primary" aria-hidden="true" />
                Updates
            </h5>
            <div className="flex items-center justify-between gap-4 text-xs mb-4">
                <span className="text-text-secondary">Current version</span>
                <span className="font-mono text-text-primary">v{packageJson.version}</span>
            </div>
            <div className="flex items-center justify-between gap-4 text-xs">
                <span id="auto-check-updates-label" className="text-text-primary">Automatically check for updates</span>
                <button
                    type="button"
                    role="switch"
                    aria-checked={autoCheck}
                    aria-labelledby="auto-check-updates-label"
                    onClick={toggleAutoCheck}
                    className={`w-11 h-6 shrink-0 rounded-full relative transition-colors ${autoCheck ? 'bg-accent-primary' : 'bg-bg-toggle-switch border border-border-muted'}`}
                >
                    <span className={`absolute top-1 left-1 w-4 h-4 rounded-full bg-white transition-transform ${autoCheck ? 'translate-x-5' : 'translate-x-0'}`} />
                </button>
            </div>
            <div className="border-t border-border-subtle mt-5" />
            <div className="h-16 flex items-center justify-between gap-4">
                <div className="min-w-0 flex items-center gap-2" role="status">
                    {status.kind !== 'idle' && (
                        <StatusIcon size={16} aria-hidden="true" className={`shrink-0 ${busy ? 'animate-spin text-text-secondary' : status.kind === 'error' ? 'text-state-danger' : 'text-state-success'}`} />
                    )}
                    <div className="min-w-0">
                        <p className="text-xs text-text-primary truncate" title={statusText}>{statusText}</p>
                        {status.kind === 'error' && (
                            <p className="text-[11px] text-text-tertiary truncate mt-1" title={status.message}>{status.message}</p>
                        )}
                    </div>
                </div>
                <button
                    type="button"
                    onClick={handleAction}
                    disabled={busy}
                    className={`shrink-0 px-3 py-2 rounded-lg text-xs font-semibold transition-colors disabled:opacity-50 disabled:cursor-wait ${ready ? 'bg-accent-primary text-on-primary hover:bg-accent-secondary' : 'bg-bg-component text-text-primary hover:bg-bg-input'}`}
                >
                    {ready ? 'Restart & Install' : 'Check Now'}
                </button>
            </div>
            <div className="flex items-center justify-between gap-4 text-[11px] text-text-tertiary">
                <span>Last checked</span>
                <span>{lastCheckedAt == null ? 'Never' : relativeTime(lastCheckedAt, now)}</span>
            </div>
        </section>
    );
};
