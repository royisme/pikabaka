import t from 'tap';
import { settingsModuleHost } from '../helpers/settingsModuleHost';
import { gateways } from '../helpers/translationSettingsHost';

function correctionHost(api: object = {}, credentials: Record<string, unknown> = {}) {
    const electronAPI = {
        getStoredCredentials: async () => ({ ...credentials }),
        aiConnectionsList: async () => gateways,
        aiConnectionModels: async () => ({ success: true, models: [{ id: 'invented-model', label: 'invented-model' }] }),
        openSettingsSection: () => {},
        ...api,
    };
    const host = settingsModuleHost('src/components/settings/CorrectionSettings.tsx', electronAPI, [
        [['speech-credentials'], { ...credentials }],
        [['ai-connections'], gateways],
    ]);
    host.render({});
    return host;
}

t.test('Fix misheard words is off by default and shows the saved connection and model', async t => {
    const off = correctionHost();
    t.teardown(off.unmount);
    t.match(off.html(), /<h3[^>]*>Fix misheard words<\/h3>/);
    t.match(off.html(), /aria-pressed="false"[^>]*>○ Off</);
    const saved = correctionHost({}, { transcriptCorrectionEnabled: true, transcriptCorrectionProvider: 'invented-gateway', transcriptCorrectionModel: 'invented-model' });
    t.teardown(saved.unmount);
    t.match(saved.html(), /aria-pressed="true"[^>]*>● On</);
    const picker = saved.component('ConnectionModelPicker');
    t.same([picker.props.connectionId, picker.props.model], ['invented-gateway', 'invented-model']);
});

t.test('Save sends exactly the three correction fields', async t => {
    const writes: unknown[] = [];
    const host = correctionHost({ setTranscriptCorrectionSettings: async (settings: unknown) => { writes.push(settings); return { success: true }; } });
    t.teardown(host.unmount);
    host.click('Fix misheard words');
    (host.component('ConnectionModelPicker').props.onChange as (next: { connectionId: string; model: string }) => void)({ connectionId: 'invented-other', model: 'invented-model-2' });
    host.click('Save Correction Settings');
    await host.settle();
    t.same(writes, [{ enabled: true, provider: 'invented-other', model: 'invented-model-2' }]);
    t.match(host.html(), '✓ Saved');
});

t.test('a failed Save shows the real error', async t => {
    const host = correctionHost({ setTranscriptCorrectionSettings: async () => ({ success: false, error: 'ENOSPC: invented disk full' }) });
    t.teardown(host.unmount);
    host.click('Save Correction Settings');
    await host.settle();
    t.match(host.html(), 'ENOSPC: invented disk full');
    t.notMatch(host.html(), '✓ Saved');
});
