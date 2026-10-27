import React from 'react';
import { useMutation, useQuery, useQueryClient } from 'react-query';

/**
 * The one folder the agent's commands run under. Inside it each day gets a folder and each meeting a
 * folder named with its time and title, so a meeting's files are easy to find. Without a folder the
 * agent cannot run commands; recording and everything else keep working.
 */
const WorkspaceSettings: React.FC = () => {
    const queryClient = useQueryClient();
    const { data } = useQuery(['agent-workspace'], () => window.electronAPI.agentWorkspaceGet());
    const refresh = () => queryClient.invalidateQueries(['agent-workspace']);

    const pick = useMutation(
        async () => {
            const result = await window.electronAPI.agentWorkspacePick();
            if (result.error) throw new Error(result.error);
        },
        { onSuccess: refresh }
    );
    const clear = useMutation(() => window.electronAPI.agentWorkspaceClear(), { onSuccess: refresh });

    const root = data?.root ?? '';
    const problem = pick.error ? (pick.error as Error).message : data?.error ?? '';

    return (
        <div>
            <h3 className="text-lg font-bold text-text-primary mb-1">Agent workspace</h3>
            <p className="text-xs text-text-secondary mb-5">
                Where the agent runs commands and keeps files. Each day gets a folder, and each meeting a folder inside it named with its time and title. The agent asks you before every command, read, write and edit.
            </p>
            <div className="flex items-center gap-2">
                <div className="flex-1 min-w-0 h-11 bg-bg-input border border-border-subtle rounded-lg px-3 flex items-center text-sm text-text-primary">
                    <span className="truncate">{root || 'No folder chosen'}</span>
                </div>
                <button
                    onClick={() => pick.mutate()}
                    className="shrink-0 h-11 px-4 rounded-lg text-xs font-medium bg-bg-input hover:bg-bg-input/80 border border-border-subtle text-text-primary transition-colors"
                >
                    {root ? 'Change' : 'Choose folder'}
                </button>
                {root && (
                    <button onClick={() => clear.mutate()} className="shrink-0 h-11 px-3 rounded-lg text-xs font-medium border border-border-subtle text-text-secondary hover:text-text-primary transition-colors">
                        Remove
                    </button>
                )}
            </div>
            {problem && <p className="mt-2 text-[11px] text-state-danger">{problem}</p>}
        </div>
    );
};

export default WorkspaceSettings;
