import ConnectionsSettings from './ConnectionsSettings';
import ModelUsesSettings from './ModelUsesSettings';
import ProactiveHelpSettings from './ProactiveHelpSettings';
import React, { useState, useEffect } from 'react';
import { useQuery, useQueryClient } from 'react-query';
import * as Select from '@radix-ui/react-select';
import { AlertCircle, CheckCircle, ChevronDown, Check, RefreshCw } from 'lucide-react';
import { STANDARD_CLOUD_MODELS, prettifyModelId } from '../../utils/modelUtils';

interface OpenAICompatibleProviderRow {
    id: string;
    name: string;
    baseUrl: string;
    apiKey: string;
    preferredModel?: string;
}

interface ModelOption {
    id: string;
    name: string;
}

interface ModelSelectProps {
    value: string;
    options: ModelOption[];
    onChange: (value: string) => void;
    placeholder?: string;
}

const ModelSelect: React.FC<ModelSelectProps> = ({ value, options, onChange, placeholder = "Select model" }) => {
    const selectedOption = options.find(o => o.id === value);

    return (
        <Select.Root value={value} onValueChange={onChange}>
            <Select.Trigger className="w-40 bg-bg-input border border-border-subtle rounded-lg px-3 py-1.5 text-xs text-text-primary flex items-center justify-between hover:bg-bg-elevated transition-colors">
                <Select.Value placeholder={selectedOption ? selectedOption.name : placeholder} />
                <Select.Icon asChild>
                    <ChevronDown size={14} className="text-text-secondary transition-transform" />
                </Select.Icon>
            </Select.Trigger>

            <Select.Portal>
                <Select.Content
                    className="bg-bg-elevated border border-border-subtle rounded-lg shadow-xl z-50 max-h-60 overflow-hidden animated fadeIn"
                    position="popper"
                    sideOffset={4}
                    align="end"
                >
                    <Select.Viewport className="p-1 space-y-0.5 w-40 max-h-60 overflow-y-auto">
                        {options.map((option) => (
                            <Select.Item
                                key={option.id}
                                value={option.id}
                                className={`px-3 py-2 text-xs rounded-md flex items-center justify-between group transition-colors cursor-default outline-none data-[highlighted]:bg-bg-input data-[highlighted]:text-text-primary ${value === option.id ? 'bg-bg-input text-text-primary' : 'text-text-secondary'}`}
                            >
                                <Select.ItemText>
                                    <span className="truncate">{option.name}</span>
                                </Select.ItemText>
                                <Select.ItemIndicator>
                                    <Check size={14} className="text-accent-primary shrink-0 ml-2" />
                                </Select.ItemIndicator>
                            </Select.Item>
                        ))}
                        {options.length === 0 && (
                            <div className="px-3 py-2 text-xs text-text-tertiary italic">No models available</div>
                        )}
                    </Select.Viewport>
                </Select.Content>
            </Select.Portal>
        </Select.Root>
    );
};

export const AIProvidersSettings: React.FC = () => {
    const queryClient = useQueryClient();

    // --- Standard Providers ---
    const { data: creds } = useQuery(['credentials'], () => window.electronAPI?.getStoredCredentials?.());
    const hasStoredKey: Record<string, boolean> = creds
        ? {
            gemini: !!creds.hasGeminiKey,
            groq: !!creds.hasGroqKey,
            openai: !!creds.hasOpenaiKey,
            claude: !!creds.hasClaudeKey
        }
        : {};

    // --- OpenAI Compatible Providers ---
    const { data: openaiCompatibleProviders = [] } = useQuery<OpenAICompatibleProviderRow[]>(
        ['openai-compatible-providers'],
        () => window.electronAPI?.getOpenAICompatibleProviders?.() ?? Promise.resolve([])
    );

    // --- Local (Ollama) ---
    const [ollamaModels, setOllamaModels] = useState<string[]>([]);
    const [ollamaStatus, setOllamaStatus] = useState<'checking' | 'detected' | 'not-found' | 'fixing'>('checking');
    const [isRefreshingOllama, setIsRefreshingOllama] = useState(false);

    // --- Default Model ---
    const defaultModelQuery = useQuery(
        ['default-model'],
        async () => {
            const result = await window.electronAPI?.getDefaultModel?.();
            return result?.model;
        }
    );
    const defaultModel = defaultModelQuery.data ?? 'gemini-3.1-flash-lite-preview';

    // --- Dynamic Model Discovery ---
    const preferredModels: Record<string, string> = {};
    if (creds?.geminiPreferredModel) preferredModels.gemini = creds.geminiPreferredModel;
    if (creds?.groqPreferredModel) preferredModels.groq = creds.groqPreferredModel;
    if (creds?.openaiPreferredModel) preferredModels.openai = creds.openaiPreferredModel;
    if (creds?.claudePreferredModel) preferredModels.claude = creds.claudePreferredModel;

    // A connection changed: what depends on it (which providers have a key, the OpenAI-compatible list) is read again.
    const refreshAfterConnectionChange = async () => {
        await Promise.all([
            queryClient.invalidateQueries(['credentials']),
            queryClient.invalidateQueries(['openai-compatible-providers']),
        ]);
    };

    // Poll for Ollama status every 3 seconds requesting smart start on mount
    useEffect(() => {
        // Immediate "Smart Start" check
        ensureOllamaStartup();

        // Background polling for maintenance
        const interval = setInterval(() => {
            checkOllama(false);
        }, 3000);
        return () => clearInterval(interval);
    }, []);

    const ensureOllamaStartup = async () => {
        setOllamaStatus('checking');
        try {
            // @ts-ignore
            const result = await window.electronAPI?.invoke?.('ensure-ollama-running');
            if (result && result.success) {
                checkOllama(true);
            } else {
                setOllamaStatus('not-found');
            }
        } catch (e) {
            console.warn("Ollama ensure startup failed:", e);
            setOllamaStatus('not-found');
        }
    };

    const checkOllama = async (_isInitial = true) => {
        try {
            // @ts-ignore
            const models = await window.electronAPI?.getAvailableOllamaModels?.();
            if (models && models.length > 0) {
                setOllamaModels(models);
                setOllamaStatus('detected');
            } else if (ollamaStatus !== 'detected') {
                setOllamaStatus('not-found');
            }
        } catch {
            if (ollamaStatus !== 'detected') {
                setOllamaStatus('not-found');
            }
        }
    };

    const handleFixOllama = async () => {
        setOllamaStatus('fixing');
        try {
            // @ts-ignore
            const result = await window.electronAPI?.invoke?.('force-restart-ollama');
            if (result && result.success) {
                setTimeout(() => checkOllama(false), 2000);
            } else {
                setOllamaStatus('not-found');
            }
        } catch (e) {
            console.error("Fix failed", e);
            setOllamaStatus('not-found');
        }
    };

    return (
        <div className="space-y-5 animated fadeIn pb-10">
            <div className="space-y-5">
                <div>
                    <h3 className="text-sm font-bold text-text-primary mb-1">Default Model for Chat</h3>
                    <p className="text-xs text-text-secondary mb-2">Primary model for new chats. Other configured models act as fallbacks.</p>
                </div>
                <div className="bg-bg-item-surface rounded-xl p-5 border border-border-subtle flex items-center justify-between">
                    <div>
                        <label className="block text-xs font-medium text-text-primary uppercase tracking-wide mb-0">Active Model</label>
                        <p className="text-[10px] text-text-secondary">Applies to new chats instantly.</p>
                    </div>
                    <ModelSelect
                        value={defaultModel}
                        options={(() => {
                            const opts: { id: string; name: string }[] = [];
                            for (const [prov, cfg] of Object.entries(STANDARD_CLOUD_MODELS)) {
                                if (!hasStoredKey[prov as keyof typeof hasStoredKey]) continue;
                                cfg.ids.forEach((id, i) => opts.push({ id, name: cfg.names[i] }));
                                const pm = preferredModels[prov as keyof typeof preferredModels];
                                if (pm && !cfg.ids.includes(pm)) {
                                    opts.push({ id: pm, name: prettifyModelId(pm) });
                                }
                            }
                            openaiCompatibleProviders
                                .filter(p => (p as { type?: string }).type === undefined || (p as { type?: string }).type === 'openai')
                                .forEach(p => opts.push({ id: p.id, name: `${p.name} (OpenAI-compatible)` }));
                            ollamaModels.forEach(m => opts.push({ id: `ollama-${m}`, name: `${m} (Local)` }));
                            if (defaultModel && !opts.find(o => o.id === defaultModel)) {
                                opts.unshift({ id: defaultModel, name: prettifyModelId(defaultModel) });
                            }
                            return opts;
                        })()}
                        onChange={(val) => {
                            queryClient.setQueryData(['default-model'], val);
                            window.electronAPI?.setDefaultModel?.(val).catch(console.error);
                        }}
                    />
                </div>
            </div>
            <ConnectionsSettings onChanged={() => void refreshAfterConnectionChange()} />
            <ModelUsesSettings />
            <ProactiveHelpSettings />
            <div className="space-y-5">
                <div className="flex items-center justify-between mb-2">
                    <div>
                        <h3 className="text-sm font-bold text-text-primary mb-1">Local Models (Ollama)</h3>
                        <p className="text-xs text-text-secondary">Run open-source models locally.</p>
                    </div>
                    <button
                        onClick={async () => {
                            setIsRefreshingOllama(true);
                            await checkOllama(false);
                            setTimeout(() => setIsRefreshingOllama(false), 500);
                        }}
                        className="p-2 rounded-lg text-text-secondary hover:text-text-primary hover:bg-bg-input transition-colors"
                        title="Refresh Ollama"
                        disabled={isRefreshingOllama}
                    >
                        <RefreshCw size={18} className={isRefreshingOllama ? "animate-spin" : ""} />
                    </button>
                </div>
                <div className="bg-bg-item-surface rounded-xl p-5 border border-border-subtle">
                    {ollamaStatus === 'checking' && (
                        <div className="flex items-center gap-2 text-xs text-text-secondary">
                            <span className="animate-spin">⏳</span> Checking for Ollama...
                        </div>
                    )}
                    {ollamaStatus === 'fixing' && (
                        <div className="flex items-center gap-2 text-xs text-text-secondary">
                            <span className="animate-spin">🔧</span> Attempting to auto-fix connection...
                        </div>
                    )}
                    {ollamaStatus === 'not-found' && (
                        <div className="flex flex-col gap-2">
                            <div className="flex items-center gap-2 text-xs text-state-danger">
                                <AlertCircle size={14} />
                                <span>Ollama not detected</span>
                            </div>
                            <div className="flex items-center gap-2">
                                <p className="text-xs text-text-secondary">Ensure Ollama is running (`ollama serve`).</p>
                                <button onClick={handleFixOllama} className="text-[10px] bg-bg-elevated hover:bg-bg-input px-2 py-1 rounded border border-border-subtle">
                                    Auto-Fix Connection
                                </button>
                            </div>
                        </div>
                    )}
                    {ollamaStatus === 'detected' && ollamaModels.length > 0 && (
                        <div className="space-y-3">
                            <div className="flex items-center gap-2 text-xs text-state-success mb-3">
                                <CheckCircle size={14} />
                                <span>Ollama connected</span>
                            </div>
                            <div className="grid grid-cols-1 gap-2">
                                {ollamaModels.map(model => (
                                    <div key={model} className="flex items-center justify-between p-2 bg-bg-input rounded-lg border border-border-subtle">
                                        <span className="text-xs text-text-primary font-mono">{model}</span>
                                        <span className="text-[10px] text-bg-elevated bg-text-secondary px-1.5 py-0.5 rounded-full font-bold">LOCAL</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                    {ollamaStatus === 'detected' && ollamaModels.length === 0 && (
                        <div className="text-xs text-text-secondary">Ollama is running but no models found. Run `ollama pull llama3` to get started.</div>
                    )}
                </div>
            </div>
        </div>
    );
};
