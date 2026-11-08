import { useState } from 'react';
import { primaryButton, secondaryButton } from './buttonStyles';
import { FIRST_ENABLE_POINTS, FIRST_ENABLE_TITLE } from '../../lib/interpretingSettingsUi';

/** The notice shown when Interpreting is turned on for the first time. Cancel leaves it off. */
const InterpretingNoticeDialog = ({ onConfirm, onCancel }: { onConfirm: () => void; onCancel: () => void }) => {
    const [understood, setUnderstood] = useState(false);
    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
            <div role="dialog" aria-modal="true" aria-labelledby="interpreting-notice-title" className="w-full max-w-md rounded-xl border border-border-subtle bg-bg-elevated p-5">
                <h3 id="interpreting-notice-title" className="mb-3 text-lg font-bold text-text-primary">{FIRST_ENABLE_TITLE}</h3>
                <ul className="mb-4 list-disc space-y-2 pl-5 text-sm text-text-secondary">
                    {FIRST_ENABLE_POINTS.map((point) => <li key={point}>{point}</li>)}
                </ul>
                <label className="mb-4 flex items-center gap-2 text-sm text-text-primary">
                    <input type="checkbox" checked={understood} onChange={(event) => setUnderstood(event.target.checked)} />
                    I understand.
                </label>
                <div className="flex justify-end gap-2">
                    <button type="button" onClick={onCancel} className={secondaryButton}>Cancel</button>
                    <button type="button" disabled={!understood} onClick={onConfirm} className={primaryButton}>Turn on</button>
                </div>
            </div>
        </div>
    );
};

export default InterpretingNoticeDialog;
