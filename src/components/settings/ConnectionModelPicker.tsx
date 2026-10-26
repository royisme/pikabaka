import React from 'react';
import { useQuery } from 'react-query';
import type { AiConnectionView } from '../../types/electron';
import ModelCombobox from './ModelCombobox';

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
    onModelSelect?: (next: { connectionId: string; model: string }) => void;
}

/**
 * A connection and an exact model id, typed or picked from what the host serves. The picker only edits
 * values; the screen that holds it has the Save button. The connection list and each connection's model
 * list are queries: the list is cached per connection, so choosing another connection never shows the
 * previous one's models, and nothing here needs an effect.
 */
const ConnectionModelPicker: React.FC<ConnectionModelPickerProps> = ({ id, connectionId, model, emptyLabel, modelPlaceholder = 'Model id', onChange, onModelSelect }) => {
    const { data: connections = [] } = useQuery<AiConnectionView[]>(['ai-connections'], () => window.electronAPI.aiConnectionsList());

    // Fetched on demand (the button), never on its own: the host is asked only when the user asks.
    const models = useQuery(
        ['connection-models', connectionId],
        async () => {
            const result = await window.electronAPI.aiConnectionModels({ id: connectionId });
            if (!result.success) throw new Error(result.error || 'Could not fetch models');
            return (result.models ?? []).map((m) => m.id);
        },
        { enabled: false, retry: false, cacheTime: 5 * 60_000 }
    );
    const options = models.data ?? [];

    const note = models.isFetching
        ? { tone: 'info', text: 'Asking the host…' }
        : models.error
          ? { tone: 'error', text: (models.error as Error).message }
          : models.data
            ? { tone: 'info', text: `${models.data.length} models listed. You can also type any model id.` }
            : null;

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
                        {connections.filter((c) => c.type !== 'ollama').map((c) => (
                            <option key={c.id} value={c.id}>{c.name}</option>
                        ))}
                    </select>
                </div>
                <div className="space-y-1.5">
                    <label htmlFor={`${id}-model`} className="text-xs font-medium text-text-secondary block">Model</label>
                    <div className="flex items-center gap-2">
                        <ModelCombobox
                            id={`${id}-model`}
                            value={model}
                            options={options}
                            onChange={(next) => onChange({ connectionId, model: next })}
                            onSelect={(next) => onModelSelect?.({ connectionId, model: next })}
                            placeholder={modelPlaceholder}
                            disabled={connectionId === '' && emptyLabel !== undefined}
                        />
                        <button onClick={() => void models.refetch()} disabled={!connectionId || models.isFetching} className={smallButton}>Fetch</button>
                    </div>
                </div>
            </div>
            {note && <p className={`text-[11px] ${note.tone === 'error' ? 'text-state-danger' : 'text-text-tertiary'}`}>{note.text}</p>}
        </div>
    );
};

export default ConnectionModelPicker;
