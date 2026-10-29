import t from 'tap';
import { migrateLegacyLocalStorage } from '../../src/lib/legacyLocalStorage';

/** A localStorage stand-in: the migration only reads, writes and removes keys. */
function fakeStorage(initial: Record<string, string>) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => { data.set(key, value); },
    removeItem: (key: string) => { data.delete(key); },
    dump: () => Object.fromEntries(data),
  };
}

t.test('the pre-rename transcript key lands on pika_them_transcript', (t) => {
  const storage = fakeStorage({ pika_interviewer_transcript: 'hide' });
  migrateLegacyLocalStorage(storage);
  t.equal(storage.getItem('pika_them_transcript'), 'hide');
  t.equal(storage.getItem('pika_interviewer_transcript'), null, 'the old key is removed');
  t.end();
});

t.test('the natively transcript key also lands on pika_them_transcript', (t) => {
  const storage = fakeStorage({ natively_interviewer_transcript: 'show' });
  migrateLegacyLocalStorage(storage);
  t.equal(storage.getItem('pika_them_transcript'), 'show');
  t.equal(storage.getItem('natively_interviewer_transcript'), null);
  t.equal(storage.getItem('pika_interviewer_transcript'), null, 'no intermediate key is created');
  t.end();
});

t.test('an existing pika_them_transcript is not overwritten', (t) => {
  const storage = fakeStorage({ natively_interviewer_transcript: 'old', pika_them_transcript: 'saved' });
  migrateLegacyLocalStorage(storage);
  t.equal(storage.getItem('pika_them_transcript'), 'saved');

  const other = fakeStorage({ pika_interviewer_transcript: 'old', pika_them_transcript: 'saved' });
  migrateLegacyLocalStorage(other);
  t.equal(other.getItem('pika_them_transcript'), 'saved');
  t.end();
});
