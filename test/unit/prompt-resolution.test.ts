import t from 'tap';
import { createHash } from 'node:crypto';
import {
    ANSWER_TASK,
    ASSIST_TASK,
    BRAINSTORM_TASK,
    CHAT_TASK,
    CLARIFY_TASK,
    CODE_HINT_TASK,
    CORE_RULES,
    FOLLOW_UP_QUESTIONS_TASK,
    FOLLOW_UP_TASK,
    RECAP_TASK,
    ROLE_PROMPT,
    TASK_NAMES,
    WHAT_TO_ANSWER_TASK,
    rolePrompt,
    systemPrompt,
    taskPrompt,
    taskText,
    type TaskName,
} from '../../electron/llm/prompts';

const BUILT_IN: Record<TaskName, string> = {
    answer: ANSWER_TASK,
    whatToAnswer: WHAT_TO_ANSWER_TASK,
    recap: RECAP_TASK,
    followUp: FOLLOW_UP_TASK,
    followUpQuestions: FOLLOW_UP_QUESTIONS_TASK,
    assist: ASSIST_TASK,
    clarify: CLARIFY_TASK,
    codeHint: CODE_HINT_TASK,
    brainstorm: BRAINSTORM_TASK,
    chat: CHAT_TASK,
};

const TASKS = Object.keys(BUILT_IN) as TaskName[];

/** The sha256 of `taskPrompt(task)` on the commit before the setting was added, one per task. */
const PRE_SETTING_SHA256: Record<TaskName, string> = {
    answer: 'be476d5d679e6a395874c81a718df748df4cf25195abcad5a406a2a85fc3db03',
    whatToAnswer: 'fa556ec3a8bb624da995c0db35f8ca190935d92822e51f2619d47a3d73d579d4',
    recap: '83ca2562eda711bd85a7a22833c9fa915118e9712cae4a7eb630c1ebe3a69645',
    followUp: 'f9788133cd76f9ce88e6e779d79ed0293dc767dbbe4860371819c3f4fe18e79f',
    followUpQuestions: '0edbeb3f072364101e1e2d5fa4a42aa9120fbca9f7560331565dc2836107ab63',
    assist: 'b6b3e2e62a8dc3eb3fb1e1fd50bd18d2b073171ceeb0ce316bbfbf8a4ae85f30',
    clarify: 'fe7cb3c2a789554fa6ce8f24c248898ca6c2dcb54aae722d74956bc36feff6f8',
    codeHint: '471302c49f57d85753d8cb95b13ba4ddb15c89fd269fbc3c00ef22290fd266bd',
    brainstorm: '43766df0cbf8cc296cd56cdd990b37b586043a401261fcbe0dd6cf359b2d60d3',
    chat: '3d814403692d494e7d4fc0e7376d6c48526b1619b278fd1d8c3d87e48d81d847',
};

t.test('the ten tasks are listed once, in the order the built-in text declares them', t => {
    t.same(TASK_NAMES, TASKS);
    t.end();
});

t.test('no override gives the text of the commit before the setting, byte for byte', t => {
    for (const task of TASKS) {
        const prompt = taskPrompt(task, {});
        t.equal(prompt, `${ROLE_PROMPT}\n\n${BUILT_IN[task]}\n\n${CORE_RULES}`, `${task}: role, its own text, the rules`);
        t.equal(createHash('sha256').update(prompt).digest('hex'), PRE_SETTING_SHA256[task], `${task}: unchanged bytes`);
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
    const overrides = { tasks: { recap: 'Invented recap text.' } };
    t.equal(taskPrompt('recap', overrides), `${ROLE_PROMPT}\n\nInvented recap text.\n\n${CORE_RULES}`);
    t.equal(taskText('recap', overrides), 'Invented recap text.');
    for (const task of TASKS.filter(name => name !== 'recap')) {
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
        t.equal(taskText('clarify', { tasks: { clarify: blank } }), CLARIFY_TASK, `task ${JSON.stringify(blank)} is the built-in text`);
        t.equal(taskPrompt('clarify', { role: blank, tasks: { clarify: blank } }), `${ROLE_PROMPT}\n\n${CLARIFY_TASK}\n\n${CORE_RULES}`);
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
