import React, { useCallback, useEffect, useState } from 'react';
import type { AiConnectionView } from '../../types/electron';

const field = 'w-full h-11 bg-bg-input border border-border-subtle rounded-lg px-3 text-sm text-text-primary placeholder-text-tertiary focus:outline-none focus:border-accent-primary transition-colors';
const smallButton = 'h-9 px-3 rounded-lg text-xs font-medium border border-border-subtle text-text-secondary hover:text-text-primary transition-colors';

interface PickerProps {
    id: string;
    title: string;
    description: string;
    connections: AiConnectionView[];
    connectionId: string;
    model: string;
    /** When set, an empty connection is allowed and means this (for example "Use the chat model"). */
    emptyLabel?: string;
    modelPlaceholder: string;
    onConnection: (id: string) => void;
    onModel: (model: string) => void;
    extra?: React.ReactNode;
    onSave: () => Promise<{ success: boolean; error?: string }>;
}

/** One job's model: a connection and an exact model id, typed or picked from what the host serves. */
const UsePicker: React.FC<PickerProps> = ({ id, title, description, connections, connectionId, model, emptyLabel, modelPlaceholder, onConnection, onModel, extra, onSave }) => {
    const [options, setOptions] = useState<string[]>([]);
    const [note, setNote] = useState<{ tone: 'info' | 'error'; text: string }>({ tone: 'info', text: '' });
    const [saved, setSaved] = useState(false);

    // The list belongs to the connection: a different one starts with none.
    useEffect(() => { setOptions([]); setNote({ tone: 'info', text: '' }); }, [connectionId]);

    const fetchModels = async () => {
        if (!connectionId) return;
        setNote({ tone: 'info', text: 'Asking the host…' });
        const result = await window.electronAPI.aiConnectionModels({ id: connectionId });
        if (result.success) {
            setOptions((result.models ?? []).map((m) => m.id));
            setNote({ tone: 'info', text: `${result.models?.length ?? 0} models listed. You can also type any model id.` });
        } else {
            setNote({ tone: 'error', text: result.error || 'Could not fetch models' });
        }
    };

    const save = async () => {
        const result = await onSave();
        if (!result.success) {
            setNote({ tone: 'error', text: result.error || 'Could not save' });
            return;
        }
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
    };

    return (
        <div className="bg-bg-item-surface rounded-xl p-5 border border-border-subtle space-y-3">
            <div>
                <h4 className="text-sm font-bold text-text-primary">{title}</h4>
                <p className="text-[11px] text-text-secondary leading-snug">{description}</p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="space-y-1.5">
                    <label htmlFor={`${id}-connection`} className="text-xs font-medium text-text-secondary block">Connection</label>
                    <select id={`${id}-connection`} value={connectionId} onChange={(e) => onConnection(e.target.value)} className={field}>
                        {emptyLabel !== undefined && <option value="">{emptyLabel}</option>}
                        {connections.map((c) => (
                            <option key={c.id} value={c.id}>{c.name}</option>
                        ))}
                    </select>
                </div>
                <div className="space-y-1.5">
                    <label htmlFor={`${id}-model`} className="text-xs font-medium text-text-secondary block">Model</label>
                    <div className="flex items-center gap-2">
                        <input
                            id={`${id}-model`}
                            type="text"
                            list={`${id}-models`}
                            value={model}
                            onChange={(e) => onModel(e.target.value)}
                            placeholder={modelPlaceholder}
                            disabled={connectionId === '' && emptyLabel !== undefined}
                            className={field}
                        />
                        <datalist id={`${id}-models`}>
                            {options.map((option) => <option key={option} value={option} />)}
                        </datalist>
                        <button onClick={fetchModels} disabled={!connectionId} className={`${smallButton} shrink-0 h-11`}>Fetch</button>
                    </div>
                </div>
            </div>
            {extra}
            <div className="flex flex-wrap items-center gap-2">
                <button
                    onClick={save}
                    className={`px-4 py-2 rounded-lg text-xs font-medium transition-colors ${saved ? 'bg-state-success-soft text-state-success' : 'bg-bg-input hover:bg-bg-input/80 border border-border-subtle text-text-primary'}`}
                >
                    {saved ? 'Saved!' : 'Save'}
                </button>
                {note.text && <p className={`text-[11px] ${note.tone === 'error' ? 'text-state-danger' : 'text-text-tertiary'}`}>{note.text}</p>}
            </div>
        </div>
    );
};

interface ModelUsesSettingsProps {
    /** Bumped when a connection changed, so the lists here reload. */
    version?: number;
}

/**
 * What each job uses. The chat model is chosen above ("Default Model for Chat"); speech recognition has its
 * own services under Audio; the proactive-help decision model is its own section below.
 */
const ModelUsesSettings: React.FC<ModelUsesSettingsProps> = ({ version = 0 }) => {
    const [connections, setConnections] = useState<AiConnectionView[]>([]);
    const [agent, setAgent] = useState({ connectionId: '', model: '', supportsImages: false });
    const [translation, setTranslation] = useState({ connectionId: 'ollama', model: '' });

    const load = useCallback(async () => {
        try {
            const [list, agentUse, translationSettings] = await Promise.all([
                window.electronAPI.aiConnectionsList(),
                window.electronAPI.agentModelGet(),
                window.electronAPI.getTranscriptTranslationSettings(),
            ]);
            setConnections(list);
            setAgent(agentUse);
            setTranslation({ connectionId: translationSettings.provider || 'ollama', model: translationSettings.model || '' });
        } catch {
            // Leave the fields as they are; the connections section still works.
        }
    }, []);

    useEffect(() => { void load(); }, [load, version]);

    return (
        <div className="space-y-5">
            <div>
                <h3 className="text-sm font-bold text-text-primary mb-1">Where models are used</h3>
                <p className="text-xs text-text-secondary mb-2">
                    Each job has its own connection and model, so a cheap fast model can translate while a stronger one runs the agent. Chat answers use the active model chosen above. Speech recognition is set under Audio.
                </p>
            </div>

            <UsePicker
                id="agent"
                title="Agent"
                description="The assistant you talk to during a meeting. It reads the transcript and can run commands you approve."
                connections={connections}
                connectionId={agent.connectionId}
                model={agent.model}
                emptyLabel="Use the chat model"
                modelPlaceholder="Model id"
                onConnection={(connectionId) => setAgent({ ...agent, connectionId, model: connectionId === agent.connectionId ? agent.model : '' })}
                onModel={(model) => setAgent({ ...agent, model })}
                extra={
                    agent.connectionId ? (
                        <label className="flex items-center gap-2 text-xs text-text-secondary">
                            <input type="checkbox" checked={agent.supportsImages} onChange={(e) => setAgent({ ...agent, supportsImages: e.target.checked })} />
                            This model reads images (lets the agent look at the screen)
                        </label>
                    ) : undefined
                }
                onSave={() => window.electronAPI.agentModelSet(agent)}
            />

            <UsePicker
                id="translation"
                title="Translation"
                description="Translates what the other party says, line by line, while they speak."
                connections={connections}
                connectionId={translation.connectionId}
                model={translation.model}
                modelPlaceholder="Model id"
                onConnection={(connectionId) => setTranslation({ connectionId, model: connectionId === translation.connectionId ? translation.model : '' })}
                onModel={(model) => setTranslation({ ...translation, model })}
                onSave={() => window.electronAPI.setTranscriptTranslationSettings({ provider: translation.connectionId, model: translation.model })}
            />
        </div>
    );
};

export default ModelUsesSettings;
