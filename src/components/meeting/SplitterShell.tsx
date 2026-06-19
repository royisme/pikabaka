import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Mic } from 'lucide-react';
import ResizableSplitter from '../ui/ResizableSplitter';
import type { getOverlayAppearance } from '../../lib/overlayAppearance';
import { calculateSplitterBounds } from './chatLayout';
import { PANE_HEADER_DRAG_CLASS } from './paneDragClasses';

interface SplitterShellProps {
    left: React.ReactNode;
    right: React.ReactNode;
    splitterPosition: number;
    onSplitterChange: (next: number) => void;
    isExpanded: boolean;
    appearance: ReturnType<typeof getOverlayAppearance>;
    overlayPanelClass: string;
}

export const SPLITTER_SHELL_CLASS = 'relative w-full flex-1 min-h-0 min-w-0 border rounded-[24px] overflow-hidden flex flex-col draggable-area overlay-shell-surface';
export const SPLITTER_CONTENT_CLASS = 'flex-1 min-h-0 min-w-0 flex flex-row';
export const SPLITTER_STACKED_CONTENT_CLASS = 'flex-1 min-h-0 min-w-0 flex flex-col';
export const STACKED_LAYOUT_WIDTH_PX = 900;
export const SPLITTER_LEFT_SECTION_CLASS = 'min-w-0 min-h-0 overflow-hidden flex flex-col bg-white/[0.02]';
export const SPLITTER_RIGHT_SECTION_CLASS = 'min-w-0 min-h-0 flex-1 overflow-hidden flex flex-col bg-black/[0.04]';
export const SPLITTER_PANE_BODY_CLASS = 'flex-1 min-h-0 min-w-0 overflow-hidden flex flex-col';
export const SPLITTER_ORIENTATION = 'vertical' as const;
export const ZONE_HEADER_CLASS = `${PANE_HEADER_DRAG_CLASS} flex items-center gap-1.5 px-3 py-1 text-[10px] font-semibold uppercase tracking-wider overlay-text-muted border-b border-border-subtle/50 bg-black/10 select-none shrink-0`;

const ZoneHeader: React.FC<{ icon: React.ReactNode; label: string }> = ({ icon, label }) => (
    <div className={ZONE_HEADER_CLASS} aria-label={`Drag ${label} pane`} title={`Drag ${label} pane`}>
        {icon}
        <span>{label}</span>
    </div>
);

const SplitterShell: React.FC<SplitterShellProps> = ({
    left,
    right,
    splitterPosition,
    onSplitterChange,
    appearance,
    overlayPanelClass,
}) => {
    const contentRef = useRef<HTMLDivElement>(null);
    const [contentSize, setContentSize] = useState({ width: 0, height: 0 });

    useEffect(() => {
        const node = contentRef.current;
        if (!node) return;

        const updateSize = () => {
            const rect = node.getBoundingClientRect();
            setContentSize({ width: rect.width, height: rect.height });
        };
        updateSize();

        const observer = new ResizeObserver(updateSize);
        observer.observe(node);
        return () => observer.disconnect();
    }, []);

    const { maxTranscriptSplit, minTranscriptSplit, safeSplitterPosition } = useMemo(
        () => calculateSplitterBounds(contentSize.width, splitterPosition),
        [contentSize.width, splitterPosition],
    );

    const useStackedLayout = contentSize.width > 0 && contentSize.width < STACKED_LAYOUT_WIDTH_PX;
    const stackedTranscriptHeight = Math.max(112, Math.min(220, Math.round(contentSize.height * 0.42)));

    useEffect(() => {
        if (Math.abs(safeSplitterPosition - splitterPosition) > 0.1) {
            onSplitterChange(safeSplitterPosition);
        }
    }, [onSplitterChange, safeSplitterPosition, splitterPosition]);

    return (
        <div
            className={`${SPLITTER_SHELL_CLASS} ${overlayPanelClass}`}
            style={appearance.shellStyle}
        >
            <div ref={contentRef} className={useStackedLayout ? SPLITTER_STACKED_CONTENT_CLASS : SPLITTER_CONTENT_CLASS}>
                <section
                    className={SPLITTER_LEFT_SECTION_CLASS}
                    style={useStackedLayout ? { flex: `0 0 ${stackedTranscriptHeight}px` } : { flex: `0 0 ${safeSplitterPosition}%` }}
                >
                    <ZoneHeader icon={<Mic className="w-2.5 h-2.5" />} label="Live Transcript" />
                    <div className={SPLITTER_PANE_BODY_CLASS}>{left}</div>
                </section>
                {!useStackedLayout && (
                    <ResizableSplitter
                        position={safeSplitterPosition}
                        onPositionChange={onSplitterChange}
                        orientation={SPLITTER_ORIENTATION}
                        min={minTranscriptSplit}
                        max={maxTranscriptSplit}
                    />
                )}
                <section className={SPLITTER_RIGHT_SECTION_CLASS}>
                    <div className={SPLITTER_PANE_BODY_CLASS}>{right}</div>
                </section>
            </div>
        </div>
    );
};

export default SplitterShell;
