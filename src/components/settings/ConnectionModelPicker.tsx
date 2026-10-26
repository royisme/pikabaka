import React, { useEffect, useState } from 'react';
import type { AiConnectionView } from '../../types/electron';

const field = 'w-full h-11 bg-bg-input border border-border-subtle rounded-lg px-3 text-sm text-text-primary placeholder-text-tertiary focus:outline-none focus:border-accent-primary transition-colors';
const smallButton = 'h-11 px-3 shrink-0 rounded-lg text-xs font-medium border border-border-subtle text-text-secondary hover:text-text-primary disabled:opacity-40 transition-colors';

interface ConnectionModelPickerProps {
    /** Distinguishes the fields' ids when more than one picker is on a page. */
    id: string;
    connectionId: string;
    model: string;
    /** When set, an empty connection is allowed and means this (for example "Use the chat model"). */
    emptyLabel?: string;
    modelPlaceholder?: string;
    onChange: (next: { connectionId: string; model: string }) => void;
}

/**
 * A connection and an exact model id, typed or picked from what the host serves. The picker only edits
 * values; the screen that holds it has the Save button.
 */
const ConnectionModelPicker: React.FC<ConnectionModelPickerProps> = ({ id, connectionId, model, emptyLabel, modelPlaceholder = 'Model id', onChange }) => {
    const [connections, setConnections] = useState<AiConnectionView[]>([]);
    const [options, setOptions] = useState<string[]>([]);
    const [note, setNote] = useState<{ tone: 'info' | 'error'; text: string }>({ tone: 'info', text: '' });

    useEffect(() => {
        window.electronAPI.aiConnectionsList().then(setConnections).catch(() => {});
    }, []);

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

    return (
        <div className="space-y-1.5">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="space-y-1.5">
                    <label htmlFor={`${id}-connection`} className="text-xs font-medium text-text-secondary block">Connection</label>
                    <select
                        id={`${id}-connection`}
                        value={connectionId}
                        onChange={(e) => onChange({ connectionId: e.target.value, model: e.target.value === connectionId ? model : '' })}
                        className={field}
                    >
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
                            onChange={(e) => onChange({ connectionId, model: e.target.value })}
                            placeholder={modelPlaceholder}
                            disabled={connectionId === '' && emptyLabel !== undefined}
                            className={field}
                        />
                        <datalist id={`${id}-models`}>
                            {options.map((option) => <option key={option} value={option} />)}
                        </datalist>
                        <button onClick={fetchModels} disabled={!connectionId} className={smallButton}>Fetch</button>
                    </div>
                </div>
            </div>
            {note.text && <p className={`text-[11px] ${note.tone === 'error' ? 'text-state-danger' : 'text-text-tertiary'}`}>{note.text}</p>}
        </div>
    );
};

export default ConnectionModelPicker;
