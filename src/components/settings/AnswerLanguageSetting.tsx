import React, { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

const AnswerLanguageSetting: React.FC = () => {
    const queryClient = useQueryClient();
    const { data: availableAiLanguages = [], error: languagesError } = useQuery({ queryKey: ['ai-response-languages'], queryFn: async () => {
        const languages = await window.electronAPI.getAiResponseLanguages();
        return [...languages].sort((a, b) => {
            if (a.label === 'English') return -1;
            if (b.label === 'English') return 1;
            return a.label.localeCompare(b.label);
        });
    } });
    const { data: saved = 'English', error: languageError } = useQuery({ queryKey: ['ai-response-language'], queryFn: async () =>
        (await window.electronAPI.getAiResponseLanguage()) || 'English' });
    const [draft, setDraft] = useState<string | null>(null);
    const aiResponseLanguage = draft ?? saved;

    const save = useMutation({ mutationFn: async (language: string) => {
            const result = await window.electronAPI.setAiResponseLanguage(language);
            if (result && !result.success) throw new Error(result.error || 'Could not save');
        }, onSuccess: (_, language) => {
                queryClient.setQueryData(['ai-response-language'], language);
                setDraft(null);
            },
            onError: () => setDraft(null) });
    const error = save.error || languageError || languagesError;

    const handleAiLanguageChange = (language: string) => {
        if (!language) return;
        setDraft(language);
        save.mutate(language);
    };

    return (
        <div className="min-w-0 space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0 flex-1 basis-48">
                    <label htmlFor="ai-response-language" className="text-sm font-bold normal-case tracking-normal text-text-primary">AI Response Language</label>
                    <p id="ai-response-language-help" className="text-xs text-text-secondary mt-0.5">
                        Reading language for quick answers and proactive cards; adds a translation when it differs from your speaking-language setting.
                    </p>
                </div>
                <select
                    id="ai-response-language"
                    aria-describedby="ai-response-language-help"
                    value={aiResponseLanguage}
                    onChange={(event) => handleAiLanguageChange(event.target.value)}
                    className="min-w-0 max-w-full bg-bg-component hover:bg-bg-elevated border border-border-subtle text-text-primary px-3 py-1.5 rounded-lg text-xs font-medium"
                >
                    {!availableAiLanguages.some(option => option.code === aiResponseLanguage) && <option value={aiResponseLanguage}>{aiResponseLanguage}</option>}
                    {availableAiLanguages.map(option => <option key={option.code} value={option.code}>{option.label}</option>)}
                </select>
            </div>
            {error ? <p role="alert" className="text-xs text-text-primary break-words">✕ {(error as Error).message}</p> : null}
        </div>
    );
};

export default AnswerLanguageSetting;
