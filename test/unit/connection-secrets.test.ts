import t from 'tap';
import { redactConnectionError } from '../../electron/services/connectionSecrets';

t.test('secrets are replaced in the message and everything non-secret that callers read is kept', async t => {
    const secrets = { apiKey: 'invented-key-123', headers: { 'X-Gateway': 'invented-header-value' } };
    const failure = Object.assign(new Error('Bad request with invented-key-123 and invented-header-value'), { status: 401, request: { secret: 'invented-key-123' } });
    const safe = redactConnectionError(failure, secrets);
    t.equal(safe.message, 'Bad request with [redacted] and [redacted]');
    t.equal(safe.status, 401);
    t.notOk('request' in safe, 'SDK request objects are dropped');
});

t.test('a failure without secrets passes its message through, and odd inputs still produce an Error', async t => {
    t.equal(redactConnectionError(new Error('plain')).message, 'plain');
    t.equal(redactConnectionError(new Error('plain'), {}).message, 'plain');
    t.equal(redactConnectionError('boom').message, 'boom');
    t.equal(redactConnectionError(null).message, 'null');
    t.equal(redactConnectionError({ message: 42 }).message, '[object Object]');
});

t.test('the status comes from status, statusCode or response.status and only when it is a positive number', async t => {
    t.equal(redactConnectionError({ message: 'x', statusCode: 429 }).status, 429);
    t.equal(redactConnectionError({ message: 'x', response: { status: 503 } }).status, 503);
    t.equal(redactConnectionError({ message: 'x', status: 0 }).status, undefined);
    t.equal(redactConnectionError({ message: 'x', status: -1 }).status, undefined);
    t.equal(redactConnectionError({ message: 'x', status: 'nope' }).status, undefined);
    t.equal(redactConnectionError({ message: 'x' }).status, undefined);
});

t.test('only abort and timeout names and known network codes survive', async t => {
    t.equal(redactConnectionError({ message: 'x', name: 'AbortError' }).name, 'AbortError');
    t.equal(redactConnectionError({ message: 'x', name: 'TimeoutError' }).name, 'TimeoutError');
    t.equal(redactConnectionError({ message: 'x', name: 'SecretLeakError' }).name, 'Error');
    t.equal(redactConnectionError({ message: 'x', code: 'ECONNRESET' }).code, 'ECONNRESET');
    t.equal(redactConnectionError({ message: 'x', code: 'EACCES' }).code, undefined);
    t.equal(redactConnectionError({ message: 'x', code: 500 }).code, undefined);
});

t.test('trimmed, JSON-escaped and URL-encoded copies of a secret are redacted, longest first', async t => {
    const value = 'tok"en with space';
    const message = `raw ${value} json ${JSON.stringify(value).slice(1, -1)} url ${encodeURIComponent(value)}`;
    t.notMatch(redactConnectionError(new Error(message), { apiKey: ` ${value} ` }).message, /tok/);
    t.equal(redactConnectionError(new Error('abc and abcdef'), { apiKey: 'abc', headers: { 'X-Long': 'abcdef' } }).message, '[redacted] and [redacted]');
});
