import t from 'tap';
import { sanitizeChatError } from '../src/utils/chatErrorUtils';

t.test('sanitizeChatError removes raw provider html and keeps useful status', (t) => {
  const message = sanitizeChatError('OpenAI-compatible provider OmniRoute failed (500): <html><head><title>500 Internal Server Error</title></head><body><center><h1>500 Internal Server Error</h1></center><hr><center>nginx/1.24.0 (Ubuntu)</center></body></html>');

  t.equal(message, 'OpenAI-compatible provider OmniRoute failed (500). Provider server error. Try again, switch models, or check the provider status.');
  t.notMatch(message, /<html|<body|nginx/i);
  t.end();
});

t.test('sanitizeChatError keeps plain non-html errors readable', (t) => {
  t.equal(sanitizeChatError(new Error('Network timeout')), 'Network timeout');
  t.end();
});
