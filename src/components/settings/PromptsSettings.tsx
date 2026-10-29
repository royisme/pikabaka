import React, { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from 'react-query';
import type { PromptPart, TaskName } from '../../../electron/llm/prompts';

const TASK_LABELS: Array<[TaskName, string]> = [
    ['answer', 'Answer'],
    ['whatToAnswer', 'What to answer'],
    ['recap', 'Recap'],
    ['followUp', 'Follow-up'],
    ['followUpQuestions', 'Follow-up questions'],
    ['assist', 'Assist'],
    ['clarify', 'Clarify'],
    ['codeHint', 'Code hint'],
    ['brainstorm', 'Brainstorm'],
    ['chat', 'Chat'],
];

const quietButton = 'px-3 py-1.5 rounded-lg border border-border-subtle bg-bg-component text-xs font-medium text-text-secondary hover:bg-bg-input hover:text-text-primary disabled:opacity-50 transition-colors';
const fieldClass = 'w-full min-w-0 bg-bg-input border border-border-subtle rounded-lg px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-accent-primary transition-colors';

type SaveRequest = { key: 'role' | TaskName; text: string | null };

/**
 * The text Pika sends: one role in front of every task, one text per task, and the fixed rules after
 * them. Saved text is used by the next request (no restart); reset goes back to the built-in text.
 */
const PromptsSettings: React.FC = () => {
    const queryClient = useQueryClient();
    const { data, error } = useQuery(['prompts'], () => window.electronAPI.getPrompts());
    const [expanded, setExpanded] = useState(false);
    const [openTask, setOpenTask] = useState<TaskName | null>(null);
    const [drafts, setDrafts] = useState<Partial<Record<string, string>>>({});
    const [activeKey, setActiveKey] = useState<string | null>(null);
    const [failedKey, setFailedKey] = useState<string | null>(null);

    const save = useMutation(
        async ({ key, text }: SaveRequest) => {
            const result = await window.electronAPI.setPrompts(key === 'role' ? { role: text } : { tasks: { [key]: text } });
            if (!result.success) throw new Error(result.error || 'Could not save');
        },
        {
            onSuccess: async (_, { key }) => {
                setActiveKey(null);
                setDrafts((current) => {
                    const next = { ...current };
                    delete next[key];
                    return next;
                });
                await queryClient.invalidateQueries(['prompts']);
            },
            onError: (_, { key }) => {
                setActiveKey(null);
                setFailedKey(key);
            },
        }
    );

    // Save is explicit, one prompt at a time; `null` is Reset, which goes back to the built-in text.
    const request = (key: 'role' | TaskName, text: string | null) => {
        setFailedKey(null);
        save.reset();
        setActiveKey(key);
        save.mutate({ key, text });
    };

    // One prompt: the text in force, where it comes from, its length, and Save and Reset.
    const field = (key: 'role' | TaskName, id: string, label: string, part: PromptPart, maxLength: number) => {
        const value = drafts[key] ?? part.text;
        const overLimit = value.length > maxLength;
        return (
            <div className="min-w-0 space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                    <label htmlFor={id} className="text-xs font-medium text-text-primary">{label}</label>
                    <span className="text-[11px] text-text-secondary">{part.edited ? 'Edited' : 'Built-in'}</span>
                </div>
                <textarea
                    id={id}
                    value={value}
                    rows={6}
                    spellCheck={false}
                    onChange={(event) => {
                        setFailedKey(null);
                        setDrafts((current) => ({ ...current, [key]: event.target.value }));
                    }}
                    className={`${fieldClass} max-h-64 resize-y`}
                />
                <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className={`text-[11px] ${overLimit ? 'text-state-danger' : 'text-text-tertiary'}`}>{value.length} / {maxLength}</span>
                    <div className="flex flex-wrap items-center gap-2">
                        <button
                            type="button"
                            aria-label={`Reset ${label}`}
                            onClick={() => request(key, null)}
                            disabled={!part.edited || activeKey === key}
                            className={quietButton}
                        >
                            Reset to default
                        </button>
                        <button
                            type="button"
                            aria-label={`Save ${label}`}
                            onClick={() => request(key, drafts[key] ?? part.text)}
                            disabled={drafts[key] === undefined || activeKey === key || overLimit}
                            className={quietButton}
                        >
                            {activeKey === key ? 'Saving…' : 'Save'}
                        </button>
                    </div>
                </div>
                {failedKey === key && save.error ? (
                    <p role="alert" className="text-[11px] text-state-danger">✕ {(save.error as Error).message}</p>
                ) : null}
            </div>
        );
    };

    return (
        <div className="min-w-0 space-y-2">
            <button
                type="button"
                aria-expanded={expanded}
                aria-controls="prompts-settings"
                onClick={() => setExpanded(!expanded)}
                className="bg-bg-component hover:bg-bg-elevated border border-border-subtle rounded-lg px-3 py-1.5 text-xs font-medium text-text-primary transition-colors"
            >
                Prompts
            </button>
            <div id="prompts-settings" hidden={!expanded} className="space-y-3">
                <p className="text-xs text-text-secondary">
                    The text Pika sends with every request. Edit it to change how it answers; reset to go back to the built-in text.
                </p>
                {error ? <p role="alert" className="text-[11px] text-state-danger">✕ {(error as Error).message}</p> : null}
                {data ? (
                    <>
                        {field('role', 'prompt-role', 'Role', data.role, data.maxLength)}
                        <div className="space-y-2">
                            <p className="text-xs font-medium text-text-primary">Tasks</p>
                            {TASK_LABELS.map(([task, label]) => (
                                <div key={task} className="min-w-0 space-y-2 border-t border-border-subtle pt-2">
                                    <button
                                        type="button"
                                        aria-expanded={openTask === task}
                                        aria-controls={`prompt-body-${task}`}
                                        onClick={() => setOpenTask(openTask === task ? null : task)}
                                        className="text-left text-xs font-medium text-text-primary"
                                    >
                                        {label}
                                    </button>
                                    <div id={`prompt-body-${task}`} hidden={openTask !== task}>
                                        {field(task, `prompt-${task}`, label, data.tasks[task], data.maxLength)}
                                    </div>
                                </div>
                            ))}
                        </div>
                        <details className="rounded-lg border border-border-subtle bg-bg-component px-3 py-2">
                            <summary className="cursor-pointer text-xs font-medium text-text-primary">Fixed rules</summary>
                            <p className="mt-2 text-[11px] text-text-secondary">
                                These rules always end the prompt. They cannot be edited.
                            </p>
                            <pre className="mt-2 whitespace-pre-wrap break-words text-[11px] text-text-secondary">{data.rules}</pre>
                        </details>
                        <p className="text-[11px] text-text-tertiary">The proactive-help, summary and detection prompts are fixed.</p>
                    </>
                ) : (
                    <p className="text-xs text-text-secondary">Loading…</p>
                )}
            </div>
        </div>
    );
};

export default PromptsSettings;
