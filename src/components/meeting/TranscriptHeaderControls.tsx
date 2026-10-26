import React from 'react';
import { Languages, Type } from 'lucide-react';
import type { TranscriptDisplayMode } from '../../lib/transcriptSegments';

interface TranscriptHeaderControlsProps {
    sttStatus: { label: string; dotClass: string };
    displayMode: TranscriptDisplayMode;
    translationEnabled: boolean;
    translationConfigured: boolean;
    targetLanguage: string;
    languageOptions: Array<{ value: string; label: string }>;
    onToggleTranslation: () => void;
    onChangeTargetLanguage: (value: string) => void;
    onToggleOriginal: () => void;
    onSetUpTranslation: () => void;
}

const buttonClass =
    'inline-flex h-6 items-center gap-1 rounded-full border border-border-subtle px-2 text-[11px] font-medium normal-case tracking-normal overlay-text-secondary hover:text-text-primary aria-pressed:overlay-text-primary aria-pressed:bg-white/10';

/**
 * The transcript zone's controls. They sit in the header, not in Settings, because on a call
 * the questions are "is it working" and "do I need the original now". Below 480px the words
 * on the buttons drop out and the icons and accessible names remain.
 */
const TranscriptHeaderControls: React.FC<TranscriptHeaderControlsProps> = ({
    sttStatus,
    displayMode,
    translationEnabled,
    translationConfigured,
    targetLanguage,
    languageOptions,
    onToggleTranslation,
    onChangeTargetLanguage,
    onToggleOriginal,
    onSetUpTranslation,
}) => (
    <div className="no-drag ml-auto flex items-center gap-1.5">
        <span role="status" className="inline-flex items-center gap-1.5 normal-case tracking-normal" title={sttStatus.label}>
            <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${sttStatus.dotClass}`} />
            <span className="hidden text-[11px] font-medium min-[480px]:inline">{sttStatus.label}</span>
            <span className="sr-only">{sttStatus.label}</span>
        </span>
        {translationConfigured ? (
            <>
                <button
                    type="button"
                    aria-pressed={translationEnabled}
                    aria-label="Translate"
                    title="Translate"
                    onClick={onToggleTranslation}
                    className={buttonClass}
                >
                    <Languages className="h-3 w-3" aria-hidden="true" />
                    <span className="hidden min-[480px]:inline">Translate</span>
                </button>
                <select
                    aria-label="Translate into"
                    value={targetLanguage}
                    onChange={(event) => onChangeTargetLanguage(event.target.value)}
                    className="h-6 max-w-[110px] rounded-full border border-border-subtle bg-transparent px-2 text-[11px] font-medium normal-case tracking-normal overlay-text-secondary"
                >
                    {languageOptions.map((option) => (
                        <option key={option.value} value={option.value}>
                            {option.label}
                        </option>
                    ))}
                </select>
                <button
                    type="button"
                    aria-pressed={displayMode === 'both'}
                    aria-label="Show original"
                    title="Show original"
                    onClick={onToggleOriginal}
                    className={buttonClass}
                >
                    <Type className="h-3 w-3" aria-hidden="true" />
                    <span className="hidden min-[480px]:inline">Original</span>
                </button>
            </>
        ) : (
            <button type="button" onClick={onSetUpTranslation} className={buttonClass}>
                Set up translation
            </button>
        )}
    </div>
);

export default TranscriptHeaderControls;
