import { test } from 'tap';
import {
  buildOpenAICompatibleModelOption,
  getFriendlyModelDisplayName,
} from '../src/utils/modelUtils';

test('OpenAI-compatible provider options display provider name and preferred model, not raw id', (t) => {
  const provider = {
    id: '45fc9792-9e26-4a54-9999-aaaaaaaaaaaa',
    name: 'OmniRoute',
    preferredModel: 'openai/gpt-4o-mini',
  };

  const option = buildOpenAICompatibleModelOption(provider);

  t.equal(option.id, provider.id, 'selection still uses provider id');
  t.equal(option.name, 'OmniRoute • Openai/Gpt 4o Mini');
  t.equal(option.description, 'OpenAI-compatible • openai/gpt-4o-mini');
  t.notMatch(option.name, /45fc9792|9e26|4a54/);
  t.end();
});

test('friendly model display resolves OpenAI-compatible provider ids', (t) => {
  const providers = [
    { id: '45fc9792-9e26-4a54-9999-aaaaaaaaaaaa', name: 'OmniRoute', preferredModel: 'claude-sonnet-4-6' },
  ];

  t.equal(
    getFriendlyModelDisplayName('45fc9792-9e26-4a54-9999-aaaaaaaaaaaa', providers),
    'OmniRoute • Claude Sonnet 4 6'
  );
  t.equal(getFriendlyModelDisplayName('gemini-3.1-flash-lite-preview', providers), 'Gemini 3.1 Flash');
  t.end();
});
