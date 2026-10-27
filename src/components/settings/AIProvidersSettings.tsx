import ConnectionsSettings from './ConnectionsSettings';
import ModelUsesSettings from './ModelUsesSettings';
import SearchIndexSettings from './SearchIndexSettings';
import ProactiveHelpSettings from './ProactiveHelpSettings';

export const AIProvidersSettings = () => (
    <div className="space-y-5 animated fadeIn pb-10">
        <ConnectionsSettings />
        <section className="space-y-5">
            <h3 className="text-sm font-bold text-text-primary">Where models are used</h3>
            <ModelUsesSettings job="chat" />
            <ModelUsesSettings job="summary" />
            <ModelUsesSettings job="agent" />
        </section>
        <SearchIndexSettings />
        <ProactiveHelpSettings />
    </div>
);
