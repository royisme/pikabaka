import type { InterpretingState } from '../../electron/interpreting/InterpretingSession';

const LABELS: Record<Exclude<InterpretingState['phase'], 'off'>, string> = {
    idle: 'Talk',
    listening: '● Listening',
    translating: 'Translating',
    voicing: 'Voicing',
    speaking: 'Speaking',
    error: '▲ Failed',
};

/** The words on the overlay's Talk control for a phase. The word, plus ▲ on error, carries the meaning, not colour. */
export function interpretingLabel(state: InterpretingState): string {
    return state.phase === 'off' ? LABELS.idle : LABELS[state.phase];
}

/** The tooltip: the real error when there is one, otherwise what a press does. */
export function interpretingTitle(state: InterpretingState, shortcut: string): string {
    if (state.phase === 'error' && state.error) return state.error;
    const hint = shortcut ? ` · ${shortcut}` : '';
    return state.phase === 'listening' ? `Press again to send${hint}` : `Talk${hint}`;
}
