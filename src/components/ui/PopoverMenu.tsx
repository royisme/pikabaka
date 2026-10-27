import React, { useEffect, useRef, useState } from 'react';
import { useWindowEvent } from '../../hooks/useWindowEvent';

export interface PopoverMenuItem {
    key: string;
    label: React.ReactNode;
    /** Right-aligned secondary text, for example a shortcut. */
    hint?: React.ReactNode;
    checked?: boolean;
    /** `menuitemradio` and `menuitemcheckbox` announce their state through `checked`. */
    role?: 'menuitem' | 'menuitemradio' | 'menuitemcheckbox';
    /** Receives the trigger's rectangle, so a window the item opens can be placed under it. */
    onSelect: (triggerRect: DOMRect) => void;
    /** Extra classes, for example `min-[560px]:hidden` to show an item only in a narrow window. */
    className?: string;
    separatorBefore?: boolean;
}

interface PopoverMenuProps {
    /** Accessible name of the trigger button. */
    label: string;
    trigger: React.ReactNode;
    items: PopoverMenuItem[];
    triggerClassName?: string;
    align?: 'left' | 'right';
}

/**
 * A small menu that opens under its trigger inside the overlay (no portal: the overlay window is
 * the shell). Closes on Escape, on a click outside, and after a choice; Up and Down move between
 * items.
 */
const PopoverMenu: React.FC<PopoverMenuProps> = ({ label, trigger, items, triggerClassName = '', align = 'right' }) => {
    const [open, setOpen] = useState(false);
    const rootRef = useRef<HTMLDivElement>(null);
    const triggerRef = useRef<HTMLButtonElement>(null);
    const listRef = useRef<HTMLDivElement>(null);

    useWindowEvent(
        'mousedown',
        (event) => {
            if (!open) return;
            if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
        },
        'document'
    );

    useEffect(() => {
        if (open) visibleItems()[0]?.focus();
    }, [open]);

    // Items that a width breakpoint hides have no layout box; arrow keys must skip them.
    const visibleItems = () =>
        Array.from(listRef.current?.querySelectorAll<HTMLElement>('[role^="menuitem"]') ?? []).filter((item) => item.offsetParent !== null);

    const handleKeyDown = (event: React.KeyboardEvent) => {
        if (event.key === 'Escape') {
            event.stopPropagation();
            setOpen(false);
            triggerRef.current?.focus();
            return;
        }
        if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
        event.preventDefault();
        const entries = visibleItems();
        if (entries.length === 0) return;
        const at = entries.indexOf(document.activeElement as HTMLElement);
        const next = event.key === 'ArrowDown' ? (at + 1) % entries.length : (at - 1 + entries.length) % entries.length;
        entries[next].focus();
    };

    return (
        <div ref={rootRef} className="no-drag relative" onKeyDown={handleKeyDown}>
            <button
                ref={triggerRef}
                type="button"
                aria-label={label}
                aria-haspopup="menu"
                aria-expanded={open}
                onClick={() => setOpen((current) => !current)}
                className={triggerClassName}
            >
                {trigger}
            </button>
            {open && (
                <div
                    ref={listRef}
                    role="menu"
                    aria-label={label}
                    className={`absolute top-full z-50 mt-1 max-h-[60vh] min-w-[200px] overflow-y-auto rounded-xl border overlay-hairline bg-[var(--overlay-menu-bg)] p-1 shadow-lg ${align === 'right' ? 'right-0' : 'left-0'}`}
                >
                    {items.map((item, index) => (
                        <React.Fragment key={item.key}>
                            {item.separatorBefore && index > 0 && <div role="separator" className="my-1 h-px bg-current opacity-10" />}
                            <button
                                type="button"
                                role={item.role ?? 'menuitem'}
                                aria-checked={item.role && item.role !== 'menuitem' ? !!item.checked : undefined}
                                onClick={() => {
                                    const rect = triggerRef.current?.getBoundingClientRect() ?? new DOMRect();
                                    setOpen(false);
                                    item.onSelect(rect);
                                }}
                                className={`flex min-h-[32px] w-full items-center gap-2 rounded-lg px-2.5 text-left text-xs overlay-text-primary hover:bg-[var(--overlay-chip-hover-bg)] focus-visible:bg-[var(--overlay-chip-hover-bg)] ${item.className ?? ''}`}
                            >
                                <span aria-hidden="true" className="w-3 shrink-0 text-center">{item.checked ? '✓' : ''}</span>
                                <span className="min-w-0 flex-1 truncate">{item.label}</span>
                                {item.hint && <span className="shrink-0 overlay-text-muted">{item.hint}</span>}
                            </button>
                        </React.Fragment>
                    ))}
                </div>
            )}
        </div>
    );
};

export default PopoverMenu;
