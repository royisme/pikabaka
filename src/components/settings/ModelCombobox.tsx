import React, { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

interface ModelComboboxProps {
    id?: string;
    value: string;
    options: string[];
    placeholder?: string;
    disabled?: boolean;
    onChange: (value: string) => void;
}

const MAX_LIST_HEIGHT = 240;
const EDGE = 12;

/**
 * A text field with a list of suggestions (a fetched model list can hold hundreds). Any text can be
 * typed; the list filters as you type, scrolls inside a fixed maximum height, and opens upward when
 * there is more room above the field than below, so it never runs off the window.
 */
const ModelCombobox: React.FC<ModelComboboxProps> = ({ id, value, options, placeholder, disabled, onChange }) => {
    const [open, setOpen] = useState(false);
    const [active, setActive] = useState(-1);
    const [place, setPlace] = useState<{ top: number; left: number; width: number; maxHeight: number; up: boolean } | null>(null);
    const fieldRef = useRef<HTMLInputElement>(null);
    const listRef = useRef<HTMLUListElement>(null);
    const listId = useId();

    // Picking the value that is already typed shows everything; typing narrows the list.
    const needle = value.trim().toLowerCase();
    const shown = options.filter((option) => !needle || option.toLowerCase().includes(needle)).slice(0, 200);
    const exact = options.includes(value);
    const list = exact ? options.slice(0, 200) : shown;

    // Where the list goes depends on the field's place in the window, so it is measured when the list opens
    // (an event) and again whenever the window or an ancestor scrolls or resizes (the only effect here).
    const measure = () => {
        if (!fieldRef.current) return;
        const rect = fieldRef.current.getBoundingClientRect();
        const below = window.innerHeight - rect.bottom - EDGE;
        const above = rect.top - EDGE;
        const up = below < 140 && above > below;
        setPlace({
            top: up ? rect.top - 4 : rect.bottom + 4,
            left: rect.left,
            width: rect.width,
            maxHeight: Math.max(80, Math.min(MAX_LIST_HEIGHT, up ? above : below)),
            up,
        });
    };

    const openList = () => {
        measure();
        setOpen(true);
    };

    useEffect(() => {
        if (!open) return;
        window.addEventListener('resize', measure);
        // A scroll of any ancestor moves the field; capture it so the list follows.
        window.addEventListener('scroll', measure, true);
        return () => {
            window.removeEventListener('resize', measure);
            window.removeEventListener('scroll', measure, true);
        };
    }, [open]);

    const pick = (option: string) => {
        onChange(option);
        setOpen(false);
        setActive(-1);
    };

    const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            if (!open) { openList(); return; }
            if (list.length === 0) return;
            const next = event.key === 'ArrowDown' ? Math.min(list.length - 1, active + 1) : Math.max(0, active - 1);
            setActive(next);
            listRef.current?.children[next]?.scrollIntoView({ block: 'nearest' });
        } else if (event.key === 'Enter' && open && active >= 0 && list[active] !== undefined) {
            event.preventDefault();
            pick(list[active]);
        } else if (event.key === 'Escape' && open) {
            event.stopPropagation();
            setOpen(false);
        }
    };

    const hasList = options.length > 0;

    return (
        <>
            <input
                ref={fieldRef}
                id={id}
                type="text"
                role="combobox"
                aria-expanded={open && hasList}
                aria-controls={listId}
                aria-autocomplete="list"
                autoComplete="off"
                value={value}
                disabled={disabled}
                placeholder={placeholder}
                onChange={(event) => { onChange(event.target.value); openList(); setActive(-1); }}
                onFocus={() => hasList && openList()}
                onClick={() => hasList && openList()}
                // Leaving the field closes the list: no document listener is needed. A press inside the list
                // does not take focus away from the field (see the list's onMouseDown), so scrolling it is safe.
                onBlur={() => setOpen(false)}
                onKeyDown={onKeyDown}
                className="w-full h-11 bg-bg-input border border-border-subtle rounded-lg px-3 text-sm text-text-primary placeholder-text-tertiary focus:outline-none focus:border-accent-primary transition-colors"
            />
            {open && hasList && place && createPortal(
                <ul
                    ref={listRef}
                    id={listId}
                    role="listbox"
                    onMouseDown={(event) => event.preventDefault()}
                    style={{
                        position: 'fixed',
                        left: place.left,
                        width: place.width,
                        maxHeight: place.maxHeight,
                        ...(place.up ? { bottom: window.innerHeight - place.top } : { top: place.top }),
                    }}
                    className="z-[3000] overflow-y-auto overscroll-contain rounded-lg border border-border-subtle bg-bg-elevated py-1 shadow-xl"
                >
                    {list.length === 0 ? (
                        <li className="px-3 py-2 text-xs text-text-tertiary">No match. The text you typed is used as it is.</li>
                    ) : (
                        list.map((option, index) => (
                            <li
                                key={option}
                                role="option"
                                aria-selected={option === value}
                                onMouseDown={(event) => { event.preventDefault(); pick(option); }}
                                onMouseEnter={() => setActive(index)}
                                className={`cursor-pointer truncate px-3 py-1.5 text-xs ${index === active ? 'bg-bg-item-active text-text-primary' : option === value ? 'text-text-primary' : 'text-text-secondary'}`}
                            >
                                {option}
                            </li>
                        ))
                    )}
                </ul>,
                // Outside the settings panel, so an ancestor's transform or overflow cannot move or clip it.
                document.body
            )}
        </>
    );
};

export default ModelCombobox;
