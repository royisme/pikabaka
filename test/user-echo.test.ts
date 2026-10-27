import t from 'tap';
import { userEchoMessage } from '../src/lib/userEcho';

const shot = { preview: 'data:image/png;base64,AAAA' };

t.test('a typed prompt is echoed as the user turn', async (t) => {
  t.same(userEchoMessage({ id: '1', promptText: 'why is the sky blue', echoPrompt: true, attachments: [] }), {
    id: '1',
    role: 'user',
    text: 'why is the sky blue',
    hasScreenshot: false,
    screenshotPreview: undefined,
  });
});

t.test('a typed prompt with a screenshot keeps both', async (t) => {
  const msg = userEchoMessage({ id: '2', promptText: 'what is this', echoPrompt: true, attachments: [shot, shot] });
  t.equal(msg?.text, 'what is this');
  t.equal(msg?.hasScreenshot, true);
  t.equal(msg?.screenshotPreview, shot.preview, 'first screenshot is the preview');
});

t.test('a quick action without a screenshot adds no user turn', async (t) => {
  t.equal(
    userEchoMessage({ id: '3', promptText: 'What should I say in response to the latest interviewer context?', echoPrompt: false, attachments: [] }),
    null
  );
});

t.test('a quick action with a screenshot shows the screenshot and not the synthetic prompt', async (t) => {
  const msg = userEchoMessage({ id: '4', promptText: 'What should I say about this?', echoPrompt: false, attachments: [shot] });
  t.equal(msg?.text, '');
  t.equal(msg?.hasScreenshot, true);
  t.equal(msg?.screenshotPreview, shot.preview);
});
