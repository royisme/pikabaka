import React, { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from 'react-query';
import ConnectionModelPicker from './ConnectionModelPicker';

type AgentUse = { connectionId: string; model: string; supportsImages: boolean };

/**
 * The model of the in-meeting agent. Translation and speech recognition are set under Audio, where
 * the rest of the audio settings are; chat answers use the active model chosen above.
 * The saved value is a query; what is typed is a draft over it until Save.
 */
const ModelUsesSettings: React.FC = () => {
    const queryClient = useQueryClient();
    const { data: saved } = useQuery<AgentUse>(['agent-model'], () => window.electronAPI.agentModelGet());
    const [draft, setDraft] = useState<AgentUse | null>(null);
    const agent = draft ?? saved ?? { connectionId: '', model: '', supportsImages: false };

    const save = useMutation(
        async () => {
            const result = await window.electronAPI.agentModelSet(agent);
            if (!result.success) throw new Error(result.error || 'Could not save');
        },
        {
            onSuccess: async () => {
                await queryClient.invalidateQueries(['agent-model']);
                setDraft(null);
            },
        }
    );

    return (
        <div className="space-y-5">
            <div>
                <h3 className="text-sm font-bold text-text-primary mb-1">Agent model</h3>
                <p className="text-xs text-text-secondary mb-2">
                    The assistant you talk to during a meeting: it reads the transcript and can run commands you approve. It can use a different model from chat. Translation and speech recognition are set under Audio.
                </p>
            </div>
            <div className="bg-bg-item-surface rounded-xl p-5 border border-border-subtle space-y-3">
                <ConnectionModelPicker
                    id="agent"
                    connectionId={agent.connectionId}
                    model={agent.model}
                    emptyLabel="Use the chat model"
                    onChange={(next) => setDraft({ ...agent, ...next })}
                />
                {agent.connectionId && (
                    <label className="flex items-center gap-2 text-xs text-text-secondary">
                        <input type="checkbox" checked={agent.supportsImages} onChange={(e) => setDraft({ ...agent, supportsImages: e.target.checked })} />
                        This model reads images (lets the agent look at the screen)
                    </label>
                )}
                <div className="flex flex-wrap items-center gap-2">
                    <button
                        onClick={() => save.mutate()}
                        disabled={save.isLoading}
                        className={`px-4 py-2 rounded-lg text-xs font-medium transition-colors ${save.isSuccess && !draft ? 'bg-state-success-soft text-state-success' : 'bg-bg-input hover:bg-bg-input/80 border border-border-subtle text-text-primary'}`}
                    >
                        {save.isSuccess && !draft ? 'Saved!' : 'Save'}
                    </button>
                    {save.error ? <p className="text-[11px] text-state-danger">{(save.error as Error).message}</p> : null}
                </div>
            </div>
        </div>
    );
};

export default ModelUsesSettings;
