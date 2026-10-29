import t from 'tap';
import path from 'node:path';
import { mockRequire } from '../../node_modules/@tapjs/mock/dist/esm/mock-require.js';
import type { LLMHelper as Helper } from '../../electron/core/LLMHelper';
import type { Connection } from '../../electron/services/aiConnections';
import { CredentialsManager } from '../../electron/services/CredentialsManager';
import { SYSTEM_PROMPT, taskPrompt } from '../../electron/llm/prompts';

// Provider SDKs are mocked; Google's auth dependency cannot load on Node 26 (removed SlowBuffer).
const originalGetInstance = CredentialsManager.getInstance;
t.afterEach(() => { CredentialsManager.getInstance = originalGetInstance; });

const LLM_HELPER = path.resolve('electron/core/LLMHelper.ts');
const { LLMHelper } = mockRequire(LLM_HELPER, {
    '@google/genai': { GoogleGenAI: class {}, ThinkingLevel: { LOW: 'LOW', MINIMAL: 'MINIMAL' } },
    [path.resolve('electron/services/CredentialsManager.ts')]: { CredentialsManager },
}) as { LLMHelper: typeof Helper };

function helper(): Helper {
    const llm = Object.create(LLMHelper.prototype) as Helper;
    Reflect.set(llm, 'aiResponseLanguage', 'English');
    return llm;
}

async function collect(stream: AsyncIterable<string>): Promise<string> {
    let text = '';
    for await (const part of stream) text += part;
    return text;
}

function managerReturning(connection: Connection): CredentialsManager {
    const manager = Object.create(CredentialsManager.prototype) as CredentialsManager;
    Reflect.set(manager, 'credentials', {});
    manager.resolveModelUse = () => ({ connection, model: 'invented-model' });
    CredentialsManager.getInstance = () => manager;
    return manager;
}

const CONNECTIONS: Connection[] = [
    { id: 'invented-claude', name: 'Invented Claude', type: 'anthropic', baseUrl: 'https://invented.example/v1', apiKey: '', builtin: false },
    { id: 'invented-gemini', name: 'Invented Gemini', type: 'gemini', baseUrl: 'https://invented.example', apiKey: '', builtin: false },
    { id: 'groq', name: 'Groq', type: 'openai', baseUrl: 'https://invented.example/v1', apiKey: '', builtin: true },
    { id: 'invented-openai', name: 'Invented OpenAI', type: 'openai', baseUrl: 'http://localhost:1234/v1', apiKey: '', builtin: false },
];

t.test('every provider and every entry point receives the same chat system prompt', async (t) => {
    const received: Array<[string, string]> = [];
    for (const connection of CONNECTIONS) {
        managerReturning(connection);
        const llm = helper();
        Reflect.set(llm, 'streamViaConnectionChat', async function* (...args: unknown[]) {
            received.push([connection.id, String(args[2])]);
            yield 'Invented reply';
        });
        await llm.chatWithGemini('Invented question');
        await collect(llm.streamChat('Invented question'));
        await collect(llm.streamChatWithGemini('Invented question'));
    }
    t.same(received.map(([id]) => id), CONNECTIONS.flatMap(connection => [connection.id, connection.id, connection.id]), 'three entry points per provider');
    const prompts = new Set(received.map(([, prompt]) => prompt));
    t.equal(prompts.size, 1, 'one system prompt for every provider path');
    t.ok(received.every(([, prompt]) => prompt.includes(SYSTEM_PROMPT)), 'the system prompt is the chat task prompt');
    t.end();
});

type Recorder = {
    seen: string[];
    llm: Helper;
};

function recorder(): Recorder {
    const seen: string[] = [];
    const llm = {
        chat: async (...args: unknown[]) => { seen.push(String(args[3])); return 'Invented reply'; },
        streamChat: async function* (...args: unknown[]) { seen.push(String(args[3])); yield 'Invented reply'; },
    };
    return { seen, llm: llm as unknown as Helper };
}

const MOCKED_HELPER = { [LLM_HELPER]: { LLMHelper: class {} } };

t.test('each answer class sends its own task prompt', async (t) => {
    const cases: Array<[string, string, (helper: Helper) => Promise<unknown>]> = [
        ['AnswerLLM', 'answer', async (llm) => {
            const { AnswerLLM } = mockRequire(path.resolve('electron/llm/AnswerLLM.ts'), MOCKED_HELPER) as typeof import('../../electron/llm/AnswerLLM');
            return new AnswerLLM(llm).generate('Invented question');
        }],
        ['AssistLLM', 'assist', async (llm) => {
            const { AssistLLM } = mockRequire(path.resolve('electron/llm/AssistLLM.ts'), MOCKED_HELPER) as typeof import('../../electron/llm/AssistLLM');
            return new AssistLLM(llm).generate('Invented context');
        }],
        ['BrainstormLLM', 'brainstorm', async (llm) => {
            const { BrainstormLLM } = mockRequire(path.resolve('electron/llm/BrainstormLLM.ts'), MOCKED_HELPER) as typeof import('../../electron/llm/BrainstormLLM');
            return collect(new BrainstormLLM(llm).generateStream('Invented problem'));
        }],
        ['ClarifyLLM', 'clarify', async (llm) => {
            const { ClarifyLLM } = mockRequire(path.resolve('electron/llm/ClarifyLLM.ts'), MOCKED_HELPER) as typeof import('../../electron/llm/ClarifyLLM');
            return new ClarifyLLM(llm).generate('Invented question');
        }],
        ['CodeHintLLM', 'codeHint', async (llm) => {
            const { CodeHintLLM } = mockRequire(path.resolve('electron/llm/CodeHintLLM.ts'), MOCKED_HELPER) as typeof import('../../electron/llm/CodeHintLLM');
            return collect(new CodeHintLLM(llm).generateStream());
        }],
        ['FollowUpLLM', 'followUp', async (llm) => {
            const { FollowUpLLM } = mockRequire(path.resolve('electron/llm/FollowUpLLM.ts'), MOCKED_HELPER) as typeof import('../../electron/llm/FollowUpLLM');
            return new FollowUpLLM(llm).generate('Invented previous answer', 'Invented request');
        }],
        ['FollowUpQuestionsLLM', 'followUpQuestions', async (llm) => {
            const { FollowUpQuestionsLLM } = mockRequire(path.resolve('electron/llm/FollowUpQuestionsLLM.ts'), MOCKED_HELPER) as typeof import('../../electron/llm/FollowUpQuestionsLLM');
            return new FollowUpQuestionsLLM(llm).generate('Invented context');
        }],
        ['RecapLLM', 'recap', async (llm) => {
            const { RecapLLM } = mockRequire(path.resolve('electron/llm/RecapLLM.ts'), MOCKED_HELPER) as typeof import('../../electron/llm/RecapLLM');
            return new RecapLLM(llm).generate('Invented context');
        }],
        ['WhatToAnswerLLM', 'whatToAnswer', async (llm) => {
            const { WhatToAnswerLLM } = mockRequire(path.resolve('electron/llm/WhatToAnswerLLM.ts'), MOCKED_HELPER) as typeof import('../../electron/llm/WhatToAnswerLLM');
            return collect(new WhatToAnswerLLM(llm).generateStream('Invented transcript'));
        }],
    ];
    for (const [name, task, run] of cases) {
        const { seen, llm } = recorder();
        await run(llm);
        t.same(seen, [taskPrompt(task as Parameters<typeof taskPrompt>[0])], `${name} sends the ${task} task prompt`);
    }
    t.end();
});
