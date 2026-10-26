import React, { useLayoutEffect, useRef, useState } from 'react';
import { Mic, MessageSquare } from 'lucide-react';
import ResizableSplitter from '../ui/ResizableSplitter';
import type { getOverlayAppearance } from '../../lib/overlayAppearance';
import { clampSplit, splitBounds } from '../../lib/splitClamp';

interface SplitterShellProps {
    left: React.ReactNode;
    leftHeader?: React.ReactNode;
    right: React.ReactNode;
    splitterPosition: number;
    onSplitterChange: (next: number) => void;
    onSplitterReset: () => void;
    isExpanded: boolean;
    appearance: ReturnType<typeof getOverlayAppearance>;
    overlayPanelClass: string;
}

const ZoneHeader: React.FC<{ icon: React.ReactNode; label: string; children?: React.ReactNode }> = ({ icon, label, children }) => (
    <div className="flex min-h-[28px] items-center gap-1.5 px-3 py-1 text-[10px] font-semibold uppercase tracking-wider overlay-text-muted border-b border-border-subtle/50 bg-black/10 select-none shrink-0">
        {icon}
        <span>{label}</span>
        {children}
    </div>
);

const SplitterShell: React.FC<SplitterShellProps> = ({
    left,
    leftHeader,
    right,
    splitterPosition,
    onSplitterChange,
    onSplitterReset,
    appearance,
    overlayPanelClass,
}) => {
    // The split is the user's wish in percent; what is drawn is that wish held inside the pixel floors of the two zones.
    const zonesRef = useRef<HTMLDivElement>(null);
    const [zonesHeight, setZonesHeight] = useState(0);
    useLayoutEffect(() => {
        const element = zonesRef.current;
        if (!element) return;
        const observer = new ResizeObserver(() => setZonesHeight(element.clientHeight));
        observer.observe(element);
        setZonesHeight(element.clientHeight);
        return () => observer.disconnect();
    }, []);
    const bounds = splitBounds(zonesHeight);
    const drawnPosition = clampSplit(zonesHeight, splitterPosition);

    return (
        <div
            className={`relative w-full flex-1 min-h-0 border rounded-[24px] overflow-hidden flex flex-col draggable-area overlay-shell-surface ${overlayPanelClass}`}
            style={appearance.shellStyle}
        >
            <div ref={zonesRef} className="flex-1 min-h-0 flex flex-col">
                <section
                    className="min-w-0 min-h-0 overflow-hidden flex flex-col bg-white/[0.02]"
                    style={{ height: `${drawnPosition}%` }}
                >
                    <ZoneHeader icon={<Mic className="w-2.5 h-2.5" />} label="Live Transcript">{leftHeader}</ZoneHeader>
                    <div className="flex-1 min-h-0 overflow-hidden flex flex-col">{left}</div>
                </section>
                <ResizableSplitter
                    position={drawnPosition}
                    min={bounds.min}
                    max={bounds.max}
                    onPositionChange={onSplitterChange}
                    onReset={onSplitterReset}
                    orientation="horizontal"
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
