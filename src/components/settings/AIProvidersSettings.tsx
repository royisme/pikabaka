import ModelUsesSettings from './ModelUsesSettings';
import WorkspaceSettings from './WorkspaceSettings';
import ProactiveHelpSettings from './ProactiveHelpSettings';

export const AIProvidersSettings = ({ onOpenProviders }: { onOpenProviders: () => void }) => (
    <div className="space-y-5 animated fadeIn pb-10">
        <p className="text-xs text-text-secondary">
            Connections and keys are in <button type="button" onClick={onOpenProviders} className="text-primary hover:underline">Provider setup</button>.
        </p>
        <section className="space-y-5">
            <h3 className="text-sm font-bold text-text-primary">Where models are used</h3>
            <ModelUsesSettings job="chat" />
            <ModelUsesSettings job="summary" />
            <ModelUsesSettings job="agent" />
            <WorkspaceSettings />
            <p className="text-xs text-text-secondary">The search index is under Knowledge.</p>
        </section>
        <ProactiveHelpSettings />
    </div>
);
