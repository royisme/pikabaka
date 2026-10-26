import t from 'tap';
import { classifyTranslationError } from '../electron/transcript/translationError';

t.test('classifies by status, code and message', async (t) => {
  t.equal(classifyTranslationError({ status: 401, message: 'x' }), 'auth');
  t.equal(classifyTranslationError({ response: { status: 403 } }), 'auth');
  t.equal(classifyTranslationError(new Error('Incorrect API key provided')), 'auth');
  t.equal(classifyTranslationError({ status: 429 }), 'rate-limit');
  t.equal(classifyTranslationError(new Error('Quota exceeded for this project')), 'rate-limit');
  t.equal(classifyTranslationError({ name: 'AbortError', message: 'The operation was aborted' }), 'timeout');
  t.equal(classifyTranslationError({ code: 'ETIMEDOUT' }), 'timeout');
  t.equal(classifyTranslationError(new Error('request timed out after 30000ms')), 'timeout');
  t.equal(classifyTranslationError(new TypeError('fetch failed')), 'network');
  t.equal(classifyTranslationError({ code: 'ECONNREFUSED' }), 'network');
});

t.test('anything else is "other", and never throws', async (t) => {
  t.equal(classifyTranslationError(new Error('model returned an empty body')), 'other');
  t.equal(classifyTranslationError(undefined), 'other');
  t.equal(classifyTranslationError(null), 'other');
  t.equal(classifyTranslationError('boom'), 'other');
  t.equal(classifyTranslationError(42), 'other');
});

t.test('auth wins over a message that also mentions a timeout', async (t) => {
  t.equal(classifyTranslationError({ status: 401, message: 'token timed out' }), 'auth');
});
