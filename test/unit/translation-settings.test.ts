import t from 'tap';
import * as ReactQuery from 'react-query';
import { translationHost, translationTestHost } from '../helpers/translationSettingsHost';

const noop = () => {};
ReactQuery.setLogger({ log: noop, warn: noop, error: noop });
t.teardown(() => ReactQuery.setLogger(console));

const saved = {
    transcriptTranslationEnabled: true,
    transcriptTranslationProvider: 'invented-gateway',
    transcriptTranslationModel: 'invented-model',
    transcriptTranslationPrompt: 'Invented saved prompt.',
    transcriptTranslationDisplayMode: 'both',
    transcriptTranslationSourceLanguage: 'german',
    transcriptTranslationTargetLanguage: 'chinese',
};

t.test('Translation settings render the saved values with Advanced collapsed', async t => {
    const host = translationHost({}, saved);
    t.teardown(host.unmount);
    const html = host.html();
    t.match(html, /<h3[^>]*>Translation<\/h3>/);
    t.match(html, /aria-pressed="true"[^>]*>● On</);
    t.equal(host.control('select', 'translation-target-language').props.value, 'chinese');
    const picker = host.component('ConnectionModelPicker');
    t.same([picker.props.connectionId, picker.props.model], ['invented-gateway', 'invented-model'], 'the saved connection and model reach the picker');
    t.match(html, /Save Translation Settings/);
    t.match(html, /aria-expanded="false" aria-controls="translation-advanced"/);
    t.match(html, /id="translation-advanced" hidden=""/);
    t.equal(host.control('select', 'translation-source-language').props.value, 'german');
    t.equal(host.control('select', 'translation-display-mode').props.value, 'both');
    t.equal(host.control('textarea', 'translation-prompt').props.value, 'Invented saved prompt.');
    // The main fields come before Advanced; source, display mode and prompt follow it.
    t.ok(html.indexOf('translation-target-language') < html.indexOf('>Advanced</button>'));
    t.ok(html.indexOf('>Advanced</button>') < html.indexOf('translation-source-language'));
});

t.test('Advanced opens on request, keeps its values while collapsed, and segmentation saves on press', async t => {
    const profiles: string[] = [];
    const host = translationHost({
        setTranscriptAssemblerProfile: async (next: string) => { profiles.push(next); return { success: true }; },
    }, saved);
    t.teardown(host.unmount);
    t.match(host.html(), 'aria-expanded="false" aria-controls="translation-advanced"');
    host.click('Advanced');
    t.match(host.html(), 'aria-expanded="true" aria-controls="translation-advanced"');
    t.notMatch(host.html(), /id="translation-advanced" hidden/);
    host.change('select', 'translation-source-language', 'english-us');
    host.change('textarea', 'translation-prompt', 'Invented edited prompt.');
    host.click('Advanced');
    t.match(host.html(), /id="translation-advanced" hidden=""/);
    host.click('Advanced');
    t.equal(host.control('select', 'translation-source-language').props.value, 'english-us');
    t.equal(host.control('textarea', 'translation-prompt').props.value, 'Invented edited prompt.');
    t.equal(host.control('button', 'translation-segmentation-coherent').props['aria-pressed'], false);
    host.click('translation-segmentation-coherent');
    await host.settle();
    t.same(profiles, ['coherent']);
    t.equal(host.control('button', 'translation-segmentation-coherent').props['aria-pressed'], true);
});

t.test('Save sends exactly the seven existing fields, including the Advanced ones', async t => {
    const writes: unknown[] = [];
    const host = translationHost({
        setTranscriptTranslationSettings: async (settings: unknown) => { writes.push(settings); return { success: true }; },
    }, saved);
    t.teardown(host.unmount);
    host.click('Enable translation');
    host.change('select', 'translation-target-language', 'german');
    const picker = host.component('ConnectionModelPicker');
    (picker.props.onChange as (next: { connectionId: string; model: string }) => void)({ connectionId: 'invented-other', model: 'invented-model-2' });
    host.click('Advanced');
    host.change('select', 'translation-display-mode', 'translated');
    host.change('select', 'translation-source-language', 'english-us');
    host.change('textarea', 'translation-prompt', 'Invented changed prompt.');
    host.click('Save Translation Settings');
    await host.settle();
    t.same(writes, [{
        enabled: false,
        provider: 'invented-other',
        model: 'invented-model-2',
        prompt: 'Invented changed prompt.',
        displayMode: 'translated',
        sourceLanguage: 'english-us',
        targetLanguage: 'german',
    }]);
    t.match(host.html(), '✓ Saved');
});

t.test('a failed Save shows the real error and keeps the values on screen', async t => {
    const host = translationHost({
        setTranscriptTranslationSettings: async () => { throw new Error('Invented translation save rejection'); },
    }, saved);
    t.teardown(host.unmount);
    (host.component('ConnectionModelPicker').props.onChange as (next: { connectionId: string; model: string }) => void)({ connectionId: 'invented-gateway', model: 'invented-kept-model' });
    host.click('Save Translation Settings');
    await host.settle();
    t.match(host.html(), 'Invented translation save rejection');
    t.match(host.html(), /role="alert"/);
    t.notMatch(host.html(), '✓ Saved');
    t.equal(host.component('ConnectionModelPicker').props.model, 'invented-kept-model');
});

t.test('the translation Test sits collapsed and opens itself when its result arrives', async t => {
    const host = translationTestHost();
    t.teardown(host.unmount);
    let html = host.html();
    t.match(html, /aria-expanded="false" aria-controls="translation-test"/);
    t.match(html, /id="translation-test" hidden=""/);
    t.ok(html.indexOf('id="translation-test"') < html.indexOf('Test translation'));
    host.click('Test');
    host.click('Test translation');
    host.click('Test');
    t.match(host.html(), /id="translation-test" hidden=""/, 'collapsed again while the test runs');
    await host.settle();
    html = host.html();
    t.match(html, /aria-expanded="true" aria-controls="translation-test"/);
    t.notMatch(html, /id="translation-test" hidden/);
    t.match(html, 'Invented translation.');
});

t.test('a failed translation Test opens the disclosure with the real error', async t => {
    const host = translationTestHost({ testTranscriptTranslation: async () => { throw new Error('Invented translation test rejection'); } });
    t.teardown(host.unmount);
    host.click('Test translation');
    await host.settle();
    t.match(host.html(), /aria-expanded="true" aria-controls="translation-test"/);
    t.match(host.html(), '✕ Invented translation test rejection');
});
