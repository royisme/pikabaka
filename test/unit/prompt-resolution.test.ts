import t from 'tap';
import { createHash } from 'node:crypto';
import {
    ANSWER_TASK,
    ASK_TASK,
    ASSIST_TASK,
    CATCH_UP_TASK,
    CHAT_TASK,
    CORE_RULES,
    FOLLOW_UP_TASK,
    ROLE_PROMPT,
    TASK_NAMES,
    TASK_TEXT,
    rolePrompt,
    systemPrompt,
    taskPrompt,
    taskText,
    type TaskName,
} from '../../electron/llm/prompts';

const BUILT_IN: Record<TaskName, string> = {
    answer: ANSWER_TASK,
    catchUp: CATCH_UP_TASK,
    followUp: FOLLOW_UP_TASK,
    assist: ASSIST_TASK,
    ask: ASK_TASK,
    chat: CHAT_TASK,
};

const TASKS = Object.keys(BUILT_IN) as TaskName[];

/** The sha256 of `taskPrompt(task)` on the commit before the setting was added, for the tasks whose text has not changed since. */
const PRE_SETTING_SHA256: Partial<Record<TaskName, string>> = {
    answer: 'be476d5d679e6a395874c81a718df748df4cf25195abcad5a406a2a85fc3db03',
    catchUp: '83ca2562eda711bd85a7a22833c9fa915118e9712cae4a7eb630c1ebe3a69645',
    followUp: 'f9788133cd76f9ce88e6e779d79ed0293dc767dbbe4860371819c3f4fe18e79f',
    assist: 'b6b3e2e62a8dc3eb3fb1e1fd50bd18d2b073171ceeb0ce316bbfbf8a4ae85f30',
};

t.test('the six tasks are listed once, in the order the built-in text declares them', t => {
    t.same(TASK_NAMES, TASKS);
    t.same([...TASK_NAMES].sort(), ['answer', 'ask', 'assist', 'catchUp', 'chat', 'followUp']);
    t.end();
});

t.test('taskText(ask) is the built-in ask text, and an override saved under a removed key has no effect', t => {
    t.equal(taskText('ask', {}), ASK_TASK);
    const removed = { tasks: { recap: 'Invented text.', clarify: 'Invented text.', whatToAnswer: 'Invented text.' } } as never;
    for (const task of TASKS) {
        t.equal(taskText(task, removed), TASK_TEXT[task], `${task}: unchanged by a removed key`);
    }
    t.end();
});

t.test('no override gives the text of the commit before the setting, byte for byte where the text is unchanged', t => {
    for (const task of TASKS) {
        const prompt = taskPrompt(task, {});
        t.equal(prompt, `${ROLE_PROMPT}\n\n${BUILT_IN[task]}\n\n${CORE_RULES}`, `${task}: role, its own text, the rules`);
        const before = PRE_SETTING_SHA256[task];
        if (before) t.equal(createHash('sha256').update(prompt).digest('hex'), before, `${task}: unchanged bytes`);
        t.equal(taskText(task, {}), BUILT_IN[task], `${task}: the built-in task text`);
    }
    t.equal(rolePrompt({}), ROLE_PROMPT, 'the built-in role');
    t.end();
});

t.test('a role override replaces only the role', t => {
    for (const task of TASKS) {
        t.equal(
            taskPrompt(task, { role: 'Invented role line.' }),
            `Invented role line.\n\n${BUILT_IN[task]}\n\n${CORE_RULES}`,
            `${task}: the edited role goes in front, nothing else moves`
        );
    }
    t.equal(rolePrompt({ role: 'Invented role line.' }), 'Invented role line.');
    t.equal(taskText('answer', { role: 'Invented role line.' }), ANSWER_TASK, 'a role override leaves the task text alone');
    t.end();
});

t.test('a task override replaces only that task text', t => {
    const overrides = { tasks: { catchUp: 'Invented catch up text.' } };
    t.equal(taskPrompt('catchUp', overrides), `${ROLE_PROMPT}\n\nInvented catch up text.\n\n${CORE_RULES}`);
    t.equal(taskText('catchUp', overrides), 'Invented catch up text.');
    for (const task of TASKS.filter(name => name !== 'catchUp')) {
        t.equal(taskPrompt(task, overrides), `${ROLE_PROMPT}\n\n${BUILT_IN[task]}\n\n${CORE_RULES}`, `${task}: untouched`);
    }
    t.end();
});

t.test('a role override and a task override are used together', t => {
    const overrides = { role: 'Invented role line.', tasks: { chat: 'Invented chat text.' } };
    t.equal(taskPrompt('chat', overrides), `Invented role line.\n\nInvented chat text.\n\n${CORE_RULES}`);
    t.equal(systemPrompt(overrides), taskPrompt('chat', overrides), 'the system prompt is the chat task');
    t.end();
});

t.test('whitespace-only and empty text are no override', t => {
    for (const blank of ['', '   ', '\n\t ']) {
        t.equal(rolePrompt({ role: blank }), ROLE_PROMPT, `role ${JSON.stringify(blank)} is the built-in role`);
        t.equal(taskText('ask', { tasks: { ask: blank } }), ASK_TASK, `task ${JSON.stringify(blank)} is the built-in text`);
        t.equal(taskPrompt('ask', { role: blank, tasks: { ask: blank } }), `${ROLE_PROMPT}\n\n${ASK_TASK}\n\n${CORE_RULES}`);
    }
    t.end();
});

t.test('the fixed rules are always last and no override removes them', t => {
    for (const task of TASKS) {
        const prompt = taskPrompt(task, { role: 'Invented role line.', tasks: { [task]: 'Invented task text.' } });
        t.ok(prompt.endsWith(CORE_RULES), `${task}: the rules end the prompt`);
        t.equal(prompt.match(/RULES THAT ALWAYS APPLY/g)?.length, 1, `${task}: the rules appear once`);
    }
    const attempt = taskPrompt('chat', { role: CORE_RULES, tasks: { chat: '' } });
    t.ok(attempt.endsWith(CORE_RULES), 'a role that repeats the rules cannot replace them');
    t.equal(CRULES_COUNT(attempt), 2, 'the rules appear as the role and as the fixed last block');
    t.end();
});

function CRULES_COUNT(prompt: string): number {
    return prompt.match(/RULES THAT ALWAYS APPLY/g)?.length ?? 0;
}
