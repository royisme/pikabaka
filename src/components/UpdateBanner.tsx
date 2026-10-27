import React, { useState } from 'react';
import UpdateModal from './UpdateModal';
import { useMainEvent } from '../hooks/useMainEvent';
import { useWindowEvent } from '../hooks/useWindowEvent';

const UpdateBanner: React.FC = () => {
    const [updateInfo, setUpdateInfo] = useState<any>(null);
    const [parsedNotes, setParsedNotes] = useState<any>(null);
    const [isVisible, setIsVisible] = useState(false);
    const [status, setStatus] = useState<'idle' | 'ready'>('idle');

    // Listen for update available
    useMainEvent(window.electronAPI?.onUpdateAvailable, (info) => {
        setUpdateInfo(info);
        if (info?.parsedNotes) {
            setParsedNotes(info.parsedNotes);
        }
    });

    // Listen for update-downloaded event
    useMainEvent(window.electronAPI?.onUpdateDownloaded, (info) => {
        console.log('[UpdateBanner] Update downloaded:', info);
        setUpdateInfo((previous: any) => info ?? previous);
        if (info?.parsedNotes) setParsedNotes(info.parsedNotes);

        setStatus('ready');
        setIsVisible(true);
    });

    // Demo/Test mode: Press Cmd+I to trigger backend test-fetch or Cmd+J for UI mock
    useWindowEvent('keydown', (e: KeyboardEvent) => {
        if (!import.meta.env.DEV) return;

        if (e.metaKey && !e.shiftKey && e.key.toLowerCase() === 'i') {
            e.preventDefault();
            console.log("[UpdateBanner] Cmd+I pressed: Triggering Test Release Fetch...");
            window.electronAPI.testReleaseFetch().catch(console.error);
        }

        if (e.metaKey && !e.shiftKey && e.key.toLowerCase() === 'j') {
            e.preventDefault();
            console.log("[UpdateBanner] Cmd+J pressed: Triggering Update Ready UI mock...");
            setUpdateInfo({ version: '2.0.8' });
            setParsedNotes({ summary: 'Test Update', fullBody: 'Testing', sections: [{ title: 'Notes', items: ['UI Test'] }] });
            setStatus('ready');
            setIsVisible(true);
        }
    });

    const handleDismiss = () => {
        setIsVisible(false);
        setStatus('idle');
    };

    if (!isVisible) return null;

    return (
        <UpdateModal
            isOpen={isVisible}
            updateInfo={updateInfo}
            parsedNotes={parsedNotes}
            onDismiss={handleDismiss}
            status={status}
        />
    );
};

export default UpdateBanner;
