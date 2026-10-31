import React, { useState } from 'react';
import { ChevronRight, RotateCcw } from 'lucide-react';
import { useShortcuts } from '../../hooks/useShortcuts';
import { KeyRecorder } from '../ui/KeyRecorder';
import { secondaryButton } from './buttonStyles';

/**
 * The "Shortcuts" tab: its state and handlers run in the settings overlay's own render
 * (the shell calls the hook unconditionally, in the same order every time); below only draws them.
 */

export function useShortcutsSettings() {
    const [showMoreShortcuts, setShowMoreShortcuts] = useState<boolean>(false);
    const { shortcuts, updateShortcut, resetShortcuts } = useShortcuts();

    return { shortcuts, updateShortcut, resetShortcuts, showMoreShortcuts, setShowMoreShortcuts };
}

export function renderShortcutsSettings(state: ReturnType<typeof useShortcutsSettings>) {
    const { shortcuts, updateShortcut, resetShortcuts, showMoreShortcuts, setShowMoreShortcuts } = state;

    return (
        <div className="space-y-3 animated fadeIn select-text pb-4">
            <div className="flex items-start justify-between gap-4">
                <div className="max-w-2xl">
                    <h3 className="text-lg font-bold text-text-primary mb-1">Shortcuts</h3>
                    <p className="text-xs text-text-secondary leading-relaxed">Customize how you trigger Pika.</p>
                </div>
                <button
                    onClick={resetShortcuts}
                    className={`${secondaryButton} flex items-center gap-2 whitespace-nowrap mt-1`}
                >
                    <RotateCcw size={13} strokeWidth={2.5} />
                    Restore defaults
                </button>
            </div>

            <div className="bg-bg-card border border-border-subtle rounded-2xl p-4 md:p-5">
                {([
                    { id: 'toggleVisibility', label: 'Show or hide Pika' },
                    { id: 'toggleMousePassthrough', label: 'Toggle click-through' },
                    { id: 'whatToAnswer', label: 'What to say' },
                    { id: 'selectiveScreenshot', label: 'Capture Selected Area' },
                    { id: 'toggleTranslation', label: 'Turn translation on or off' },
                    { id: 'resetCancel', label: 'Stop generation' },
                ] as const).map((item) => (
                    <div key={item.id} className="grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-1 py-2 border-b border-border-subtle last:border-b-0">
                        <span className="text-sm text-text-secondary">{item.label}</span>
                        <KeyRecorder
                            actionId={item.id}
                            label={item.label}
                            currentKeys={shortcuts[item.id]}
                            onSave={(keys) => updateShortcut(item.id, keys)}
                        />
                    </div>
                ))}
            </div>

            <div className="bg-bg-card border border-border-subtle rounded-2xl p-4 md:p-5">
                <button
                    onClick={() => setShowMoreShortcuts(!showMoreShortcuts)}
                    className="w-full flex items-center justify-between text-left text-sm text-text-secondary hover:text-text-primary transition-colors"
                >
                    <span className="flex items-center gap-2">
                        <ChevronRight size={15} className={`transition-transform ${showMoreShortcuts ? 'rotate-90' : ''}`} />
                        More shortcuts
                    </span>
                    <span className="px-2 py-0.5 rounded-full bg-bg-subtle text-[11px] text-text-tertiary font-medium">5</span>
                </button>

                {showMoreShortcuts && (
                    <div className="mt-4">
                        {([
                            { id: 'toggleOriginal', label: 'Show or hide the original text' },
                            { id: 'moveWindowUp', label: 'Move window up' },
                            { id: 'moveWindowDown', label: 'Move window down' },
                            { id: 'moveWindowLeft', label: 'Move window left' },
                            { id: 'moveWindowRight', label: 'Move window right' },
                        ] as const).map((item) => (
                            <div key={item.id} className="grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-1 py-2 border-b border-border-subtle last:border-b-0">
                                <span className="text-sm text-text-secondary">{item.label}</span>
                                <KeyRecorder
                                    actionId={item.id}
                                    label={item.label}
                                    currentKeys={shortcuts[item.id]}
                                    onSave={(keys) => updateShortcut(item.id, keys)}
                                />
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}
