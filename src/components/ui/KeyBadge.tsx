import React from 'react';

interface KeyBadgeProps {
    keys: string[];
    className?: string;
    size?: 'sm' | 'md';
    /** The badge sits on the filled action colour: use light-on-dark values that keep 4.5:1. */
    onAction?: boolean;
}

const MODIFIERS_MAC = new Set(['⌘', '⌥', '⇧', '⌃']);
const MODIFIERS_WIN = new Set(['Ctrl', 'Alt', 'Shift']);

function isModifier(key: string): boolean {
    return MODIFIERS_MAC.has(key) || MODIFIERS_WIN.has(key);
}

export const KeyBadge: React.FC<KeyBadgeProps> = ({ keys, className = '', size = 'sm', onAction = false }) => {
    const textSize = size === 'sm' ? 'text-[11px]' : 'text-xs';
    const padModifier = size === 'sm' ? 'px-2 py-1' : 'px-2.5 py-1.5';
    const padKey = size === 'sm' ? 'px-1.5 py-1' : 'px-2 py-1.5';

    return (
        <div className={`flex gap-1 items-center ${className}`}>
            {keys.map((key, i) => {
                const mod = isModifier(key);
                const isTextModifier = MODIFIERS_WIN.has(key);

                return (
                    <span
                        key={`${key}-${i}`}
                        className={`
                            inline-flex items-center justify-center
                            rounded-md leading-none font-medium
                            transition-colors duration-150
                            ${textSize}
                            ${mod ? padModifier : padKey}
                            ${onAction
                                ? 'bg-white/20 text-white'
                                : 'overlay-control-surface overlay-text-secondary'
                            }
                            ${mod && isTextModifier ? 'min-w-[28px]' : ''}
                        `}
                    >
                        {key}
                    </span>
                );
            })}
        </div>
    );
};
