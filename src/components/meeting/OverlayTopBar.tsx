import React, { useEffect, useState } from 'react';
import { ChevronUp, Languages, MoreHorizontal, Type } from 'lucide-react';
import PopoverMenu, { type PopoverMenuItem } from '../ui/PopoverMenu';
import { KeyBadge } from '../ui/KeyBadge';
import type { AudioStatus } from '../../lib/audioStatus';
import type { TranscriptDisplayMode } from '../../lib/transcriptSegments';
import { shortLanguageLabel } from '../../lib/languageLabel';

interface OverlayTopBarProps {
    status: AudioStatus;
    /** True when the transcript area shows rows: then the chip carries the status words; otherwise the area's own line does. */
    hasRows: boolean;
    onFixAudio: () => void;
    displayMode: TranscriptDisplayMode;
    translationEnabled: boolean;
    translationConfigured: boolean;
    targetLanguage: string;
    languageOptions: Array<{ value: string; label: string }>;
    onToggleTranslation: () => void;
    onChangeTargetLanguage: (value: string) => void;
    onToggleOriginal: () => void;
    onSetUpTranslation: () => void;
    modelName: string;
    isMousePassthrough: boolean;
    toggleOriginalKeys: string[];
    toggleTranslationKeys: string[];
    onHide: () => void;
    onQuit: () => void;
    onOpenModelSelector: (triggerRect: DOMRect) => void;
    onOpenSettings: (triggerRect: DOMRect) => void;
    onToggleMousePassthrough: () => void;
    onOpenLauncher: () => void;
}

const DOT_CLASS: Record<AudioStatus['dot'], string> = {
    neutral: 'bg-current opacity-50',
    success: 'bg-state-success',
    warn: 'bg-state-warning',
    danger: 'bg-state-danger',
};

const barButton =
    'inline-flex h-7 items-center justify-center gap-1 rounded-full border overlay-hairline px-2 text-[11px] font-medium overlay-text-secondary hover:text-text-primary aria-pressed:overlay-text-primary aria-pressed:bg-white/10';
const iconButton = 'inline-flex h-7 w-7 items-center justify-center rounded-full overlay-icon-surface overlay-text-primary interaction-base interaction-press';

/**
 * The overlay's one bar: audio status on the left, translation controls and window controls on the
 * right. From 480px up Translate and Original are buttons; below it they live in the menu, so no
 * control is ever cut off. It replaces the floating pill and both zone headers.
 */
const OverlayTopBar: React.FC<OverlayTopBarProps> = ({
    status,
    hasRows,
    onFixAudio,
    displayMode,
    translationEnabled,
    translationConfigured,
    targetLanguage,
    languageOptions,
    onToggleTranslation,
    onChangeTargetLanguage,
    onToggleOriginal,
    onSetUpTranslation,
    modelName,
    isMousePassthrough,
    toggleOriginalKeys,
    toggleTranslationKeys,
    onHide,
    onQuit,
    onOpenModelSelector,
    onOpenSettings,
    onToggleMousePassthrough,
    onOpenLauncher,
}) => {
    // Stop sits next to Hide mid-call: the first press arms it, a second within 3 seconds quits.
    const [confirmingQuit, setConfirmingQuit] = useState(false);
    useEffect(() => {
        if (!confirmingQuit) return;
        const timer = window.setTimeout(() => setConfirmingQuit(false), 3000);
        return () => window.clearTimeout(timer);
    }, [confirmingQuit]);

    const languageLabel = languageOptions.find((option) => option.value === targetLanguage)?.label;
    const languageItems: PopoverMenuItem[] = languageOptions.map((option) => ({
        key: option.value,
        label: option.label,
        role: 'menuitemradio',
        checked: option.value === targetLanguage,
        onSelect: () => onChangeTargetLanguage(option.value),
    }));

    const menuItems: PopoverMenuItem[] = [
        ...(hasRows && status.action === 'fix-audio'
            ? [{ key: 'fix', label: 'Fix audio', onSelect: onFixAudio, className: 'min-[480px]:hidden' } satisfies PopoverMenuItem]
            : []),
        ...(translationConfigured
            ? [
                  { key: 'translate', label: 'Translate', role: 'menuitemcheckbox', checked: translationEnabled, hint: toggleTranslationKeys.length > 0 ? <KeyBadge keys={toggleTranslationKeys} /> : undefined, onSelect: onToggleTranslation, className: 'min-[480px]:hidden' } satisfies PopoverMenuItem,
                  { key: 'original', label: 'Show original', role: 'menuitemcheckbox', checked: displayMode === 'both', hint: toggleOriginalKeys.length > 0 ? <KeyBadge keys={toggleOriginalKeys} /> : undefined, onSelect: onToggleOriginal, className: 'min-[480px]:hidden' } satisfies PopoverMenuItem,
              ]
            : []),
        { key: 'model', label: `Model: ${modelName}`, onSelect: onOpenModelSelector, separatorBefore: true },
        { key: 'settings', label: 'Settings', onSelect: onOpenSettings },
        { key: 'passthrough', label: 'Click-through', role: 'menuitemcheckbox', checked: isMousePassthrough, onSelect: onToggleMousePassthrough },
        { key: 'launcher', label: 'Open Pika window', onSelect: onOpenLauncher, separatorBefore: true },
    ];

    return (
        <div className="draggable-area relative z-40 flex h-9 shrink-0 select-none items-center gap-1.5 border-b overlay-hairline px-2 min-[480px]:px-3">
            <span role="status" className="inline-flex min-w-0 items-center gap-1.5" title={status.chip}>
                <span aria-hidden="true" className={`h-1.5 w-1.5 shrink-0 rounded-full ${DOT_CLASS[status.dot]}`} />
                {hasRows ? (
                    <>
                        {status.level === 'warn' && <span aria-hidden="true" className="text-[11px]">▲</span>}
                        {status.level === 'blocking' && <span aria-hidden="true" className="text-[11px]">✕</span>}
                        <span className="hidden truncate text-[11px] font-medium overlay-text-secondary min-[480px]:inline">{status.chip}</span>
                        <span className="truncate text-[11px] font-medium overlay-text-secondary min-[480px]:hidden">{status.chipShort}</span>
                    </>
                ) : (
                    <span className="sr-only">{status.chip}</span>
                )}
            </span>
            {hasRows && status.action === 'fix-audio' && (
                <button type="button" onClick={onFixAudio} className={`no-drag hidden min-[480px]:inline-flex ${barButton}`}>
                    Fix audio
                </button>
            )}

            <div className="ml-auto flex items-center gap-1.5">
                {translationConfigured ? (
                    <>
                        <button
                            type="button"
                            aria-pressed={translationEnabled}
                            aria-label="Translate"
                            title="Translate"
                            onClick={onToggleTranslation}
                            className={`no-drag hidden min-[480px]:inline-flex ${barButton}`}
                        >
                            <Languages className="h-3 w-3" aria-hidden="true" />
                            <span>Translate</span>
                        </button>
                        <PopoverMenu
                            label="Translate into"
                            trigger={<span>→ {shortLanguageLabel(targetLanguage, languageLabel)} ▾</span>}
                            triggerClassName={`no-drag ${barButton}`}
                            items={languageItems}
                        />
                        <button
                            type="button"
                            aria-pressed={displayMode === 'both'}
                            aria-label="Show original"
                            title="Show original"
                            onClick={onToggleOriginal}
                            className={`no-drag hidden min-[480px]:inline-flex ${barButton}`}
                        >
                            <Type className="h-3 w-3" aria-hidden="true" />
                            <span>Original</span>
                        </button>
                    </>
                ) : (
                    <button type="button" onClick={onSetUpTranslation} className={`no-drag ${barButton}`}>
                        Set up translation
                    </button>
                )}
                <PopoverMenu
                    label="More"
                    trigger={<MoreHorizontal className="h-4 w-4" aria-hidden="true" />}
                    triggerClassName={`no-drag ${iconButton}`}
                    items={menuItems}
                />
                <button type="button" aria-label="Hide" title="Hide" onClick={onHide} className={`no-drag ${iconButton}`}>
                    <ChevronUp className="h-4 w-4" aria-hidden="true" />
                </button>
                <button
                    type="button"
                    aria-label={confirmingQuit ? 'Press again to stop and quit' : 'Stop and quit'}
                    title={confirmingQuit ? 'Press again to stop and quit' : 'Stop and quit'}
                    onClick={() => (confirmingQuit ? onQuit() : setConfirmingQuit(true))}
                    className={`no-drag ${iconButton} hover:bg-state-danger-soft hover:text-state-danger ${confirmingQuit ? 'bg-state-danger-soft text-state-danger' : ''}`}
                >
                    <span className="h-3 w-3 rounded-[3px] bg-current opacity-80" aria-hidden="true" />
                </button>
            </div>
        </div>
    );
};

export default OverlayTopBar;
