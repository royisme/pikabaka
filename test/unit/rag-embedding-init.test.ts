import t from 'tap';
import path from 'node:path';
import Database from 'better-sqlite3';
import { mockRequire } from '../../node_modules/@tapjs/mock/dist/esm/mock-require.js';
import type { RAGManager as RAGManagerType } from '../../electron/rag/RAGManager';

const file = (name: string) => path.resolve(`electron/${name}`);

t.test('a rejected constructor embedding init is handled and a later init still becomes ready', async t => {
    const db = new Database(':memory:');
    db.exec('CREATE TABLE app_state (key TEXT PRIMARY KEY, value TEXT)');
    t.teardown(() => db.close());
    let resolutions = 0;
    const { VectorStore } = mockRequire(file('rag/VectorStore'), {
        [file('db/DatabaseManager')]: { DatabaseManager: { getInstance: () => ({ ensureVecTableForDim: () => {}, KNOWN_DIMS: [768] }) } },
    }) as { VectorStore: new (...args: unknown[]) => { getIncompatibleMeetingsCount: () => number } };
    const { EmbeddingPipeline } = mockRequire(file('rag/EmbeddingPipeline'), {
        [file('rag/providers/LocalEmbeddingProvider')]: { LocalEmbeddingProvider: class { dimensions = 768; async isAvailable() { return false; } } },
        [file('rag/EmbeddingProviderResolver')]: { EmbeddingProviderResolver: { resolve: async () => {
            resolutions += 1;
            if (resolutions === 1) throw new Error('invented missing embedding provider');
            return { name: 'invented-embedding', dimensions: 768, embed: async () => [1, 2, 3] };
        } } },
        electron: { BrowserWindow: { getAllWindows: () => [] } },
    }) as { EmbeddingPipeline: typeof import('../../electron/rag/EmbeddingPipeline').EmbeddingPipeline };
    const { RAGManager } = mockRequire(file('rag/RAGManager'), {
        [file('rag/VectorStore')]: { VectorStore }, [file('rag/EmbeddingPipeline')]: { EmbeddingPipeline },
    }) as { RAGManager: typeof RAGManagerType };

    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => unhandled.push(reason);
    process.on('unhandledRejection', onUnhandled);
    t.teardown(() => process.removeListener('unhandledRejection', onUnhandled));

    const manager = new RAGManager({ db, dbPath: '', extPath: '' });
    await new Promise<void>(resolve => setImmediate(resolve));
    t.same(unhandled, [], 'the constructor rejection is handled');
    t.equal(manager.isReady(), false, 'the pipeline stays not ready');
    t.equal(manager.getEmbeddingPipeline().getStatus().providerName, null);

    await manager.initializeEmbeddings({ openaiKey: 'invented-openai-key' });
    t.equal(manager.getEmbeddingPipeline().isReady(), true, 'a later successful init still works');
    t.equal(manager.getEmbeddingPipeline().getStatus().providerName, 'invented-embedding');
    t.same(unhandled, [], 'the later init is not rejected unhandled');
});
