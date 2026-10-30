import React, { useState } from 'react';
import { useMutation } from '@tanstack/react-query';

interface TranslationTestProps {
    provider: string;
    model: string;
    prompt: string;
    targetLanguage: string;
}

function seconds(ms?: number): string {
    return ms === undefined ? 'n/a' : `${(ms / 1000).toFixed(1)} s`;
}

/**
 * Sends a fixed sample sentence through the translation settings as they are shown, saved or not,
 * the same way a meeting does, and shows the answer and how long it took. Nothing is stored.
 * The diagnostics sit in a collapsed Test disclosure that opens itself when a result arrives.
 */
const TranslationTest: React.FC<TranslationTestProps> = ({ provider, model, prompt, targetLanguage }) => {
    const [showTest, setShowTest] = useState(false);
    const test = useMutation({ mutationFn: () => window.electronAPI.testTranscriptTranslation({ provider, model, prompt, targetLanguage }), onSuccess: () => setShowTest(true), onError: () => setShowTest(true) });
    const result = test.data;

    return (
        <div className="space-y-2 pt-1">
            <button
                type="button"
                aria-expanded={showTest}
                aria-controls="translation-test"
                onClick={() => setShowTest(!showTest)}
                className="bg-bg-component hover:bg-bg-elevated border border-border-subtle rounded-lg px-3 py-1.5 text-xs font-medium text-text-primary transition-colors"
            >
                Test
            </button>
            <div id="translation-test" hidden={!showTest} className="space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                    <button
                        onClick={() => test.mutate()}
                        disabled={test.isPending || !model.trim()}
                        className="px-3 py-1.5 rounded-lg text-xs font-medium bg-bg-input hover:bg-bg-input/80 border border-border-subtle text-text-primary transition-colors disabled:opacity-50"
                    >
                        {test.isPending ? '● Translating…' : 'Test translation'}
                    </button>
                    <span className="text-[11px] text-text-tertiary">Sends one sample sentence with this model and prompt. Nothing is saved.</span>
                </div>
                {test.isError && <p className="text-[11px] text-text-primary">✕ {(test.error as Error).message}</p>}
                {result && (
                    <div className="rounded-lg border border-border-subtle bg-bg-input/50 px-3 py-2 space-y-1">
                        <p className="text-[11px] text-text-tertiary">{result.sample}</p>
                        {result.success ? (
                            <>
                                <p className="text-sm text-text-primary">{result.translatedText}</p>
                                <p className="text-[11px] text-text-tertiary">
                                    First text after {seconds(result.firstTokenMs)}, done in {seconds(result.totalMs)}. A call needs the first text within about 1.5 s.
                                </p>
                            </>
                        ) : (
                            <p className="text-[11px] text-text-primary">✕ {result.error}</p>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
};

export default TranslationTest;
