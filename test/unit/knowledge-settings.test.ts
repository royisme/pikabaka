import t from 'tap';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from 'react-query';
import KnowledgeSettings from '../../src/components/settings/KnowledgeSettings';

function renderSources(client: QueryClient) {
    const html = renderToStaticMarkup(React.createElement(
        QueryClientProvider,
        { client },
        React.createElement(KnowledgeSettings, { onClose: () => {} })
    ));
    client.clear();
    return html;
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
