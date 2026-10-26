import React from 'react';
import { Languages, Type } from 'lucide-react';
import type { TranscriptDisplayMode } from '../../lib/transcriptSegments';
import type { AudioStatus } from '../../lib/audioStatus';

interface TranscriptHeaderControlsProps {
    status: AudioStatus;
    /** True when the transcript area shows rows: then the chip carries the words; otherwise the area's own line does. */
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
}

const DOT_CLASS: Record<AudioStatus['dot'], string> = {
    neutral: 'bg-current opacity-50',
    success: 'bg-state-success',
    warn: 'bg-state-warning',
    danger: 'bg-state-danger',
};

const buttonClass =
    'inline-flex h-6 items-center gap-1 rounded-full border border-border-subtle px-2 text-[11px] font-medium normal-case tracking-normal overlay-text-secondary hover:text-text-primary aria-pressed:overlay-text-primary aria-pressed:bg-white/10';

/**
 * The transcript zone's controls. They sit in the header, not in Settings, because on a call
 * the questions are "is it working" and "do I need the original now". Below 480px the words
 * on the buttons drop out and the icons and accessible names remain.
 */
const TranscriptHeaderControls: React.FC<TranscriptHeaderControlsProps> = ({
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
}) => (
    <div className="no-drag ml-auto flex items-center gap-1.5">
        <span role="status" className="inline-flex items-center gap-1.5 normal-case tracking-normal" title={status.chip}>
            <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${DOT_CLASS[status.dot]}`} />
            {hasRows ? (
                <>
                    {status.level === 'warn' && <span aria-hidden="true" className="text-[11px]">▲</span>}
                    {status.level === 'blocking' && <span aria-hidden="true" className="text-[11px]">✕</span>}
                    <span className="hidden text-[11px] font-medium min-[480px]:inline">{status.chip}</span>
                    <span className="text-[11px] font-medium min-[480px]:hidden">{status.chipShort}</span>
                </>
            ) : (
                <span className="sr-only">{status.chip}</span>
            )}
        </span>
        {hasRows && status.action === 'fix-audio' && (
            <button type="button" onClick={onFixAudio} className={buttonClass}>
                Fix audio
            </button>
        )}
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
