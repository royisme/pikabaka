import ConnectionsSettings from './ConnectionsSettings';
import SpeechProvidersSettings from './SpeechProvidersSettings';
import DecisionServiceSettings from './DecisionServiceSettings';

const ProviderSetupSettings = ({ onOpenModels }: { onOpenModels: () => void }) => (
    <div className="space-y-5 animated fadeIn pb-10">
        <div className="space-y-1">
            <h3 className="text-sm font-bold text-text-primary">Provider setup</h3>
            <p className="text-xs text-text-secondary">
                The services Pika connects to. Which model does which job is set under <button type="button" onClick={onOpenModels} className="text-primary hover:underline">Models &amp; Agent</button>.
            </p>
        </div>
        <ConnectionsSettings />
        <SpeechProvidersSettings />
        <DecisionServiceSettings />
    </div>
);

export default ProviderSetupSettings;
