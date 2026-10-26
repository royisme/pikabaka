import React, { useEffect, useState } from 'react';
import ConnectionModelPicker from './ConnectionModelPicker';

interface ModelUsesSettingsProps {
    /** Bumped when a connection changed, so the picker reloads its list. */
    version?: number;
}

/**
 * The model of the in-meeting agent. Translation and speech recognition are set under Audio, where
 * the rest of the audio settings are; chat answers use the active model chosen above.
 */
const ModelUsesSettings: React.FC<ModelUsesSettingsProps> = ({ version = 0 }) => {
    const [agent, setAgent] = useState({ connectionId: '', model: '', supportsImages: false });
    const [saved, setSaved] = useState(false);
    const [error, setError] = useState('');

    useEffect(() => {
        window.electronAPI.agentModelGet().then(setAgent).catch(() => {});
    }, [version]);

    const save = async () => {
        setError('');
        const result = await window.electronAPI.agentModelSet(agent);
        if (!result.success) {
            setError(result.error || 'Could not save');
            return;
        }
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
    };

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
                    key={version}
                    id="agent"
                    connectionId={agent.connectionId}
                    model={agent.model}
                    emptyLabel="Use the chat model"
                    onChange={(next) => setAgent({ ...agent, ...next })}
                />
                {agent.connectionId && (
                    <label className="flex items-center gap-2 text-xs text-text-secondary">
                        <input type="checkbox" checked={agent.supportsImages} onChange={(e) => setAgent({ ...agent, supportsImages: e.target.checked })} />
                        This model reads images (lets the agent look at the screen)
                    </label>
                )}
                <div className="flex flex-wrap items-center gap-2">
                    <button
                        onClick={save}
                        className={`px-4 py-2 rounded-lg text-xs font-medium transition-colors ${saved ? 'bg-state-success-soft text-state-success' : 'bg-bg-input hover:bg-bg-input/80 border border-border-subtle text-text-primary'}`}
                    >
                        {saved ? 'Saved!' : 'Save'}
                    </button>
                    {error && <p className="text-[11px] text-state-danger">{error}</p>}
                </div>
            </div>
        </div>
    );
};

export default ModelUsesSettings;
