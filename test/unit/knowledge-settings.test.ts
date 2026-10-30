import t from 'tap';
import path from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MutationObserver, QueryClient, QueryClientProvider, QueryObserver } from '@tanstack/react-query';
import * as ReactQuery from '@tanstack/react-query';
import type { UseMutationOptions } from '@tanstack/react-query';
import { mockRequire } from '../../node_modules/@tapjs/mock/dist/esm/mock-require.js';
import KnowledgeSettings from '../../src/components/settings/KnowledgeSettings';
import ImportedDocuments from '../../src/components/settings/ImportedDocuments';
import type { ImportedDocument, NotesIndexStatus } from '../../electron/knowledge/types';

const noop = () => {};

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
    t.test(`Sources renders notes status ${status.state} from the status reply`, async t => {
        const previous = globalThis.window;
        globalThis.window = { electronAPI: {
            profileGetStatus: async () => ({ notesIndex: status }),
            profileGetNotes: async () => 'Invented lantern inventory.',
            getRecentMeetings: async () => [],
        } } as unknown as Window & typeof globalThis;
        t.teardown(() => { globalThis.window = previous; });
        const client = sourcesClient();
        client.removeQueries({ queryKey: ['profile', 'status'] });
        await client.fetchQuery({ queryKey: ['profile', 'status'], queryFn: () => window.electronAPI.profileGetStatus() });
        await client.fetchQuery({ queryKey: ['profile-notes'], queryFn: () => window.electronAPI.profileGetNotes() });
        await client.fetchQuery({ queryKey: ['recent-meetings'], queryFn: () => window.electronAPI.getRecentMeetings() });
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
    // The host seeds the cache and then draws once; v5 would otherwise start a mount fetch and draw
    // the loading state instead of the seeded one.
    const client = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity, staleTime: Infinity, retry: false } } });
    client.setQueryData(['profile', 'status'], {});
    return client;
}

t.test('Sources shows the actual empty results', t => {
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
    // A v5 query with no data is always stale, so a mount refetch would replace the error with a
    // loading state. `data: null` marks the failed attempt as settled, which is what this page shows.
    client.getQueryCache().build(client, { queryKey: ['recent-meetings'] }).setState({
        status: 'error', error: new Error('History storage unavailable'), data: null, dataUpdatedAt: Date.now(),
    });
    client.getQueryCache().build(client, { queryKey: ['profile-notes'] }).setState({
        status: 'error', error: new Error('Notes storage unavailable'), data: null, dataUpdatedAt: Date.now(),
    });
    const html = renderSources(client);
    t.match(html, '✕ History storage unavailable');
    t.match(html, '✕ Notes storage unavailable');
    t.notMatch(html, '0 recorded meetings');
    t.notMatch(html, '0 characters');
    t.notMatch(html, 'Write a note');
    t.end();
});

t.test('Sources shows one Use when answering row per kind, with the reply state and what it controls', t => {
    const client = sourcesClient();
    client.setQueryData(['recent-meetings'], []);
    client.setQueryData(['profile-notes'], '');
    client.setQueryData(['answer-sources'], { meetings: true, materials: false });
    const html = renderSources(client);
    t.match(html, 'Use when answering');
    t.equal((html.match(/role="switch"/g) ?? []).length, 2);
    t.match(html, 'Past meetings');
    t.match(html, 'Materials (notes and documents)');
    t.notMatch(html, /interview profile/i);
    t.match(html, 'Pika may search your recorded meetings when you ask a question.');
    t.match(html, 'Pika may search your notes and imported documents when you ask a question. Off until you turn it on.');
    t.match(html, '● On');
    t.match(html, '○ Off');
    t.match(html, 'bg-bg-component');
    t.notMatch(html, 'animate-spin');
    t.end();
});

const documentImportedAt = '2026-10-28T09:15:00.000Z';
const documentIndexedAt = '2026-10-28T14:02:00.000Z';
const importedDate = new Date(documentImportedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

function importedDocument(overrides: Partial<ImportedDocument> = {}): ImportedDocument {
    return {
        id: 4,
        name: 'quarterly-planning.md',
        kind: 'md',
        importedAt: documentImportedAt,
        passages: 42,
        state: 'indexed',
        provider: 'example:amber',
        dimensions: 3,
        indexedAt: documentIndexedAt,
        error: null,
        ...overrides,
    };
}

function documentsClient(documents: ImportedDocument[], materials = false) {
    const client = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity, staleTime: Infinity, retry: false } } });
    client.setQueryData(['knowledge-documents'], documents);
    client.setQueryData(['answer-sources'], { meetings: true, materials });
    return client;
}

function renderDocuments(client: QueryClient, platform: NodeJS.Platform = 'darwin') {
    const previous = globalThis.window;
    const sharedWindow = (globalThis.window ?? {}) as { electronAPI?: { platform: NodeJS.Platform } };
    const previousApi = sharedWindow.electronAPI;
    sharedWindow.electronAPI = { platform };
    globalThis.window = sharedWindow as unknown as Window & typeof globalThis;
    try {
        return renderToStaticMarkup(React.createElement(
            QueryClientProvider,
            { client },
            React.createElement(ImportedDocuments)
        ));
    } finally {
        sharedWindow.electronAPI = previousApi;
        globalThis.window = previous;
        client.clear();
    }
}

t.test('an indexed document row shows the name, kind, imported date, passages and the state in words plus a mark', t => {
    const html = renderDocuments(documentsClient([importedDocument()], true));
    t.match(html, 'quarterly-planning.md');
    t.match(html, `Markdown · ${importedDate} · 42 passages`);
    t.match(html, '✓ Indexed');
    t.match(html, 'example:amber');
    t.match(html, '3 dimensions');
    t.match(html, new Date(documentIndexedAt).toLocaleString());
    t.match(html, '>Remove</button>');
    t.notMatch(html, '>Re-index</button>', 'an indexed row has nothing to re-index');
    t.notMatch(html, 'Not used when answering', 'the Materials switch is off only when the reply says so');
    t.notMatch(html, 'animate-spin');
    t.end();
});

t.test('a needs-re-index row says what changed and offers Re-index', t => {
    const html = renderDocuments(documentsClient([importedDocument({ state: 'needs-reindex' })]));
    t.match(html, '▲ Needs re-index: the search model changed. Not searched until re-indexed.');
    t.match(html, '>Re-index</button>');
    t.match(html, '>Remove</button>');
    t.notMatch(html, '✓ Indexed');
    t.end();
});

t.test('a failed re-index says the earlier index is still searched, with its time', t => {
    const html = renderDocuments(documentsClient([importedDocument({ state: 'failed', error: 'Synthetic quota refused' })]));
    t.match(html, `▲ Re-index failed: Synthetic quota refused. Still searched with the index from ${new Date(documentIndexedAt).toLocaleString()}.`);
    t.match(html, '>Re-index</button>');
    t.end();
});

t.test('a failed first index shows the first line of the real error and offers Re-index', t => {
    const html = renderDocuments(documentsClient([importedDocument({
        name: 'vendor-contract-summary.docx',
        kind: 'docx',
        state: 'failed',
        provider: null,
        dimensions: null,
        indexedAt: null,
        error: 'Embedding provider not initialized\nat synthetic stack line',
    })]));
    t.match(html, 'vendor-contract-summary.docx');
    t.match(html, `Word document · ${importedDate} · 42 passages`);
    t.match(html, '✕ Not indexed: Embedding provider not initialized');
    t.notMatch(html, 'synthetic stack line', 'only the first line of the error is shown');
    t.match(html, '>Re-index</button>');
    t.end();
});

t.test('a stopped index reads Not indexed and a running one reads Indexing with its passage count', t => {
    const stopped = renderDocuments(documentsClient([importedDocument({ state: 'not-indexed', provider: null, dimensions: null, indexedAt: null })]));
    t.match(stopped, '○ Not indexed: indexing stopped before it finished.');
    t.match(stopped, '>Re-index</button>');

    const running = renderDocuments(documentsClient([importedDocument({ kind: 'txt', name: 'meeting-agenda.txt', state: 'indexing', provider: null, dimensions: null, indexedAt: null, passages: 120 })]));
    t.match(running, `Text · ${importedDate} · 120 passages`);
    t.match(running, '● Indexing 120 passages');
    t.notMatch(running, '>Re-index</button>', 'a running index cannot be started again');
    t.match(running, '>Remove</button>');
    t.end();
});

t.test('the empty line names only the formats this platform can read', t => {
    const mac = renderDocuments(documentsClient([]), 'darwin');
    t.match(mac, 'No documents yet. Import a .txt, .md or .docx file for Pika to search.');
    const windows = renderDocuments(documentsClient([]), 'win32');
    t.match(windows, 'No documents yet. Import a .txt or .md file for Pika to search.');
    t.notMatch(windows, '.docx');
    t.end();
});

t.test('the Materials-off line appears only when documents exist and the switch is off', t => {
    const off = renderDocuments(documentsClient([importedDocument()], false));
    t.match(off, 'Not used when answering: Materials is off under Use when answering.');
    const on = renderDocuments(documentsClient([importedDocument()], true));
    t.notMatch(on, 'Not used when answering');
    const empty = renderDocuments(documentsClient([], false));
    t.match(empty, 'No documents yet.');
    t.notMatch(empty, 'Not used when answering', 'nothing is claimed off for an empty list');
    t.end();
});

t.test('a failed list shows its real error instead of the empty line', t => {
    const client = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity, staleTime: Infinity, retry: false } } });
    client.setQueryData(['answer-sources'], { meetings: true, materials: true });
    const documentsQuery = client.getQueryCache().build(client, { queryKey: ['knowledge-documents'] });
    // v5 refetches an errored query that has no data as soon as it mounts, which would replace the
    // seeded error with a loading state. A failed refetch keeps its previous rows, so seed both.
    documentsQuery.setState({
        ...documentsQuery.state,
        status: 'error', error: new Error('Synthetic document listing unavailable'),
        data: [importedDocument()], fetchStatus: 'idle',
        errorUpdatedAt: Date.now(), dataUpdatedAt: Date.now(),
    });
    const html = renderDocuments(client);
    t.match(html, '✕ Synthetic document listing unavailable');
    t.notMatch(html, 'No documents yet.');
    t.end();
});

function documentsHost(api: Record<string, unknown>) {
    const previous = globalThis.window;
    const previousConfirm = globalThis.confirm;
    const confirmed: string[] = [];
    globalThis.confirm = (message?: string) => { confirmed.push(String(message)); return confirmed.length % 2 === 0; };
    // mockRequire evaluates the component against the window object that already exists, so later tests reuse it.
    const sharedWindow = (globalThis.window ?? {}) as { electronAPI?: unknown; platform?: string };
    sharedWindow.electronAPI = api;
    sharedWindow.platform = 'darwin';
    Object.defineProperty(globalThis, 'window', { configurable: true, value: sharedWindow });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity, gcTime: Infinity } } });
    const states: unknown[] = [];
    const queries: QueryObserver<unknown, Error>[] = [];
    const mutations: MutationObserver<unknown, Error, unknown>[] = [];
    const unsubscribes: Array<() => void> = [];
    const options = new Map<string, Record<string, unknown>>();
    let stateIndex = 0, queryIndex = 0, mutationIndex = 0;
    const { default: Component } = mockRequire(path.resolve('src/components/settings/ImportedDocuments.tsx'), {
        react: { ...React, useState: (initial: unknown) => {
            const index = stateIndex++;
            if (!(index in states)) states[index] = initial;
            return [states[index], (next: unknown) => { states[index] = typeof next === 'function' ? (next as (current: unknown) => unknown)(states[index]) : next; }];
        } },
        '@tanstack/react-query': {
            ...ReactQuery, useQueryClient: () => client,
            useQuery: ({ queryKey, queryFn, ...queryOptions }: { queryKey: readonly unknown[]; queryFn?: () => Promise<unknown> } & Record<string, unknown>) => {
                const index = queryIndex++;
                if (!queries[index]) {
                    // The seeded cache is fresh (staleTime: Infinity), so mounting renders it as is.
                    queries[index] = new QueryObserver(client, { queryKey, queryFn });
                    unsubscribes.push(queries[index].subscribe(noop));
                } else queries[index].setOptions({ queryKey, queryFn });
                options.set(JSON.stringify(queryKey), queryOptions);
                return queries[index].getCurrentResult();
            },
            // v5 takes one options object; the v4 `(mutationFn, options)` shape would put the whole
            // object where the function belongs.
            useMutation: (mutationOptions: UseMutationOptions<unknown, Error, unknown> = {}) => {
                const index = mutationIndex++;
                const fresh = { ...mutationOptions };
                if (!mutations[index]) {
                    mutations[index] = new MutationObserver(client, fresh);
                    unsubscribes.push(mutations[index].subscribe(noop));
                } else mutations[index].setOptions(fresh);
                const observer = mutations[index];
                return { ...observer.getCurrentResult(), reset: () => observer.reset(), mutate: (value: unknown) => { void observer.mutate(value).catch(noop); } };
            },
        },
    }) as { default: () => React.ReactNode };
    const draw = () => { stateIndex = 0; queryIndex = 0; mutationIndex = 0; return Component(); };
    const buttons = (tree: React.ReactNode): React.ReactElement<Record<string, unknown>>[] => {
        if (!React.isValidElement<{ children?: React.ReactNode }>(tree)) return [];
        return [...(tree.type === 'button' ? [tree as React.ReactElement<Record<string, unknown>>] : []),
            ...React.Children.toArray(tree.props.children).flatMap(buttons)];
    };
    return {
        draw, html: () => renderToStaticMarkup(draw()),
        button: (label: string) => buttons(draw()).find(button => button.props.children === label),
        buttons: (label: string) => buttons(draw()).filter(button => button.props.children === label),
        click: (label: string) => {
            const button = buttons(draw()).find(candidate => candidate.props.children === label);
            if (!button) throw new Error(`Missing button: ${label}`);
            (button.props.onClick as () => void)();
        },
        queryOptions: (key: string[]) => options.get(JSON.stringify(key)) ?? {},
        confirmed,
        settle: async () => { for (let i = 0; i < 4; i++) await new Promise(resolve => setImmediate(resolve)); },
        close: () => {
            unsubscribes.forEach(unsubscribe => unsubscribe()); queries.forEach(query => query.destroy());
            client.clear();
            globalThis.confirm = previousConfirm;
            Object.defineProperty(globalThis, 'window', { configurable: true, value: previous });
        },
    };
}

t.test('Remove asks first and sends nothing when the user cancels, then refetches the list once confirmed', async t => {
    const calls = { list: 0, remove: [] as number[] };
    const page = documentsHost({
        knowledgeListDocuments: async () => { calls.list++; return { success: true, documents: [importedDocument()] }; },
        getAnswerSources: async () => ({ meetings: true, materials: true }),
        knowledgeRemoveDocument: async (id: number) => { calls.remove.push(id); return { success: true }; },
    });
    t.teardown(page.close);
    page.draw(); await page.settle();
    t.equal(calls.list, 1);

    page.click('Remove'); await page.settle();
    t.same(page.confirmed, ['Remove quarterly-planning.md?']);
    t.same(calls.remove, [], 'a cancelled confirmation sends nothing');
    t.equal(calls.list, 1);

    page.click('Remove'); await page.settle();
    t.same(calls.remove, [4]);
    t.equal(calls.list, 2, 'the list refetches after Remove');
});

t.test('a failed import shows the real message and leaves the list unchanged', async t => {
    const calls = { list: 0, import: 0 };
    const page = documentsHost({
        knowledgeListDocuments: async () => { calls.list++; return { success: true, documents: [importedDocument()] }; },
        getAnswerSources: async () => ({ meetings: true, materials: true }),
        knowledgeImportDocument: async () => { calls.import++; return { success: false, error: 'This document has no text Pika can read.' }; },
    });
    t.teardown(page.close);
    page.draw(); await page.settle();
    const button = page.button('Import a document');
    t.comment(`import button disabled=${String(button?.props.disabled)} loading=${String(button === undefined)}`);
    page.click('Import a document'); await page.settle();
    t.comment(`import calls=${calls.import} list calls=${calls.list}`);
    t.equal(calls.import, 1);
    t.match(page.html(), '✕ This document has no text Pika can read.');
    t.equal(calls.list, 1, 'a refused import does not refetch an unchanged list');
    t.match(page.html(), 'quarterly-planning.md');
});

t.test('a cancelled import is not an error and a successful one refetches the list', async t => {
    let list = 0;
    let next: { cancelled: true } | { success: true; document: ImportedDocument } = { cancelled: true };
    const page = documentsHost({
        knowledgeListDocuments: async () => { list++; return { success: true, documents: [] }; },
        getAnswerSources: async () => ({ meetings: true, materials: true }),
        knowledgeImportDocument: async () => next,
    });
    t.teardown(page.close);
    page.draw(); await page.settle();
    page.click('Import a document'); await page.settle();
    t.match(page.html(), 'No documents yet.');
    t.notMatch(page.html(), '✕');

    next = { success: true, document: importedDocument() };
    page.click('Import a document'); await page.settle();
    t.equal(list, 2, 'the list refetches after a successful import');
});

t.test('Re-index sends the row id and refetches, and only the listed states offer it', async t => {
    const reindexed: number[] = [];
    const page = documentsHost({
        knowledgeListDocuments: async () => ({ success: true, documents: [
            importedDocument({ id: 7, name: 'agenda.txt', kind: 'txt', state: 'not-indexed', provider: null, dimensions: null, indexedAt: null }),
            importedDocument({ id: 8, name: 'planning.md' }),
        ] }),
        getAnswerSources: async () => ({ meetings: true, materials: true }),
        knowledgeReindexDocument: async (id: number) => { reindexed.push(id); return { success: true }; },
    });
    t.teardown(page.close);
    page.draw(); await page.settle();
    t.equal(page.buttons('Re-index').length, 1, 'only the not-indexed row offers Re-index');
    page.click('Re-index'); await page.settle();
    t.same(reindexed, [7]);
});

t.test('the list polls every two seconds only while a document is indexing', async t => {
    const page = documentsHost({
        knowledgeListDocuments: async () => ({ success: true, documents: [importedDocument({ state: 'indexing', provider: null, dimensions: null, indexedAt: null })] }),
        getAnswerSources: async () => ({ meetings: true, materials: true }),
    });
    t.teardown(page.close);
    page.draw(); await page.settle();
    // v5 hands the rule the query, v4 handed it the data.
    const interval = page.queryOptions(['knowledge-documents']).refetchInterval as (query: { state: { data?: ImportedDocument[] } }) => number | false;
    const at = (data: ImportedDocument[]) => interval({ state: { data } });
    t.equal(typeof interval, 'function', 'the polling rule is given to react-query');
    t.equal(at([importedDocument({ state: 'indexing', provider: null, dimensions: null, indexedAt: null })]), 2000);
    t.equal(at([importedDocument({ state: 'indexed' }), importedDocument({ id: 5, state: 'failed', error: 'Synthetic quota refused' })]), false, 'polling stops when nothing is indexing');
});

t.test('preload forwards the four document channels and their ids', async t => {
    let api!: Pick<Window['electronAPI'], 'knowledgeListDocuments' | 'knowledgeImportDocument' | 'knowledgeRemoveDocument' | 'knowledgeReindexDocument'>;
    const calls: unknown[][] = [];
    mockRequire(path.resolve('electron/preload.ts'), {
        electron: {
            contextBridge: { exposeInMainWorld: (_name: string, exposed: typeof api) => { api = exposed; } },
            ipcRenderer: { invoke: async (...args: unknown[]) => { calls.push(args); return { success: true, documents: [] }; } },
        },
    });
    await api.knowledgeListDocuments();
    await api.knowledgeImportDocument();
    await api.knowledgeRemoveDocument(11);
    await api.knowledgeReindexDocument(12);
    t.same(calls, [
        ['knowledge:list-documents'],
        ['knowledge:import-document'],
        ['knowledge:remove-document', 11],
        ['knowledge:reindex-document', 12],
    ]);
});
