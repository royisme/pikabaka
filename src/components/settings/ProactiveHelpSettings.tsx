import React, { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
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
const ProactiveHelpSettings = ({ onOpenProviders }: { onOpenProviders: () => void }) => {
    const queryClient = useQueryClient();
    const settings = useQuery({ queryKey: ['agent-gate-settings'], queryFn: () => window.electronAPI.agentGateGetSettings() });
    const status = useQuery<Status>({ queryKey: ['agent-gate-status'], queryFn: () => window.electronAPI.agentGateStatus() });
    const log = useQuery<AgentGateDecision[]>({ queryKey: ['agent-gate-log'], queryFn: () => window.electronAPI.agentGateLog() });

    // What is typed is a draft over the saved settings.
    const [draft, setDraft] = useState<{ mode?: Mode; model?: string; threshold?: number; cooldownSeconds?: number }>({});
    const saved = settings.data;
    const mode: Mode = draft.mode ?? saved?.mode ?? 'log';
    const model = draft.model ?? saved?.model ?? '';
    const baseUrl = saved?.baseUrl ?? '';
    const threshold = draft.threshold ?? saved?.threshold ?? 0.7;
    const cooldownSeconds = draft.cooldownSeconds ?? saved?.cooldownSeconds ?? 120;
    const decisions = log.data ?? [];

    const refreshAll = async () => {
        await Promise.all([
            queryClient.invalidateQueries({ queryKey: ['agent-gate-settings'] }),
            queryClient.invalidateQueries({ queryKey: ['agent-gate-status'] }),
            queryClient.invalidateQueries({ queryKey: ['agent-gate-log'] }),
        ]);
    };

    const save = useMutation({ mutationFn: async () => {
            const result = await window.electronAPI.agentGateSetSettings({
                mode,
                model,
                threshold,
                cooldownSeconds,
            });
            if (!result.success) throw new Error(result.error || 'Could not save');
        }, onSuccess: async () => {
                await refreshAll();
                setDraft({});
            } });

    // The test uses the draft model with the saved service URL and key.
    const test = useMutation({ mutationFn: () => window.electronAPI.agentGateTest({ model, baseUrl }) });

    // "Saved!" shows while the draft is empty after a successful save, so it clears itself when you edit again.
    const showSaved = save.isSuccess && Object.keys(draft).length === 0;

    const statusLine =
        status.data?.state === 'unavailable'
            ? `Proactive help unavailable: ${status.data.reason ?? 'unknown reason'}`
            : status.data?.state === 'unconfigured'
              ? 'Not configured: set a model, a base URL and a key (a key is optional for a local address).'
              : status.data?.state === 'ok'
                ? 'Ready.'
                : '';

    return (
        <div>
            <h3 className="text-lg font-bold text-text-primary mb-1">Proactive help</h3>
            <p className="text-xs text-text-secondary mb-5">
                A decision model reads the conversation and judges whether help is needed. Show cards is on by default once a decision model is configured.
            </p>

            <div className="space-y-4">
                <div className="space-y-1.5">
                    <label className="text-xs font-medium text-text-secondary block">Mode</label>
                    <select value={mode} onChange={(e) => setDraft({ ...draft, mode: e.target.value as Mode })} className={input}>
                        <option value="log">Log only</option>
                        <option value="on">Show cards</option>
                        <option value="off">Off</option>
                    </select>
                    <p className="text-[11px] text-text-tertiary leading-snug">{MODE_HELP[mode]}</p>
                </div>

                <div className="space-y-1.5">
                    <label className="text-xs font-medium text-text-secondary block">Decision model</label>
                    <input type="text" value={model} onChange={(e) => setDraft({ ...draft, model: e.target.value })} placeholder="Model id" className={input} />
                </div>
                <p className="text-xs text-text-secondary">
                    The decision service address and key are in <button type="button" onClick={onOpenProviders} className="text-primary hover:underline">Provider setup</button>.
                </p>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                        <label className="text-xs font-medium text-text-secondary block">Threshold: {percent(threshold)}</label>
                        <input
                            type="range"
                            min={0}
                            max={1}
                            step={0.05}
                            value={threshold}
                            onChange={(e) => setDraft({ ...draft, threshold: Number(e.target.value) })}
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
                            onChange={(e) => setDraft({ ...draft, cooldownSeconds: Math.max(0, Number(e.target.value) || 0) })}
                            className={input}
                        />
                        <p className="text-[11px] text-text-tertiary leading-snug">At most one card in this time.</p>
                    </div>
                </div>

                <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                    <button
                        onClick={() => save.mutate()}
                        disabled={save.isPending}
                        className={`px-4 py-2 rounded-lg text-xs font-medium transition-colors ${showSaved ? 'bg-state-success-soft text-state-success' : 'bg-bg-input hover:bg-bg-input/80 border border-border-subtle text-text-primary'}`}
                    >
                        {showSaved ? 'Saved!' : 'Save proactive help settings'}
                    </button>
                    <button
                        onClick={() => test.mutate()}
                        disabled={test.isPending}
                        className="px-4 py-2 rounded-lg text-xs font-medium bg-bg-input hover:bg-bg-input/80 border border-border-subtle text-text-primary transition-colors disabled:opacity-50"
                    >
                        {test.isPending ? 'Testing…' : 'Test decision model'}
                    </button>
                    {statusLine && (
                        <p className={`text-[11px] sm:pl-1 ${status.data?.state === 'unavailable' ? 'text-state-danger' : 'text-text-tertiary'}`}>{statusLine}</p>
                    )}
                </div>
                {(test.isError || test.data) && (
                    <div className="rounded-lg border border-border-subtle bg-bg-input/50 px-3 py-2">
                        {test.isError ? (
                            <p className="text-[11px] text-state-danger">{(test.error as Error).message}</p>
                        ) : test.data?.success ? (
                            <p className="text-xs text-text-primary">
                                It decided help is {percent(test.data.help)} likely, kind: {test.data.kind?.replace('_', ' ')}{test.data.latencyMs === undefined ? '.' : `, in ${test.data.latencyMs} ms. Live use allows 2 s: ${test.data.latencyMs > 2000 ? 'this reply would have been too slow live.' : 'this reply is fast enough live.'}`}
                                {test.data.help !== undefined && ` The help score is ${test.data.help < threshold ? 'below' : 'at or above'} the ${percent(threshold)} threshold.`}
                                {' Mode, help kind, staleness, cooldown and card drafting also determine whether a card appears.'}
                            </p>
                        ) : (
                            <p className="text-[11px] text-state-danger">{test.data?.error}</p>
                        )}
                    </div>
                )}
                {save.error ? <p className="text-[11px] text-state-danger">{(save.error as Error).message}</p> : null}

                <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                        <label className="text-xs font-medium text-text-secondary block">Latest decisions</label>
                        <button onClick={() => void refreshAll()} className="text-[11px] text-text-tertiary hover:text-text-primary transition-colors">
                            Refresh
                        </button>
                    </div>
                    {decisions.length === 0 ? (
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
                                    {decisions.map((decision) => (
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
