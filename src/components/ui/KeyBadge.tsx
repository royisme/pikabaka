import React from 'react';
import { isMac } from '../../utils/platformUtils';

interface KeyBadgeProps {
    keys: string[];
    className?: string;
    size?: 'sm' | 'md';
}

const MODIFIERS_MAC = new Set(['⌘', '⌥', '⇧', '⌃']);
const MODIFIERS_WIN = new Set(['Ctrl', 'Alt', 'Shift']);

function isModifier(key: string): boolean {
    return MODIFIERS_MAC.has(key) || MODIFIERS_WIN.has(key);
}

export const KeyBadge: React.FC<KeyBadgeProps> = ({ keys, className = '', size = 'sm' }) => {
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
                            ${mod
                                ? isTextModifier
                                    ? 'bg-white/15 text-white/90 min-w-[28px] shadow-[0_1px_2px_rgba(0,0,0,0.3)]'
                                    : 'bg-white/10 text-white/80'
                                : 'bg-white/8 text-white/60'
                            }
                        `}
                    >
                        {key}
                    </span>
                );
            })}
        </div>
    );
};
