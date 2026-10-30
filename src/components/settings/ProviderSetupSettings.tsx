import { useQuery } from '@tanstack/react-query';
import ConnectionsSettings from './ConnectionsSettings';
import SpeechProvidersSettings from './SpeechProvidersSettings';
import DecisionServiceSettings from './DecisionServiceSettings';

const ProviderSetupSettings = ({ onOpenModels }: { onOpenModels: () => void }) => {
    const { data: credentials } = useQuery({ queryKey: ['speech-credentials'], queryFn: () => window.electronAPI.getStoredCredentials() });
    const storage = credentials?.storage;
    return <div className="space-y-5 animated fadeIn pb-10">
        <div className="space-y-1">
            <h3 className="text-sm font-bold text-text-primary">Provider setup</h3>
            <p className="text-xs text-text-secondary">
                The services Pika connects to. Which model does which job is set under <button type="button" onClick={onOpenModels} className="text-primary hover:underline">Models &amp; Agent</button>.
            </p>
        </div>
        {storage && storage.mode !== 'encrypted' && <p role="status" className="text-xs text-text-primary break-words [overflow-wrap:anywhere]">
            {storage.mode === 'locked' ? '✕ Stored credentials are locked.' : '▲ Keys are stored in a plain local file.'} {storage.reason}
        </p>}
        <ConnectionsSettings />
        <SpeechProvidersSettings />
        <DecisionServiceSettings />
    </div>;
};

export default ProviderSetupSettings;
