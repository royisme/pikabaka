import React, { useId, useState } from 'react';
import { useQuery } from 'react-query';
import { SHORTCUT_IDS, type ShortcutConfig } from '../../hooks/useShortcuts';
import type { KeybindStatus } from '../../types/electron';

interface KeyRecorderProps {
    actionId: keyof ShortcutConfig;
    label: string;
    currentKeys: string[];
    onSave: (keys: string[]) => Promise<{ success: boolean; error?: string }>;
    className?: string;
}

export const KeyRecorder: React.FC<KeyRecorderProps> = ({ actionId, label, currentKeys, onSave, className }) => {
    // The parent owns fetching and events; each row only observes the shared list.
    const { data: keybinds = [] } = useQuery<KeybindStatus[]>(['keybinds'], { enabled: false });
    const registered = keybinds.find(kb => kb.id === SHORTCUT_IDS[actionId])?.registered;
    const [isRecording, setIsRecording] = useState(false);
    const [error, setError] = useState<{ keys: string; message: string } | null>(null);
    const errorId = useId();
    const savedKeys = currentKeys.join('+');
    const message = (error?.keys === savedKeys ? error.message : '') ||
        (currentKeys.length > 0 && registered === false
            ? 'Not active: another app may be using this key combination'
            : '');

    const save = async (keys: string[]) => {
        setIsRecording(false);
        setError(null);
        try {
            const result = await onSave(keys);
            if (!result.success) setError({ keys: savedKeys, message: result.error || 'Could not save this shortcut' });
        } catch (error) {
            setError({ keys: savedKeys, message: error instanceof Error ? error.message : 'Could not save this shortcut' });
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (!isRecording) return;
        e.preventDefault();
        e.stopPropagation();
        if (e.key === 'Escape') {
            setIsRecording(false);
            return;
        }
        if (['Meta', 'Control', 'Alt', 'Shift'].includes(e.key)) return;

        const keys = [];
        if (e.metaKey) keys.push('⌘');
        if (e.ctrlKey) keys.push('⌃');
        if (e.altKey) keys.push('⌥');
        if (e.shiftKey) keys.push('⇧');
        keys.push(e.code === 'Space' ? 'Space' : e.key.length === 1 ? e.key.toUpperCase() : e.key);
        void save(keys);
    };

    return (
        <>
            <div className={`flex items-center justify-end gap-2 ${className || ''}`}>
                <button
                    type="button"
                    aria-label={`Change shortcut: ${label}`}
                    aria-describedby={message ? errorId : undefined}
                    onClick={() => { setError(null); setIsRecording(true); }}
                    onKeyDown={handleKeyDown}
                    onBlur={() => setIsRecording(false)}
                    className={`flex items-center gap-1 min-h-7 px-2 py-1 rounded-md border text-xs font-sans ${isRecording ? 'bg-bg-input border-accent-primary text-accent-primary' : 'bg-bg-input border-border-subtle text-text-secondary hover:border-text-tertiary'}`}
                >
                    {isRecording ? 'Press keys…' : currentKeys.length === 0 ? 'Not set' : currentKeys.map(key => ({ ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→' }[key] || key)).join(' + ')}
                </button>
                {currentKeys.length > 0 && (
                    <button type="button" aria-label={`Clear shortcut: ${label}`} onClick={() => void save([])} className="text-xs text-text-secondary hover:text-text-primary">
                        Clear
                    </button>
                )}
            </div>
            {message && <p id={errorId} role="status" className="col-span-2 text-xs text-state-danger-strong">✕ {message}</p>}
        </>
    );
};
