import t from 'tap';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runAssist } from '../../electron/agent/assist';
import { appendCardOutcome, appendGateDecision, gateLogFile, readGateDecisions } from '../../electron/agent/gateLog';
import type { GateDecision } from '../../electron/agent/gate';
import type { AgentModel } from '../../electron/agent/models';

interface Captured { systemPrompt?: string; content?: string }

function fakeModel(reply: { stopReason?: string; text?: string; errorMessage?: string }, captured: Captured = {}): AgentModel {
    return {
        ref: { provider: 'invented', modelId: 'invented-model' },
        models: {
            getModel: () => ({ id: 'invented-model' }),
            completeSimple: async (_model: unknown, context: { systemPrompt: string; messages: { content: string }[] }) => {
                captured.systemPrompt = context.systemPrompt;
                captured.content = context.messages[0].content;
                return { stopReason: reply.stopReason ?? 'stop', errorMessage: reply.errorMessage, content: reply.text === undefined ? [] : [{ type: 'text', text: reply.text }] };
            },
        },
    } as unknown as AgentModel;
}

const input = {
    kind: 'answer_question' as const,
    lines: [
        { speaker: 'Them' as const, text: 'How would you ask   for the bill\nin this restaurant?' },
        { speaker: 'You' as const, text: 'Let me think.' },
    ],
    language: 'English',
    spokenLanguageKey: 'english-us',
    style: 'calm and polite',
    scenario: { brief: 'An invented weekly cooking class taught in Italian.', answerLanguage: 'Italian' },
};

t.test('the card prompt asks for the words to say, in the user\'s manner, without the interview block', async t => {
    const captured: Captured = {};
    const text = await runAssist(fakeModel({ text: 'Mi porta il conto, per favore?' }, captured), input, new AbortController().signal);
    t.equal(text, 'Mi porta il conto, per favore?');
    t.match(captured.content, /asked how the user would say or ask something/);
    t.match(captured.content, /Say it the way this speaker would: calm and polite\./);
    t.match(captured.content, /An invented weekly cooking class taught in Italian\./);
    t.match(captured.content, /Them: How would you ask for the bill in this restaurant\?\nYou: Let me think\./);
    t.notMatch(captured.content, /STAR|S ·|SPOKEN ANSWER/);
    t.notMatch(captured.systemPrompt, /STAR|never invent facts/i);
    t.match(captured.systemPrompt, /exact words to say next/);
    t.match(captured.systemPrompt, /bracketed placeholder/);
});

t.test('an empty style falls back to the default manner', async t => {
    const captured: Captured = {};
    await runAssist(fakeModel({ text: 'Yes.' }, captured), { ...input, style: '   ' }, new AbortController().signal);
    t.match(captured.content, /Say it the way this speaker would: plain, direct and conversational\./);
});

t.test('SKIP, an empty reply and a kind without a goal give no card', async t => {
    const signal = new AbortController().signal;
    t.equal(await runAssist(fakeModel({ text: 'skip' }), input, signal), undefined);
    t.equal(await runAssist(fakeModel({}), input, signal), undefined);
    t.equal(await runAssist(fakeModel({ text: 'Anything.' }), { ...input, kind: 'nothing' }, signal), undefined);
});

t.test('an aborted request gives no card and a failed request throws', async t => {
    const signal = new AbortController().signal;
    t.equal(await runAssist(fakeModel({ stopReason: 'aborted' }), input, signal), undefined);
    await t.rejects(runAssist(fakeModel({ stopReason: 'error', errorMessage: 'HTTP 429 rate limit' }), input, signal), /429/);
});

const decision = (segmentId: string, time: number): GateDecision => ({
    time, meetingId: 'meeting-1', segmentId, revision: 1, model: 'invented-decision-model', threshold: 0.7, cooldownSeconds: 30,
    help: 0.9, kind: 'answer_question', kindProbability: 0.8, latencyMs: 120, outcome: 'shown',
});

t.test('a card outcome is one id-and-number line that decision readers skip', async t => {
    const dir = await mkdtemp(path.join(tmpdir(), 'pika-gate-'));
    t.teardown(() => rm(dir, { recursive: true, force: true }));
    await mkdir(path.join(dir, 'agent'));
    appendGateDecision(dir, decision('seg-a', 1));
    appendCardOutcome(dir, { card: true, time: 2, meetingId: 'meeting-1', segmentId: 'seg-a', outcome: 'drafted', cardLatencyMs: 840 });
    appendGateDecision(dir, decision('seg-b', 3));
    appendCardOutcome(dir, { card: true, time: 4, meetingId: 'meeting-1', segmentId: 'seg-b', outcome: 'error:timeout', cardLatencyMs: 15_001 });

    const lines = (await readFile(gateLogFile(dir, 'meeting-1'), 'utf8')).trim().split('\n').map(line => JSON.parse(line) as Record<string, unknown>);
    t.equal(lines.length, 4);
    t.same(lines[1], { card: true, time: 2, meetingId: 'meeting-1', segmentId: 'seg-a', outcome: 'drafted', cardLatencyMs: 840 });

    const decisions = await readGateDecisions(dir, 'meeting-1', 50);
    t.same(decisions.map(entry => entry.segmentId), ['seg-b', 'seg-a']);
    t.ok(decisions.every(entry => entry.outcome === 'shown'));
    // The limit counts decisions, not card lines.
    t.same((await readGateDecisions(dir, 'meeting-1', 1)).map(entry => entry.segmentId), ['seg-b']);
});
