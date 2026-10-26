import React, { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from 'react-query';
import { ChevronDown } from 'lucide-react';
import ConnectionModelPicker from '../settings/ConnectionModelPicker';
import { useMainEvent } from '../../hooks/useMainEvent';
import { useWindowEvent } from '../../hooks/useWindowEvent';

type ChatUse = { connectionId: string; model: string };

/** Shared by the inline dropdown and the floating model-selector window. */
export const QuickAnswersPicker = () => {
    const queryClient = useQueryClient();
    const { data: saved, error } = useQuery(['chat-model'], () => window.electronAPI.chatModelGet());
    const [draft, setDraft] = useState<ChatUse | null>(null);
    const value = draft ?? saved ?? { connectionId: '', model: '' };
    const save = useMutation(async (use: ChatUse) => {
        const result = await window.electronAPI.chatModelSet(use);
        if (!result.success) throw new Error(result.error || 'Could not switch model');
        return use;
    }, {
        onSuccess: (use) => {
            queryClient.setQueryData(['chat-model'], use);
            setDraft(null);
        },
    });
    useMainEvent(window.electronAPI?.onModelChanged, () => {
        setDraft(null);
        void queryClient.invalidateQueries(['chat-model']);
    });
    useWindowEvent('focus', () => {
        setDraft(null);
        save.reset();
        void queryClient.invalidateQueries(['chat-model']);
        void queryClient.invalidateQueries(['ai-connections']);
    });

    return (
        <div className="space-y-3 p-3">
            <h3 className="text-sm font-bold text-text-primary">Quick answers</h3>
            <fieldset disabled={save.isLoading || !saved} className="min-w-0">
                <ConnectionModelPicker
                    id="quick-answers"
                    connectionId={value.connectionId}
                    model={value.model}
                    emptyLabel="Choose a connection"
                    onChange={(next) => { save.reset(); setDraft(next); }}
                    onModelSelect={(next) => { if (next.connectionId && next.model) save.mutate(next); }}
                />
            </fieldset>
            <p className="text-[11px] text-text-secondary" aria-live="polite">
                {save.error || error ? ((save.error || error) as Error).message
                    : save.isLoading ? 'Switching…' : save.isSuccess && !draft ? 'Model switched.' : 'Pick a model, or type its id and press Enter to apply.'}
            </p>
        </div>
    );
};

export const ModelSelector: React.FC = () => {
    const queryClient = useQueryClient();
    const [isOpen, setIsOpen] = useState(false);
    const dropdownRef = useRef<HTMLDivElement>(null);
    const { data: use } = useQuery(['chat-model'], () => window.electronAPI.chatModelGet());
    const { data: connections = [] } = useQuery(['ai-connections'], () => window.electronAPI.aiConnectionsList());
    useMainEvent(window.electronAPI?.onModelChanged, () => { void queryClient.invalidateQueries(['chat-model']); });
    useWindowEvent('mousedown', (event) => {
        if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) setIsOpen(false);
    }, 'document');
    const connection = connections.find((c) => c.id === use?.connectionId);
    const label = connection && use?.model ? `${connection.name}: ${use.model}` : 'Choose a model';

    return (
        <div className="relative min-w-0" ref={dropdownRef}>
            <button
                onClick={() => setIsOpen(!isOpen)}
                aria-expanded={isOpen}
                title={label}
                className="flex items-center gap-2 px-3 py-1.5 bg-bg-input hover:bg-bg-elevated border border-border-subtle rounded-lg text-xs font-medium text-text-primary max-w-[240px]"
            >
                <span className="truncate">{label}</span>
                <ChevronDown size={14} className="shrink-0 text-text-secondary" />
            </button>
            {isOpen && (
                <div className="absolute bottom-full left-0 mb-2 w-[340px] bg-bg-item-surface border border-border-subtle rounded-xl shadow-xl z-50" onKeyDown={(event) => { if (event.key === 'Escape') setIsOpen(false); }}>
                    <QuickAnswersPicker />
                </div>
            )}
        </div>
    );
};
