import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Mic, MessageSquare } from 'lucide-react';
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

const ZoneHeader: React.FC<{ icon: React.ReactNode; label: string }> = ({ icon, label }) => (
    <div className={`${PANE_HEADER_DRAG_CLASS} flex items-center gap-1.5 px-3 py-1 text-[10px] font-semibold uppercase tracking-wider overlay-text-muted border-b border-border-subtle/50 bg-black/10 select-none shrink-0`} aria-label={`Drag ${label} pane`} title={`Drag ${label} pane`}>
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
    const [contentHeight, setContentHeight] = useState(0);

    useEffect(() => {
        const node = contentRef.current;
        if (!node) return;

        const updateHeight = () => setContentHeight(node.getBoundingClientRect().height);
        updateHeight();

        const observer = new ResizeObserver(updateHeight);
        observer.observe(node);
        return () => observer.disconnect();
    }, []);

    const { maxTranscriptSplit, minTranscriptSplit, safeSplitterPosition } = useMemo(
        () => calculateSplitterBounds(contentHeight, splitterPosition),
        [contentHeight, splitterPosition],
    );

    useEffect(() => {
        if (Math.abs(safeSplitterPosition - splitterPosition) > 0.1) {
            onSplitterChange(safeSplitterPosition);
        }
    }, [onSplitterChange, safeSplitterPosition, splitterPosition]);

    return (
        <div
            className={`relative w-full flex-1 min-h-0 border rounded-[24px] overflow-hidden flex flex-col draggable-area overlay-shell-surface ${overlayPanelClass}`}
            style={appearance.shellStyle}
        >
            <div ref={contentRef} className="flex-1 min-h-0 flex flex-col">
                <section
                    className="min-w-0 min-h-0 overflow-hidden flex flex-col bg-white/[0.02]"
                    style={{ flex: `0 1 ${safeSplitterPosition}%` }}
                >
                    <ZoneHeader icon={<Mic className="w-2.5 h-2.5" />} label="Live Transcript" />
                    <div className="flex-1 min-h-0 overflow-hidden flex flex-col">{left}</div>
                </section>
                <ResizableSplitter
                    position={safeSplitterPosition}
                    onPositionChange={onSplitterChange}
                    orientation="horizontal"
                    min={minTranscriptSplit}
                    max={maxTranscriptSplit}
                />
                <section className="min-w-0 min-h-0 flex-1 overflow-hidden flex flex-col bg-black/[0.04]">
                    <ZoneHeader icon={<MessageSquare className="w-2.5 h-2.5" />} label="AI Chat" />
                    <div className="flex-1 min-h-0 overflow-hidden flex flex-col">{right}</div>
                </section>
            </div>
        </div>
    );
};

export default SplitterShell;
