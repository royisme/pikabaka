import { settingsModuleHost } from './settingsModuleHost';

type Use = { connectionId: string; model: string; supportsImages?: boolean };
type Job = 'chat' | 'summary' | 'agent';

const empty: Use = { connectionId: '', model: '' };
const gateways = [
    { id: 'invented-gateway', name: 'Invented gateway', type: 'openai' as const, baseUrl: 'http://localhost:1234/v1', builtin: false, hasApiKey: true, customBaseUrl: false },
    { id: 'invented-other', name: 'Invented other', type: 'openai' as const, baseUrl: 'http://localhost:4321/v1', builtin: false, hasApiKey: true, customBaseUrl: false },
];

export function modelUsesHost(job: Job, uses: Partial<Record<Job, Use>> = {}, api: object = {}) {
    const electronAPI = {
        chatModelGet: async () => uses.chat ?? empty,
        summaryModelGet: async () => uses.summary ?? empty,
        agentModelGet: async () => uses.agent ?? empty,
        chatModelSet: async () => ({ success: true }),
        summaryModelSet: async () => ({ success: true }),
        agentModelSet: async () => ({ success: true }),
        aiConnectionsList: async () => gateways,
        aiConnectionModels: async () => ({ success: true, models: [] }),
        modelTest: async () => ({ success: true, reply: 'Invented reply', firstTokenMs: 10, totalMs: 20 }),
        agentTest: async () => ({ success: true, reply: 'Invented reply', totalMs: 20, toolCalls: true }),
        getAiResponseLanguages: async () => [],
        getAiResponseLanguage: async () => 'English',
        setAiResponseLanguage: async () => ({ success: true }),
        getAnswerStyle: async () => '',
        setAnswerStyle: async () => ({ success: true }),
        ...api,
    };
    const host = settingsModuleHost('src/components/settings/ModelUsesSettings.tsx', electronAPI, [
        [['chat-model'], uses.chat ?? empty],
        [['summary-model'], uses.summary ?? empty],
        [['agent-model'], uses.agent ?? empty],
        [['ai-connections'], gateways],
    ]);
    host.render({ job });
    return host;
}
