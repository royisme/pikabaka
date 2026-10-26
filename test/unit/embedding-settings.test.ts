import t from 'tap';
import { CredentialsManager } from '../../electron/services/CredentialsManager';
import { buildEmbeddingConfig } from '../../electron/rag/embeddingConfig';

function credentials(values: Record<string, unknown> = {}): CredentialsManager {
    const cm = Object.create(CredentialsManager.prototype) as CredentialsManager;
    Reflect.set(cm, 'credentials', values);
    Reflect.set(cm, 'saveCredentials', () => {});
    return cm;
}

t.test('embedding choice defaults to automatic, validates and saves exact model ids', t => {
    const cm = credentials();
    t.same(cm.getEmbeddingUse(), { connectionId: '', model: '' });
    t.throws(() => cm.setEmbeddingUse({ connectionId: 'claude', model: 'example' }), /Anthropic has no embeddings API/);
    t.throws(() => cm.setEmbeddingUse({ connectionId: 'missing', model: 'example' }), /does not exist/);
    t.throws(() => cm.setEmbeddingUse({ connectionId: 'openai', model: '  ' }), /model id/);
    t.throws(() => cm.setEmbeddingUse(null as unknown as { connectionId: string; model: string }), /Invalid embedding model/);
    t.throws(() => cm.setEmbeddingUse({ connectionId: 'openai', model: 'x'.repeat(513) }), /Invalid embedding model/);
    cm.setEmbeddingUse({ connectionId: 'openai', model: ' exact-example:1 ' });
    t.same(cm.getEmbeddingUse(), { connectionId: 'openai', model: 'exact-example:1' });
    t.match(buildEmbeddingConfig(cm).selected, { connection: { id: 'openai', type: 'openai' }, model: 'exact-example:1' });
    cm.setEmbeddingUse({ connectionId: 'gemini', model: 'models/embedding-example' });
    t.match(buildEmbeddingConfig(cm).selected, { connection: { type: 'gemini' }, model: 'models/embedding-example' });
    cm.setEmbeddingUse({ connectionId: '', model: 'ignored-example' });
    t.same(cm.getEmbeddingUse(), { connectionId: '', model: '' });
    t.equal(buildEmbeddingConfig(cm).selected, undefined);
    t.end();
});

t.test('saved local choice is resolved independently of chat and never replaced by automatic keys', t => {
    const cm = credentials({
        embeddingConnectionId: 'local-example', embeddingModel: 'embeddinggemma:example',
        chatConnectionId: 'claude', chatModel: 'chat-example',
        openaiApiKey: 'invented-openai-marker', geminiApiKey: 'invented-gemini-marker',
        openaiCompatibleProviders: [{ id: 'local-example', name: 'Example', type: 'openai', baseUrl: 'http://localhost:1234/v1', apiKey: '' }],
    });
    const config = buildEmbeddingConfig(cm);
    t.equal(config.selected?.connection.id, 'local-example');
    t.equal(config.selected?.connection.apiKey, '');
    t.equal(config.selected?.model, 'embeddinggemma:example');
    t.equal(config.openaiKey, 'invented-openai-marker');
    t.equal(config.geminiKey, 'invented-gemini-marker');
    t.throws(() => buildEmbeddingConfig(credentials({ embeddingConnectionId: 'missing', embeddingModel: 'example' })), /no longer exists/);
    t.end();
});
