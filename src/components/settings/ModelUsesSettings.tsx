import React, { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import ConnectionModelPicker from './ConnectionModelPicker';
import AnswerLanguageSetting from './AnswerLanguageSetting';
import AnswerStyleSettings from './AnswerStyleSettings';
import PromptsSettings from './PromptsSettings';
import { primaryButton, secondaryButton } from './buttonStyles';

type ModelUse = { connectionId: string; model: string; supportsImages?: boolean };
type Job = 'chat' | 'summary' | 'agent';

const jobs: Job[] = ['chat', 'summary', 'agent'];
const labels = { chat: 'Quick answers', summary: 'Summaries', agent: 'Agent' };
const descriptions = {
    chat: 'Answers in the overlay. The top-bar model selector switches this model.',
    summary: 'Meeting summaries and titles.',
    agent: 'The assistant you talk to during a meeting: it reads the transcript and can run commands you approve.',
};

const readUse = (job: Job) => job === 'chat' ? window.electronAPI.chatModelGet()
    : job === 'summary' ? window.electronAPI.summaryModelGet()
    : window.electronAPI.agentModelGet();

/** The saved value is a query; what is typed is a draft over it until Save. */
const ModelUsesSettings: React.FC<{ job: Job }> = ({ job }) => {
    const queryClient = useQueryClient();
    // All three saved rows are read so a row can name the jobs that also run on its connection and model.
    const uses = {
        chat: useQuery<ModelUse>({ queryKey: ['chat-model'], queryFn: () => readUse('chat') }),
        summary: useQuery<ModelUse>({ queryKey: ['summary-model'], queryFn: () => readUse('summary') }),
        agent: useQuery<ModelUse>({ queryKey: ['agent-model'], queryFn: () => readUse('agent') }),
    };
    const { data: saved, error } = uses[job];
    // Summaries and the agent inherit quick answers only when their own connection is empty, as resolveModelUse does.
    const effective = (which: Job): ModelUse | undefined =>
        which !== 'chat' && !uses[which].data?.connectionId ? uses.chat.data : uses[which].data;
    const own = effective(job);
    const sharedWith = own?.connectionId && own.model
        ? jobs.filter(other => other !== job && effective(other)?.connectionId === own.connectionId && effective(other)?.model === own.model)
        : [];
    const [draft, setDraft] = useState<ModelUse | null>(null);
    const value = draft ?? saved ?? { connectionId: '', model: '', supportsImages: false };

    const save = useMutation({ mutationFn: async (use: ModelUse) => {
            const result = await (job === 'chat' ? window.electronAPI.chatModelSet(use)
                : job === 'summary' ? window.electronAPI.summaryModelSet(use)
                : window.electronAPI.agentModelSet(use));
            if (!result.success) throw new Error(result.error || 'Could not save');
        }, onSuccess: async () => {
                await queryClient.invalidateQueries({ queryKey: [`${job}-model`] });
                setDraft(null);
            } });

    // Tests run the model as shown (saved or not) through the job's own path; nothing is stored.
    // The test and its result sit under a collapsed Test disclosure that opens itself when a result arrives.
    const [showTest, setShowTest] = useState(false);
    const test = useMutation<{ success: boolean; reply?: string; firstTokenMs?: number; totalMs?: number; error?: string; toolCalls?: boolean | null }, Error>({ mutationFn: () =>
        job === 'agent'
            ? window.electronAPI.agentTest({ connectionId: value.connectionId, model: value.model, supportsImages: value.supportsImages })
            : window.electronAPI.modelTest({ job, connectionId: value.connectionId, model: value.model }), onSuccess: () => setShowTest(true), onError: () => setShowTest(true) });
    const tested = test.data;

    return (
        <div className="min-w-0 bg-bg-item-surface rounded-xl p-5 border border-border-subtle space-y-3">
            <div>
                <h4 className="text-sm font-bold text-text-primary mb-1">{labels[job]}</h4>
                <p className="text-xs text-text-secondary">{descriptions[job]}</p>
                {sharedWith.length > 0 && (
                    <p className="text-[11px] text-text-secondary mt-1">Also used by: {sharedWith.map(other => labels[other]).join(', ')}</p>
                )}
            </div>
            <fieldset disabled={save.isPending || test.isPending} className="space-y-3 min-w-0">
                <ConnectionModelPicker
                    id={job}
                    connectionId={value.connectionId}
                    model={value.model}
                    emptyLabel={job === 'chat' ? 'Choose a connection' : 'Same as quick answers'}
                    onChange={(next) => { save.reset(); test.reset(); setDraft({ ...value, ...next }); }}
                />
                {job === 'agent' && value.connectionId && (
                    <label className="flex items-center gap-2 text-xs text-text-secondary">
                        <input type="checkbox" checked={value.supportsImages ?? false} onChange={(e) => { save.reset(); test.reset(); setDraft({ ...value, supportsImages: e.target.checked }); }} />
                        This model reads images (lets the agent look at the screen)
                    </label>
                )}
                <div className="flex flex-wrap items-center gap-2">
                    <button
                        onClick={() => save.mutate(value)}
                        disabled={!saved}
                        className={primaryButton}
                    >
                        {save.isPending ? 'Saving…' : save.isSuccess && !draft ? 'Saved!' : 'Save'}
                    </button>
                    <button
                        type="button"
                        aria-expanded={showTest}
                        aria-controls={`${job}-model-test`}
                        onClick={() => setShowTest(!showTest)}
                        className={secondaryButton}
                    >
                        Test
                    </button>
                    {save.error || error ? <p className="text-[11px] text-state-danger">{((save.error || error) as Error).message}</p> : null}
                </div>
                <div id={`${job}-model-test`} hidden={!showTest} className="space-y-2">
                    <button
                        onClick={() => test.mutate()}
                        disabled={test.isPending || !saved}
                        className={secondaryButton}
                    >
                        {test.isPending ? 'Testing…' : job === 'agent' ? 'Test agent model' : job === 'chat' ? 'Test quick answers model' : 'Test summaries model'}
                    </button>
                    {(test.isError || tested) && (
                        <div role="status" className="rounded-lg border border-border-subtle bg-bg-input/50 px-3 py-2 space-y-1 break-words">
                            {test.isError ? (
                                <p className="text-[11px] text-state-danger">{(test.error as Error).message}</p>
                            ) : tested?.success ? (
                                <>
                                    <p className="text-xs text-text-primary">Answered: {tested.reply}</p>
                                    {job === 'agent' && (
                                        <p className={`text-[11px] ${tested.toolCalls === false ? 'text-state-warning' : 'text-text-tertiary'}`}>
                                            {tested.toolCalls ? 'Tool calls work.' : 'This model did not call a tool when it was offered one: the agent needs that to read the transcript and run commands.'}
                                            {tested.totalMs !== undefined && ` Done in ${(tested.totalMs / 1000).toFixed(1)} s.`}
                                        </p>
                                    )}
                                </>
                            ) : (
                                <p className="text-[11px] text-state-danger">{tested?.error}</p>
                            )}
                            {job !== 'agent' && tested?.totalMs !== undefined && (
                                <p className="text-[11px] text-text-tertiary">
                                    {tested.firstTokenMs !== undefined && `First token: ${(tested.firstTokenMs / 1000).toFixed(1)} s. `}
                                    Total: {(tested.totalMs / 1000).toFixed(1)} s.
                                </p>
                            )}
                        </div>
                    )}
                </div>
            </fieldset>
            {job === 'chat' && (!saved?.connectionId || !saved.model) && <p className="text-xs text-text-secondary">Not chosen: chat answers will say so until you pick a model.</p>}
            {job === 'chat' && (
                <>
                    <AnswerLanguageSetting />
                    <AnswerStyleSettings />
                    <PromptsSettings />
                </>
            )}
        </div>
    );
};

export default ModelUsesSettings;
