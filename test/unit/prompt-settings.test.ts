import t, { type Test } from 'tap';
import path from 'node:path';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { mockRequire } from '../../node_modules/@tapjs/mock/dist/esm/mock-require.js';
import { settingsModuleHost } from '../helpers/settingsModuleHost';
import type * as Settings from '../../electron/services/SettingsManager';
import type * as Prompts from '../../electron/llm/prompts';
import * as promptsModule from '../../electron/llm/prompts';

const file = (name: string) => path.resolve(`electron/${name}.ts`);

function tempSettings(t: Test) {
    const dir = mkdtempSync(path.join(tmpdir(), 'pika-prompt-settings-'));
    t.teardown(() => rmSync(dir, { recursive: true, force: true }));
    const settingsPath = path.join(dir, 'settings.json');
    return { dir, settingsPath };
}

/** The real SettingsManager over a temporary settings.json, as the answer-source tests load it. */
function settings(t: Test, settingsPath: string) {
    const s = mockRequire(file('services/SettingsManager'), {
        [file('services/configPaths')]: { getSettingsJsonPath: () => settingsPath },
    }) as typeof Settings;
    return { ...s, manager: s.SettingsManager.getInstance() };
}

function handlers(t: Test) {
    const { settingsPath } = tempSettings(t);
    const s = settings(t, settingsPath);
    const registered = new Map<string, (event: unknown, payload?: unknown) => Promise<unknown>>();
    const { registerPromptHandlers } = mockRequire(file('ipc/prompts'), {
        [file('ipc/safeHandle')]: {
            safeHandle: (channel: string, handler: (event: unknown, payload?: unknown) => Promise<unknown>) => registered.set(channel, handler),
        },
        [file('services/SettingsManager')]: s,
        // The handlers and the test share one `prompts` module, so the source the handlers register is the one `taskPrompt` reads.
        [file('llm/prompts')]: promptsModule,
    }) as typeof import('../../electron/ipc/prompts');
    registerPromptHandlers();
    return {
        manager: s.manager,
        settingsPath,
        invoke: (channel: string, payload?: unknown) => registered.get(channel)!({}, payload),
        saved: () => readFileSync(settingsPath, 'utf8'),
    };
}

t.test('the settings manager round-trips the prompts key and reset removes it', (t) => {
    const path_ = tempSettings(t);
    const s = settings(t, path_.settingsPath);
    const manager = s.SettingsManager.getInstance();
    manager.set('answerUsesMaterials', true);

    manager.set('prompts', { role: 'Invented role line.', tasks: { recap: 'Invented recap text.' } });
    t.same(manager.get('prompts'), { role: 'Invented role line.', tasks: { recap: 'Invented recap text.' } });
    t.same(JSON.parse(readFileSync(path_.settingsPath, 'utf8')), {
        answerUsesMaterials: true,
        prompts: { role: 'Invented role line.', tasks: { recap: 'Invented recap text.' } },
    });

    manager.set('prompts', undefined);
    t.equal(manager.get('prompts'), undefined, 'the key is gone from memory');
    t.same(JSON.parse(readFileSync(path_.settingsPath, 'utf8')), { answerUsesMaterials: true }, 'the unrelated key is untouched and the prompts key is removed');
    t.end();
});

t.test('prompts:get reports the text in force, the built-in text and whether it is edited', async (t) => {
    const f = handlers(t);
    const prompts = await import('../../electron/llm/prompts') as typeof Prompts;
    const unedited = await f.invoke('prompts:get') as Prompts.PromptsReply;
    t.equal(unedited.role.text, prompts.ROLE_PROMPT);
    t.equal(unedited.role.defaultText, prompts.ROLE_PROMPT);
    t.equal(unedited.role.edited, false);
    t.same(Object.keys(unedited.tasks), [...prompts.TASK_NAMES], 'the ten tasks, in the declared order');
    for (const task of prompts.TASK_NAMES) {
        t.equal(unedited.tasks[task].text, prompts.taskText(task, {}), `${task}: the built-in text is in force`);
        t.equal(unedited.tasks[task].edited, false);
        t.equal(unedited.tasks[task].defaultText, prompts.taskText(task, {}));
    }
    t.equal(unedited.rules, prompts.CORE_RULES, 'the fixed rules are shown as they are');
    t.equal(unedited.maxLength, prompts.PROMPT_MAX_LENGTH);
    t.same(await f.invoke('prompts:set', { role: 'Invented role line.', tasks: { recap: 'Invented recap text.' } }), { success: true });
    const edited = await f.invoke('prompts:get') as Prompts.PromptsReply;
    t.same(edited.role, { text: 'Invented role line.', defaultText: prompts.ROLE_PROMPT, edited: true });
    t.same(edited.tasks.recap, { text: 'Invented recap text.', defaultText: prompts.RECAP_TASK, edited: true });
    t.same(edited.tasks.answer, { text: prompts.ANSWER_TASK, defaultText: prompts.ANSWER_TASK, edited: false }, 'the other tasks are untouched');
    t.end();
});

t.test('the edited chat text is the next request system prompt, with no restart', async (t) => {
    const f = handlers(t);
    const prompts = await import('../../electron/llm/prompts') as typeof Prompts;
    t.teardown(() => prompts.setPromptOverridesSource(() => ({})));
    // `handlers` registered the channels: that alone must connect the saved text to `taskPrompt`.
    t.equal(prompts.taskPrompt('chat'), prompts.taskPrompt('chat', {}), 'nothing edited yet');
    t.same(await f.invoke('prompts:set', { tasks: { chat: 'Invented chat text.' } }), { success: true });
    t.equal(prompts.taskPrompt('chat'), `${prompts.ROLE_PROMPT}\n\nInvented chat text.\n\n${prompts.CORE_RULES}`, 'the saved text is read at call time');
    t.end();
});

t.test('prompts:set rejects an unknown task, a non-string and an over-long text, and a mixed payload writes nothing', async (t) => {
    const f = handlers(t);
    const prompts = await import('../../electron/llm/prompts') as typeof Prompts;
    t.same(await f.invoke('prompts:set', { tasks: { recap: 'Invented recap text.' } }), { success: true });
    const before = f.saved();
    const bad: Array<[string, unknown]> = [
        ['an unknown task', { tasks: { everything: 'Invented text.' } }],
        ['an unknown key', { prose: 'Invented text.' }],
        ['a non-string role', { role: 7 }],
        ['a non-string task text', { tasks: { answer: true } }],
        ['an over-long text', { tasks: { answer: 'x'.repeat(prompts.PROMPT_MAX_LENGTH + 1) } }],
        ['a tasks value that is not an object', { tasks: 'Invented text.' }],
        ['a payload that is not an object', 'Invented text.'],
        ['an array', []],
        ['null', null],
        ['a mixed payload with one bad entry', { role: 'Invented role line.', tasks: { answer: 'Invented answer text.', nope: 'Invented text.' } }],
    ];
    for (const [name, payload] of bad) {
        const reply = await f.invoke('prompts:set', payload) as { success: boolean; error?: string };
        t.equal(reply.success, false, `${name} is rejected`);
        t.ok(reply.error, `${name} returns the real reason`);
        t.equal(f.saved(), before, `${name} writes nothing`);
    }
    t.end();
});

t.test('prompts:set resets by null, by empty text and by the built-in text', async (t) => {
    const f = handlers(t);
    const prompts = await import('../../electron/llm/prompts') as typeof Prompts;
    const edited = async () => (await f.invoke('prompts:get') as Prompts.PromptsReply);

    t.same(await f.invoke('prompts:set', { role: 'Invented role line.', tasks: { answer: 'Invented answer text.', recap: 'Invented recap text.' } }), { success: true });
    t.same(await f.invoke('prompts:set', { role: null }), { success: true });
    t.equal((await edited()).role.edited, false, 'null resets the role');
    t.equal((await edited()).tasks.answer.edited, true, 'the task edits stay');

    t.same(await f.invoke('prompts:set', { tasks: { answer: '' } }), { success: true });
    t.equal((await edited()).tasks.answer.edited, false, 'an empty text resets');

    t.same(await f.invoke('prompts:set', { tasks: { recap: `  ${prompts.RECAP_TASK}\n` } }), { success: true });
    t.equal((await edited()).tasks.recap.edited, false, 'the built-in text, spacing aside, is stored as no override');
    t.equal((JSON.parse(f.saved()).prompts?.tasks ?? {}).recap, undefined, 'no override is written for a text equal to the built-in one');

    t.same(await f.invoke('prompts:set', { tasks: { recap: 'Invented recap text.' } }), { success: true });
    t.same(await f.invoke('prompts:set', { tasks: { recap: '   ' } }), { success: true });
    t.equal((await edited()).tasks.recap.edited, false, 'a whitespace-only text resets');

    t.same(JSON.parse(f.saved()), {}, 'with every override removed the key is gone');
    t.end();
});

const reply = (edited: { role?: string; tasks?: Record<string, string> } = {}): Prompts.PromptsReply => {
    const role = edited.role;
    return {
        role: role === undefined
            ? { text: 'Built-in role.', defaultText: 'Built-in role.', edited: false }
            : { text: role, defaultText: 'Built-in role.', edited: true },
        tasks: Object.fromEntries([
            ['answer', 'Answer built-in.'],
            ['whatToAnswer', 'What to answer built-in.'],
            ['recap', 'Recap built-in.'],
            ['followUp', 'Follow-up built-in.'],
            ['followUpQuestions', 'Follow-up questions built-in.'],
            ['assist', 'Assist built-in.'],
            ['clarify', 'Clarify built-in.'],
            ['codeHint', 'Code hint built-in.'],
            ['brainstorm', 'Brainstorm built-in.'],
            ['chat', 'Chat built-in.'],
        ].map(([task, text]) => {
            const saved = edited.tasks?.[task];
            return [task, saved === undefined
                ? { text, defaultText: text, edited: false }
                : { text: saved, defaultText: text, edited: true }];
        })) as Prompts.PromptsReply['tasks'],
        rules: 'RULES THAT ALWAYS APPLY:\n- Invented fixed rule.',
        maxLength: 8000,
    };
};

function host(t: Test, api: Record<string, unknown>, data: Prompts.PromptsReply = reply()) {
    const h = settingsModuleHost('src/components/settings/PromptsSettings.tsx', api, [[['prompts'], data]]);
    t.teardown(h.unmount);
    h.click('Prompts');
    return h;
}

t.test('the Prompts section shows the role and the ten tasks with their badge and count', (t) => {
    const h = host(t, { getPrompts: async () => reply(), setPrompts: async () => ({ success: true }) }, reply({ role: 'Invented role line.', tasks: { recap: 'Invented recap text.' } }));
    const html = h.html();
    for (const words of [
        'The text Pika sends with every request. Edit it to change how it answers; reset to go back to the built-in text.',
        'The proactive-help, summary and detection prompts are fixed.',
        'Role',
        'Fixed rules',
        'RULES THAT ALWAYS APPLY:',
        'Invented fixed rule.',
    ]) t.match(html, words);
    t.same(h.control('textarea', 'prompt-role').props.value, 'Invented role line.', 'the role textarea shows the text in force');
    t.ok(h.control('textarea', 'prompt-role').props.id === 'prompt-role', 'the textarea has the id its label points at');
    t.ok(h.html().includes('for="prompt-role"'), 'the Role label is a real label');
    const labels = ['Answer', 'What to answer', 'Recap', 'Follow-up', 'Follow-up questions', 'Assist', 'Clarify', 'Code hint', 'Brainstorm', 'Chat'];
    t.same(labels.map(label => String(h.control('button', label).props.children)), labels, 'the ten tasks in the agreed order');
    t.same(labels.map(label => h.control('button', label).props['aria-expanded']), labels.map(() => false), 'none is open at first');
    t.equal(h.control('button', 'Recap').props['aria-controls'], 'prompt-body-recap');
    t.equal(h.control('div', 'prompt-body-recap').props.hidden, true, 'a closed task keeps its textarea hidden');
    t.match(h.html(), 'Invented recap text.', 'the saved text is in the page');
    t.match(h.html(), 'Edited');
    t.match(h.html(), 'Built-in');
    t.match(h.html(), '19 / 8000', 'the count is against the reported limit');
    t.end();
});

t.test('only one task is open at a time and each opener keeps its keyboard behaviour', (t) => {
    const h = host(t, { getPrompts: async () => reply(), setPrompts: async () => ({ success: true }) });
    h.click('Answer');
    t.equal(h.control('div', 'prompt-body-answer').props.hidden, false, 'Answer opens');
    t.equal(h.control('button', 'Answer').props['aria-expanded'], true);
    h.click('Recap');
    t.equal(h.control('div', 'prompt-body-answer').props.hidden, true, 'opening Recap closes Answer');
    t.equal(h.control('div', 'prompt-body-recap').props.hidden, false);
    h.click('Recap');
    t.equal(h.control('div', 'prompt-body-recap').props.hidden, true, 'the opener closes it again');
    t.equal(h.control('button', 'Recap').props.type, 'button', 'the opener is a button, so Enter and Space work');
    t.end();
});

t.test('the fixed rules block is read-only text', (t) => {
    const h = host(t, { getPrompts: async () => reply(), setPrompts: async () => ({ success: true }) });
    const html = h.html();
    t.match(html, /<pre[^>]*>RULES THAT ALWAYS APPLY/);
    t.notMatch(html, /<(textarea|input)[^>]*id="prompt-rules"/, 'there is no field for the rules');
    t.end();
});

t.test('Save sends the edited text of that one prompt', async (t) => {
    const sent: unknown[] = [];
    const h = host(t, { getPrompts: async () => reply(), setPrompts: async (payload: unknown) => { sent.push(payload); return { success: true }; } });
    t.equal(h.control('button', 'Save Role').props.disabled, true, 'nothing to save before a keystroke');
    h.change('textarea', 'prompt-role', 'Invented role line.');
    h.click('Save Role');
    await h.settle();
    t.same(sent, [{ role: 'Invented role line.' }]);
    h.click('Answer');
    h.change('textarea', 'prompt-answer', 'Invented answer text.');
    h.click('Save Answer');
    await h.settle();
    t.same(sent, [{ role: 'Invented role line.' }, { tasks: { answer: 'Invented answer text.' } }]);
    t.end();
});

t.test('Reset sends null and is disabled when the text is not edited', async (t) => {
    const sent: unknown[] = [];
    const edited = reply({ tasks: { recap: 'Invented recap text.' } });
    const h = host(t, { getPrompts: async () => edited, setPrompts: async (payload: unknown) => { sent.push(payload); return { success: true }; } }, edited);
    h.click('Answer');
    t.equal(h.control('button', 'Reset Answer').props.disabled, true, 'a built-in text has nothing to reset');
    h.click('Recap');
    t.equal(h.control('button', 'Reset Recap').props.disabled, false, 'an edited text can be reset');
    h.click('Reset Recap');
    await h.settle();
    t.same(sent, [{ tasks: { recap: null } }]);
    t.end();
});

t.test('a failed save shows the real error on that prompt', async (t) => {
    const h = host(t, { getPrompts: async () => reply(), setPrompts: async () => ({ success: false, error: 'The settings file is read-only.' }) });
    h.click('Answer');
    h.change('textarea', 'prompt-answer', 'Invented answer text.');
    h.click('Save Answer');
    await h.settle();
    t.match(h.html(), 'The settings file is read-only.');
    t.match(h.html(), 'role="alert"');
    t.end();
});

t.test('a text over the limit cannot be saved and says so', async (t) => {
    const sent: unknown[] = [];
    const h = host(t, { getPrompts: async () => reply(), setPrompts: async (payload: unknown) => { sent.push(payload); return { success: true }; } });
    h.change('textarea', 'prompt-role', 'x'.repeat(8001));
    t.equal(h.control('button', 'Save Role').props.disabled, true, 'Save is off over the limit');
    t.match(h.html(), '8001 / 8000');
    t.same(sent, []);
    t.end();
});

t.test('a text of exactly the limit is saved; one more character is not', async (t) => {
    const f = handlers(t);
    const prompts = await import('../../electron/llm/prompts') as typeof Prompts;
    t.same(await f.invoke('prompts:set', { role: 'a'.repeat(prompts.PROMPT_MAX_LENGTH) }), { success: true }, 'the limit itself is allowed');
    t.equal(((await f.invoke('prompts:get')) as Prompts.PromptsReply).role.text.length, prompts.PROMPT_MAX_LENGTH);
    const refused = await f.invoke('prompts:set', { tasks: { recap: 'a'.repeat(prompts.PROMPT_MAX_LENGTH + 1) } }) as { success: boolean; error?: string };
    t.equal(refused.success, false);
    t.match(refused.error, /8000/);
    t.end();
});

t.test('tasks must be an object: null, an array and a string are refused and write nothing', async (t) => {
    const f = handlers(t);
    for (const tasks of [null, [], ['x'], 'recap']) {
        const result = await f.invoke('prompts:set', { role: 'Invented role line.', tasks }) as { success: boolean; error?: string };
        t.equal(result.success, false, `tasks: ${JSON.stringify(tasks)}`);
        t.match(result.error, /tasks must be an object/);
    }
    t.equal(((await f.invoke('prompts:get')) as Prompts.PromptsReply).role.edited, false, 'the valid role in the same payload was not saved');
    t.end();
});
