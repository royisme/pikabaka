import React, { useState } from 'react';
import { useQuery, useQueryClient } from 'react-query';
import type { AiConnectionType, AiConnectionView } from '../../types/electron';

const TYPE_LABEL: Record<AiConnectionType, string> = {
    openai: 'OpenAI-compatible',
    anthropic: 'Anthropic',
    gemini: 'Gemini',
};

const TYPE_HINT: Record<AiConnectionType, string> = {
    openai: 'OpenAI, Groq, OpenRouter, DeepSeek, a gateway of your own: anything that serves /chat/completions and /models.',
    anthropic: 'Claude, or a service that speaks the Anthropic Messages API.',
    gemini: 'Google Gemini, or a service that speaks the Gemini API.',
};

const HOST_PLACEHOLDER: Record<AiConnectionType, string> = {
    openai: 'https://api.example.com/v1',
    anthropic: 'https://api.anthropic.com',
    gemini: 'https://generativelanguage.googleapis.com',
};

// Presets only fill in the form; a connection is always just a type, a host and a key.
const PRESETS: Array<{ label: string; name: string; type: AiConnectionType; baseUrl: string }> = [
    { label: 'OpenRouter', name: 'OpenRouter', type: 'openai', baseUrl: 'https://openrouter.ai/api/v1' },
    { label: 'DeepSeek', name: 'DeepSeek', type: 'openai', baseUrl: 'https://api.deepseek.com/v1' },
    { label: 'Together', name: 'Together AI', type: 'openai', baseUrl: 'https://api.together.xyz/v1' },
    { label: 'Ollama (local)', name: 'Ollama (local)', type: 'openai', baseUrl: 'http://localhost:11434/v1' },
    { label: 'LM Studio', name: 'LM Studio', type: 'openai', baseUrl: 'http://localhost:1234/v1' },
];

interface Draft {
    id?: string;
    name: string;
    type: AiConnectionType;
    baseUrl: string;
    apiKey: string;
    builtin: boolean;
    hasApiKey: boolean;
}

const field = 'w-full h-11 bg-bg-input border border-border-subtle rounded-lg px-3 text-sm text-text-primary placeholder-text-tertiary focus:outline-none focus:border-accent-primary transition-colors';
const smallButton = 'h-9 px-3 rounded-lg text-xs font-medium border border-border-subtle text-text-secondary hover:text-text-primary transition-colors';

interface ConnectionsSettingsProps {
    /** Called after a connection was saved or deleted, so the page can refresh what depends on it. */
    onChanged?: () => void;
}

/**
 * Where models are reached: a type (the wire protocol), a host and a key. Nothing here is tied to one
 * provider: a connection of the OpenAI-compatible type can be OpenAI, Groq, OpenRouter or your own gateway.
 * What a model is used for (the agent, translation, chat) is chosen apart, in "Where models are used".
 */
const ConnectionsSettings: React.FC<ConnectionsSettingsProps> = ({ onChanged }) => {
    const queryClient = useQueryClient();
    const { data: connections = [] } = useQuery<AiConnectionView[]>(['ai-connections'], () => window.electronAPI.aiConnectionsList());
    const [draft, setDraft] = useState<Draft | null>(null);
    const [error, setError] = useState('');
    const [check, setCheck] = useState<{ state: 'idle' | 'busy' | 'ok' | 'error'; message: string }>({ state: 'idle', message: '' });

    // Everything that reads the list is told through the query cache; the page is told through the callback.
    const changed = () => {
        void queryClient.invalidateQueries(['ai-connections']);
        onChanged?.();
    };

    const edit = (connection: AiConnectionView) => {
        setError('');
        setCheck({ state: 'idle', message: '' });
        setDraft({
            id: connection.id,
            name: connection.name,
            type: connection.type,
            baseUrl: connection.customBaseUrl || !connection.builtin ? connection.baseUrl : '',
            apiKey: '',
            builtin: connection.builtin,
            hasApiKey: connection.hasApiKey,
        });
    };

    const add = (preset?: { name: string; type: AiConnectionType; baseUrl: string }) => {
        setError('');
        setCheck({ state: 'idle', message: '' });
        setDraft({ name: preset?.name ?? '', type: preset?.type ?? 'openai', baseUrl: preset?.baseUrl ?? '', apiKey: '', builtin: false, hasApiKey: false });
    };

    const save = async () => {
        if (!draft) return;
        setError('');
        const result = await window.electronAPI.aiConnectionSave({
            id: draft.id,
            name: draft.name,
            type: draft.type,
            baseUrl: draft.baseUrl,
            // An untouched key field leaves the stored key as it is.
            ...(draft.apiKey ? { apiKey: draft.apiKey } : {}),
        });
        if (!result.success) {
            setError(result.error || 'Could not save');
            return;
        }
        setDraft(null);
        changed();
    };

    const removeKey = async () => {
        if (!draft?.id) return;
        const result = await window.electronAPI.aiConnectionSave({ id: draft.id, name: draft.name, type: draft.type, baseUrl: draft.baseUrl, apiKey: '' });
        if (result.success) {
            setDraft({ ...draft, hasApiKey: false, apiKey: '' });
            changed();
        }
    };

    const remove = async () => {
        if (!draft?.id || draft.builtin) return;
        await window.electronAPI.aiConnectionDelete(draft.id);
        setDraft(null);
        changed();
    };

    // Fetching the models doubles as the test: the host answered and accepted the key.
    const fetchModels = async () => {
        if (!draft) return;
        setCheck({ state: 'busy', message: 'Asking the host…' });
        const result = await window.electronAPI.aiConnectionModels({
            id: draft.id,
            type: draft.type,
            baseUrl: draft.baseUrl,
            ...(draft.apiKey ? { apiKey: draft.apiKey } : {}),
        });
        setCheck(
            result.success
                ? { state: 'ok', message: `Connected. The host lists ${result.models?.length ?? 0} models.` }
                : { state: 'error', message: result.error || 'Could not reach the host' }
        );
    };

    return (
        <div className="space-y-5">
            <div>
                <h3 className="text-sm font-bold text-text-primary mb-1">Connections</h3>
                <p className="text-xs text-text-secondary mb-2">
                    Where models are reached: a type, a host and a key. Any host works, so Pika is not tied to one provider. Choose which connection and model each job uses under Models &amp; Agent.
                </p>
            </div>

            <div className="space-y-2">
                {connections.map((connection) => (
                    <div key={connection.id} className="bg-bg-item-surface rounded-xl px-4 py-3 border border-border-subtle flex items-center gap-3">
                        <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                                <span className="text-sm font-medium text-text-primary truncate">{connection.name}</span>
                                <span className="text-[11px] text-text-tertiary shrink-0">{TYPE_LABEL[connection.type]}</span>
                            </div>
                            <p className="text-[11px] text-text-tertiary font-mono truncate">{connection.baseUrl}</p>
                        </div>
                        <span className={`text-[11px] shrink-0 ${connection.hasApiKey ? 'text-state-success' : 'text-text-tertiary'}`}>
                            {connection.hasApiKey ? 'Key saved' : 'No key'}
                        </span>
                        <button onClick={() => edit(connection)} className={smallButton}>Edit</button>
                    </div>
                ))}
            </div>

            {!draft && (
                <div className="flex flex-wrap items-center gap-2">
                    {(Object.keys(TYPE_LABEL) as AiConnectionType[]).map((type) => (
                        <button key={type} onClick={() => add({ name: '', type, baseUrl: '' })} className={smallButton}>
                            + {TYPE_LABEL[type]}
                        </button>
                    ))}
                    <span className="text-[11px] text-text-tertiary">or start from</span>
                    {PRESETS.map((preset) => (
                        <button key={preset.label} onClick={() => add(preset)} className={smallButton}>{preset.label}</button>
                    ))}
                </div>
            )}

            {draft && (
                <div className="bg-bg-item-surface rounded-xl p-5 border border-border-subtle space-y-4">
                    <h4 className="text-sm font-bold text-text-primary">{draft.id ? `Edit ${draft.name}` : 'New connection'}</h4>

                    {!draft.builtin && (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                            <div className="space-y-1.5">
                                <label className="text-xs font-medium text-text-secondary block">Name</label>
                                <input type="text" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="My gateway" className={field} />
                            </div>
                            <div className="space-y-1.5">
                                <label className="text-xs font-medium text-text-secondary block">Type</label>
                                <select value={draft.type} onChange={(e) => setDraft({ ...draft, type: e.target.value as AiConnectionType })} className={field}>
                                    {(Object.keys(TYPE_LABEL) as AiConnectionType[]).map((type) => (
                                        <option key={type} value={type}>{TYPE_LABEL[type]}</option>
                                    ))}
                                </select>
                            </div>
                        </div>
                    )}
                    <p className="text-[11px] text-text-tertiary leading-snug">{TYPE_HINT[draft.type]}</p>

                    <div className="space-y-1.5">
                        <label className="text-xs font-medium text-text-secondary block">Host</label>
                        <input
                            type="text"
                            value={draft.baseUrl}
                            onChange={(e) => setDraft({ ...draft, baseUrl: e.target.value })}
                            placeholder={draft.builtin ? 'Leave empty for the default host' : HOST_PLACEHOLDER[draft.type]}
                            className={field}
                        />
                        {draft.type === 'openai' && <p className="text-[11px] text-text-tertiary">Include the version path your host uses, usually /v1. A bare host gets /v1 added.</p>}
                    </div>

                    <div className="space-y-1.5">
                        <label className="text-xs font-medium text-text-secondary block">API key</label>
                        <div className="flex items-center gap-2">
                            <input
                                type="password"
                                value={draft.apiKey}
                                onChange={(e) => setDraft({ ...draft, apiKey: e.target.value })}
                                placeholder={draft.hasApiKey ? 'Saved. Type to replace.' : 'Optional for a local address'}
                                autoComplete="off"
                                className={field}
                            />
                            {draft.hasApiKey && <button onClick={removeKey} className={`${smallButton} shrink-0 h-11`}>Remove key</button>}
                        </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                        <button onClick={save} className="px-4 py-2 rounded-lg text-xs font-medium bg-bg-input hover:bg-bg-input/80 border border-border-subtle text-text-primary transition-colors">Save</button>
                        <button onClick={fetchModels} disabled={check.state === 'busy'} className={smallButton}>Test and fetch models</button>
                        <button onClick={() => setDraft(null)} className={smallButton}>Cancel</button>
                        {draft.id && !draft.builtin && <button onClick={remove} className={`${smallButton} text-state-danger`}>Delete</button>}
                    </div>
                    {check.message && <p className={`text-[11px] ${check.state === 'error' ? 'text-state-danger' : 'text-text-tertiary'}`}>{check.message}</p>}
                    {error && <p className="text-[11px] text-state-danger">{error}</p>}
                </div>
            )}
        </div>
    );
};

export default ConnectionsSettings;
