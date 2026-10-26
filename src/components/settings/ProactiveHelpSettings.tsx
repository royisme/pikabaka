import React, { useCallback, useEffect, useState } from 'react';
import type { AgentGateDecision } from '../../types/electron';

type Mode = 'log' | 'on' | 'off';
type Status = Awaited<ReturnType<Window['electronAPI']['agentGateStatus']>>;

const MODE_HELP: Record<Mode, string> = {
    log: 'Judge each line the other party says and keep a log. No card is shown.',
    on: 'Judge each line and show a card when help is wanted.',
    off: 'Do nothing.',
};

const input = 'w-full h-11 bg-bg-input border border-border-subtle rounded-lg px-3 text-sm text-text-primary placeholder-text-tertiary focus:outline-none focus:border-accent-primary transition-colors';

function percent(value?: number): string {
    return value === undefined ? '–' : `${Math.round(value * 100)}%`;
}

/**
 * Settings for the proactive-help gate: which decision model judges the conversation, when it may
 * speak up, and the log of its latest decisions (no speech text is kept in it).
 */
const ProactiveHelpSettings: React.FC = () => {
    const [mode, setMode] = useState<Mode>('log');
    const [model, setModel] = useState('');
    const [baseUrl, setBaseUrl] = useState('');
    const [apiKey, setApiKey] = useState('');
    const [hasApiKey, setHasApiKey] = useState(false);
    const [threshold, setThreshold] = useState(0.7);
    const [cooldownSeconds, setCooldownSeconds] = useState(120);
    const [status, setStatus] = useState<Status | null>(null);
    const [log, setLog] = useState<AgentGateDecision[]>([]);
    const [saved, setSaved] = useState(false);
    const [error, setError] = useState('');

    const refresh = useCallback(async () => {
        const api = window.electronAPI;
        if (!api?.agentGateStatus || !api.agentGateLog) return;
        try {
            const [nextStatus, nextLog] = await Promise.all([api.agentGateStatus(), api.agentGateLog()]);
            setStatus(nextStatus);
            setLog(nextLog);
        } catch {
            // The status is informational; the form still works without it.
        }
    }, []);

    useEffect(() => {
        const api = window.electronAPI;
        if (!api?.agentGateGetSettings) return;
        api.agentGateGetSettings()
            .then((settings) => {
                setMode(settings.mode);
                setModel(settings.model);
                setBaseUrl(settings.baseUrl);
                setHasApiKey(settings.hasApiKey);
                setThreshold(settings.threshold);
                setCooldownSeconds(settings.cooldownSeconds);
            })
            .catch(() => {});
        void refresh();
    }, [refresh]);

    const save = async () => {
        setError('');
        const result = await window.electronAPI.agentGateSetSettings({
            mode,
            model,
            baseUrl,
            threshold,
            cooldownSeconds,
            // An untouched key field leaves the stored key as it is.
            ...(apiKey ? { apiKey } : {}),
        });
        if (!result.success) {
            setError(result.error || 'Could not save');
            return;
        }
        if (apiKey) setHasApiKey(true);
        setApiKey('');
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
        void refresh();
    };

    const clearKey = async () => {
        const result = await window.electronAPI.agentGateSetSettings({ apiKey: '' });
        if (result.success) {
            setHasApiKey(false);
            void refresh();
        }
    };

    const statusLine =
        status?.state === 'unavailable'
            ? `Proactive help unavailable: ${status.reason ?? 'unknown reason'}`
            : status?.state === 'unconfigured'
              ? 'Not configured: set a model, a base URL and a key (a key is optional for a local address).'
              : status?.state === 'ok'
                ? 'Ready.'
                : '';

    return (
        <div>
            <h3 className="text-lg font-bold text-text-primary mb-1">Proactive help</h3>
            <p className="text-xs text-text-secondary mb-5">
                A decision model reads the conversation as it happens and judges whether you would benefit from help right now. It starts in log mode, so nothing appears on screen until you switch it on.
            </p>

            <div className="space-y-4">
                <div className="space-y-1.5">
                    <label className="text-xs font-medium text-text-secondary block">Mode</label>
                    <select value={mode} onChange={(e) => setMode(e.target.value as Mode)} className={input}>
                        <option value="log">Log only</option>
                        <option value="on">Show cards</option>
                        <option value="off">Off</option>
                    </select>
                    <p className="text-[11px] text-text-tertiary leading-snug">{MODE_HELP[mode]}</p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                        <label className="text-xs font-medium text-text-secondary block">Decision model</label>
                        <input type="text" value={model} onChange={(e) => setModel(e.target.value)} placeholder="Model id" className={input} />
                    </div>
                    <div className="space-y-1.5">
                        <label className="text-xs font-medium text-text-secondary block">Base URL</label>
                        <input type="text" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="http://localhost:3425/v1" className={input} />
                    </div>
                </div>
                <p className="text-[11px] text-text-tertiary leading-snug">Requests go to the base URL followed by /systemone.</p>

                <div className="space-y-1.5">
                    <label className="text-xs font-medium text-text-secondary block">API key</label>
                    <div className="flex items-center gap-2">
                        <input
                            type="password"
                            value={apiKey}
                            onChange={(e) => setApiKey(e.target.value)}
                            placeholder={hasApiKey ? 'Saved. Type to replace.' : 'Optional for a local address'}
                            autoComplete="off"
                            className={input}
                        />
                        {hasApiKey && (
                            <button onClick={clearKey} className="shrink-0 h-11 px-3 rounded-lg text-xs font-medium border border-border-subtle text-text-secondary hover:text-text-primary transition-colors">
                                Remove
                            </button>
                        )}
                    </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                        <label className="text-xs font-medium text-text-secondary block">Threshold: {percent(threshold)}</label>
                        <input
                            type="range"
                            min={0}
                            max={1}
                            step={0.05}
                            value={threshold}
                            onChange={(e) => setThreshold(Number(e.target.value))}
                            className="w-full"
                        />
                        <p className="text-[11px] text-text-tertiary leading-snug">Help is offered only when the model is at least this sure.</p>
                    </div>
                    <div className="space-y-1.5">
                        <label className="text-xs font-medium text-text-secondary block">Cooldown (seconds)</label>
                        <input
                            type="number"
                            min={0}
                            max={86400}
                            value={cooldownSeconds}
                            onChange={(e) => setCooldownSeconds(Math.max(0, Number(e.target.value) || 0))}
                            className={input}
                        />
                        <p className="text-[11px] text-text-tertiary leading-snug">At most one card in this time.</p>
                    </div>
                </div>

                <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                    <button
                        onClick={save}
                        className={`px-4 py-2 rounded-lg text-xs font-medium transition-colors ${saved ? 'bg-state-success-soft text-state-success' : 'bg-bg-input hover:bg-bg-input/80 border border-border-subtle text-text-primary'}`}
                    >
                        {saved ? 'Saved!' : 'Save proactive help settings'}
                    </button>
                    {statusLine && (
                        <p className={`text-[11px] sm:pl-1 ${status?.state === 'unavailable' ? 'text-state-danger' : 'text-text-tertiary'}`}>{statusLine}</p>
                    )}
                </div>
                {error && <p className="text-[11px] text-state-danger">{error}</p>}

                <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                        <label className="text-xs font-medium text-text-secondary block">Latest decisions</label>
                        <button onClick={() => void refresh()} className="text-[11px] text-text-tertiary hover:text-text-primary transition-colors">
                            Refresh
                        </button>
                    </div>
                    {log.length === 0 ? (
                        <p className="text-[11px] text-text-tertiary">No decisions yet. They appear here during a meeting.</p>
                    ) : (
                        <div className="overflow-x-auto rounded-lg border border-border-subtle">
                            <table className="w-full text-[11px] text-text-secondary">
                                <thead className="text-text-tertiary text-left">
                                    <tr>
                                        <th className="px-2 py-1.5 font-medium">Time</th>
                                        <th className="px-2 py-1.5 font-medium">Help</th>
                                        <th className="px-2 py-1.5 font-medium">Kind</th>
                                        <th className="px-2 py-1.5 font-medium">Latency</th>
                                        <th className="px-2 py-1.5 font-medium">Outcome</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {log.map((decision) => (
                                        <tr key={`${decision.segmentId}-${decision.revision}-${decision.time}`} className="border-t border-border-subtle">
                                            <td className="px-2 py-1.5 whitespace-nowrap">{new Date(decision.time).toLocaleTimeString()}</td>
                                            <td className="px-2 py-1.5">{percent(decision.help)}</td>
                                            <td className="px-2 py-1.5">{decision.kind ? decision.kind.replace('_', ' ') : '–'}</td>
                                            <td className="px-2 py-1.5 whitespace-nowrap">{decision.latencyMs === undefined ? '–' : `${decision.latencyMs} ms`}</td>
                                            <td className="px-2 py-1.5">{decision.outcome}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default ProactiveHelpSettings;
