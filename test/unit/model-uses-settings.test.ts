import t from 'tap';
import * as ReactQuery from 'react-query';
import { modelUsesHost } from '../helpers/modelUsesHost';

const noop = () => {};
ReactQuery.setLogger({ log: noop, warn: noop, error: noop });
t.teardown(() => ReactQuery.setLogger(console));

const own = { connectionId: 'invented-gateway', model: 'invented-model' };
const other = { connectionId: 'invented-other', model: 'invented-other-model' };

t.test('Also used by names the other jobs that resolve to the same saved connection and model', async t => {
    // Summaries and the agent have no connection of their own, so they inherit quick answers.
    const inheriting = { chat: own, summary: { connectionId: '', model: '' }, agent: { connectionId: '', model: '' } };
    const expected: Record<'chat' | 'summary' | 'agent', string | null> = {
        chat: 'Also used by: Summaries, Agent',
        summary: 'Also used by: Quick answers, Agent',
        agent: 'Also used by: Quick answers, Summaries',
    };
    for (const job of ['chat', 'summary', 'agent'] as const) {
        const host = modelUsesHost(job, inheriting);
        t.teardown(host.unmount);
        t.ok(host.html().includes(expected[job]!), `${job}: names the inheriting jobs`);
    }

    // An explicit identical choice counts; a different one does not.
    const explicit = { chat: own, summary: { ...own }, agent: other };
    for (const [job, line] of [['chat', 'Also used by: Summaries'], ['summary', 'Also used by: Quick answers'], ['agent', null]] as const) {
        const host = modelUsesHost(job, explicit);
        t.teardown(host.unmount);
        if (line) t.ok(host.html().includes(line), `${job}: only the shared job is named`);
        else t.notMatch(host.html(), 'Also used by', 'a job with a model of its own names nobody');
    }

    // Quick answers unset: nobody inherits it, so no row claims a companion.
    for (const job of ['chat', 'summary', 'agent'] as const) {
        const host = modelUsesHost(job, { chat: { connectionId: '', model: '' }, summary: own, agent: other });
        t.teardown(host.unmount);
        t.notMatch(host.html(), 'Also used by', `${job}: an unset quick answers row shares nothing`);
    }
});

t.test('a job alone shows no Also used by line', async t => {
    for (const job of ['chat', 'summary', 'agent'] as const) {
        const host = modelUsesHost(job, { chat: own, summary: other, agent: { connectionId: 'invented-other', model: 'invented-agent-model' } });
        t.teardown(host.unmount);
        t.notMatch(host.html(), 'Also used by', `${job}: no shared connection and model`);
    }
});

t.test('the row Test sits collapsed and opens itself when a result or error arrives', async t => {
    const host = modelUsesHost('summary');
    t.teardown(host.unmount);
    let html = host.html();
    t.match(html, /aria-expanded="false" aria-controls="summary-model-test"/);
    t.match(html, /id="summary-model-test" hidden=""/);
    t.ok(html.indexOf('id="summary-model-test"') < html.indexOf('Test summaries model'));
    host.click('Test');
    t.match(host.html(), /aria-expanded="true" aria-controls="summary-model-test"/);
    host.click('Test summaries model');
    host.click('Test');
    t.match(host.html(), /id="summary-model-test" hidden=""/, 'collapsed again while the test runs');
    await host.settle();
    html = host.html();
    t.match(html, /aria-expanded="true" aria-controls="summary-model-test"/);
    t.notMatch(html, /id="summary-model-test" hidden/);
    t.match(html, 'Answered: Invented reply');
});

t.test('a failed Test opens the disclosure with the real error', async t => {
    const host = modelUsesHost('summary', {}, {
        modelTest: async () => ({ success: false, error: 'Invented test refusal' }),
    });
    t.teardown(host.unmount);
    host.click('Test summaries model');
    await host.settle();
    t.match(host.html(), /aria-expanded="true" aria-controls="summary-model-test"/);
    t.match(host.html(), 'Invented test refusal');
});
