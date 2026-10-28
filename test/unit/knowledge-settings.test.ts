import t from 'tap';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from 'react-query';
import KnowledgeSettings from '../../src/components/settings/KnowledgeSettings';
import type { NotesIndexStatus } from '../../electron/knowledge/types';

function renderSources(client: QueryClient) {
    const html = renderToStaticMarkup(React.createElement(
        QueryClientProvider,
        { client },
        React.createElement(KnowledgeSettings, { onClose: () => {} })
    ));
    client.clear();
    return html;
}

const indexedAt = '2026-10-27T12:34:56.000Z';
for (const [status, expected] of [
    [{ state: 'indexed', provider: 'example:amber', dimensions: 3, indexedAt, error: null }, '✓ Indexed'],
    [{ state: 'not-indexed', provider: null, dimensions: null, indexedAt: null, error: 'Embedding quota exceeded' }, '✕ Not indexed'],
    [{ state: 'unknown', provider: null, dimensions: null, indexedAt: null, error: null }, '○ Unknown'],
    [{ state: 'needs-reindex', provider: 'example:amber', dimensions: 3, indexedAt, error: null }, '▲ Needs re-index'],
] as Array<[NotesIndexStatus, string]>) {
    t.test(`Sources renders notes status ${status.state} from the existing electronAPI reply`, async t => {
        const previous = globalThis.window;
        globalThis.window = { electronAPI: {
            profileGetStatus: async () => ({ hasProfile: false, profileMode: false, notesIndex: status }),
            profileGetNotes: async () => 'Invented lantern inventory.',
            getRecentMeetings: async () => [],
        } } as unknown as Window & typeof globalThis;
        t.teardown(() => { globalThis.window = previous; });
        const client = sourcesClient();
        client.removeQueries(['profile', 'status']);
        await client.fetchQuery(['profile', 'status'], () => window.electronAPI.profileGetStatus());
        await client.fetchQuery(['profile-notes'], () => window.electronAPI.profileGetNotes());
        await client.fetchQuery(['recent-meetings'], () => window.electronAPI.getRecentMeetings());
        const html = renderSources(client);
        t.match(html, expected);
        if (status.provider) {
            t.match(html, 'example:amber');
            t.match(html, '3 dimensions');
        }
        if (status.indexedAt && status.state === 'indexed') t.match(html, new Date(indexedAt).toLocaleString());
        if (status.error) t.match(html, 'Embedding quota exceeded');
        if (status.state === 'needs-reindex') t.match(html, 'active embedding model differs');
        if (status.state !== 'indexed') t.notMatch(html, '✓ Indexed');
        t.notMatch(html, 'animate-spin');
    });
}

function sourcesClient() {
    const client = new QueryClient({ defaultOptions: { queries: { cacheTime: Infinity, staleTime: Infinity, retry: false } } });
    client.setQueryData(['profile', 'status'], { hasProfile: false, profileMode: false });
    return client;
}

t.test('Sources works without a resume and shows the actual empty results', t => {
    const client = sourcesClient();
    client.setQueryData(['recent-meetings'], []);
    client.setQueryData(['profile-notes'], '');
    const html = renderSources(client);
    t.match(html, '0 recorded meetings');
    t.match(html, '○ Empty · 0 characters');
    t.match(html, 'Add a note for Pika to search.');
    t.match(html, 'Write a note');
    t.match(html, 'Open meeting history');
    t.match(html, /aria-pressed="true"[^>]*>Sources</);
    t.notMatch(html, 'Add resume', 'the default page is not a resume invitation');
    t.end();
});

t.test('Sources labels the capped history and counts the saved notes, not index jobs', t => {
    const client = sourcesClient();
    // Only the returned array length is read; no meeting content is needed by this page.
    client.setQueryData(['recent-meetings'], Array.from({ length: 50 }, () => ({})));
    const notes = 'Reference text for this test.';
    client.setQueryData(['profile-notes'], notes);
    const html = renderSources(client);
    t.match(html, 'The latest 50 recorded meetings');
    t.match(html, `● Saved · ${notes.length} characters`);
    t.match(html, '>Edit</button>');
    t.match(html, '>Remove</button>');
    t.notMatch(html, 'Write a note');
    t.end();
});

t.test('Sources shows real query errors instead of invented empty counts', t => {
    const client = sourcesClient();
    client.getQueryCache().build(client, { queryKey: ['recent-meetings'] }).setState({
        status: 'error', error: new Error('History storage unavailable'),
    });
    client.getQueryCache().build(client, { queryKey: ['profile-notes'] }).setState({
        status: 'error', error: new Error('Notes storage unavailable'),
    });
    const html = renderSources(client);
    t.match(html, '✕ History storage unavailable');
    t.match(html, '✕ Notes storage unavailable');
    t.notMatch(html, '0 recorded meetings');
    t.notMatch(html, '0 characters');
    t.notMatch(html, 'Write a note');
    t.end();
});
