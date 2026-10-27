import t from 'tap';
import path from 'node:path';
import { mockRequire } from '../../node_modules/@tapjs/mock/dist/esm/mock-require.js';
import type { EmbeddingProviderResolver as Resolver } from '../../electron/rag/EmbeddingProviderResolver';
import type { Connection } from '../../electron/services/aiConnections';

const connection: Connection = {
    id: 'example', name: 'Example', type: 'openai',
    baseUrl: 'http://localhost:1234', apiKey: '', builtin: false,
};

for (const selectedAvailable of [true, false]) {
    t.test(`selected connection ${selectedAvailable ? 'answers' : 'fails'}: only selected then local are candidates`, async t => {
        const constructed: string[] = [];
        const probed: string[] = [];
        class Selected {
            name = 'example:exact-example';
            dimensions = 7;
            constructor(actual: Connection, model: string) {
                constructed.push('selected');
                t.same(actual, connection);
                t.equal(model, 'exact-example');
            }
            async isAvailable() { probed.push('selected'); return selectedAvailable; }
        }
        class Local {
            name = 'local';
            dimensions = 384;
            constructor() { constructed.push('local'); }
            async isAvailable() { probed.push('local'); return true; }
        }
        class NotSelected {
            constructor() { t.fail('automatic provider must not be constructed'); }
        }
        const { EmbeddingProviderResolver } = mockRequire(path.resolve('electron/rag/EmbeddingProviderResolver.ts'), {
            [path.resolve('electron/rag/providers/ConnectionEmbeddingProvider.ts')]: { ConnectionEmbeddingProvider: Selected },
            [path.resolve('electron/rag/providers/LocalEmbeddingProvider.ts')]: { LocalEmbeddingProvider: Local },
            [path.resolve('electron/rag/providers/OpenAIEmbeddingProvider.ts')]: { OpenAIEmbeddingProvider: NotSelected },
            [path.resolve('electron/rag/providers/GeminiEmbeddingProvider.ts')]: { GeminiEmbeddingProvider: NotSelected },
            [path.resolve('electron/rag/providers/OllamaEmbeddingProvider.ts')]: { OllamaEmbeddingProvider: NotSelected },
        }) as { EmbeddingProviderResolver: typeof Resolver };
        const result = await EmbeddingProviderResolver.resolve({
            selected: { connection, model: 'exact-example' },
            openaiKey: 'invented-openai-marker', geminiKey: 'invented-gemini-marker', ollamaUrl: 'http://localhost:11434',
        });
        t.same(constructed, ['selected', 'local']);
        t.same(probed, selectedAvailable ? ['selected'] : ['selected', 'local']);
        t.equal(result.name, selectedAvailable ? 'example:exact-example' : 'local');
    });
}

t.test('automatic selection retains OpenAI, Gemini, Ollama, local order', async t => {
    const probed: string[] = [];
    const provider = (name: string) => class {
        name = name;
        dimensions = 3;
        async isAvailable() { probed.push(name); return name === 'local'; }
    };
    const { EmbeddingProviderResolver } = mockRequire(path.resolve('electron/rag/EmbeddingProviderResolver.ts'), {
        [path.resolve('electron/rag/providers/ConnectionEmbeddingProvider.ts')]: { ConnectionEmbeddingProvider: class { constructor() { t.fail('no selection'); } } },
        [path.resolve('electron/rag/providers/OpenAIEmbeddingProvider.ts')]: { OpenAIEmbeddingProvider: provider('openai') },
        [path.resolve('electron/rag/providers/GeminiEmbeddingProvider.ts')]: { GeminiEmbeddingProvider: provider('gemini') },
        [path.resolve('electron/rag/providers/OllamaEmbeddingProvider.ts')]: { OllamaEmbeddingProvider: provider('ollama') },
        [path.resolve('electron/rag/providers/LocalEmbeddingProvider.ts')]: { LocalEmbeddingProvider: provider('local') },
    }) as { EmbeddingProviderResolver: typeof Resolver };
    t.equal((await EmbeddingProviderResolver.resolve({ openaiKey: 'invented', geminiKey: 'invented' })).name, 'local');
    t.same(probed, ['openai', 'gemini', 'ollama', 'local']);
});
