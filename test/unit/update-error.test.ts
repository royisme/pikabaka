import t from 'tap';
import { describeUpdateError } from '../../src/lib/updateError';

t.test('a lost connection reads as a sentence and keeps the real first line', async t => {
    const raw = 'net::ERR_INTERNET_DISCONNECTED\n    at SimpleURLLoaderWrapper.<anonymous> (node:electron/js2c/browser_init)';
    const { summary, detail } = describeUpdateError(raw);
    t.equal(summary, 'No connection. Check your network and try again.');
    t.equal(detail, 'net::ERR_INTERNET_DISCONNECTED');
});

t.test('a release without a feed file says the files are not published yet', async t => {
    const raw = 'Cannot find latest-mac.yml in the latest release artifacts (https://github.com/example/app/releases/download/v9.9.9/latest-mac.yml): HttpError: 404\n Headers: {"server":"example"}';
    const { summary, detail } = describeUpdateError(raw);
    t.equal(summary, 'This release has no update files yet. Try again in a few minutes.');
    t.match(detail, /^Cannot find latest-mac\.yml/);
    t.notMatch(detail, /Headers/);
});

t.test('rate limits, server errors, bad checksums and a full disk each get their own sentence', async t => {
    t.match(describeUpdateError('HttpError: 403 rate limit exceeded').summary, /limiting requests/);
    t.match(describeUpdateError('HttpError: 503 Service Unavailable').summary, /having problems/);
    t.match(describeUpdateError('sha512 checksum mismatch, expected a, got b').summary, /failed verification/);
    t.match(describeUpdateError('ENOSPC: no space left on device, write').summary, /disk space/);
});

t.test('an unknown failure still shows its own message', async t => {
    const { summary, detail } = describeUpdateError('something odd happened');
    t.equal(summary, 'The update could not be completed.');
    t.equal(detail, 'something odd happened');
});
