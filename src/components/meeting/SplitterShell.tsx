import React, { useLayoutEffect, useRef, useState } from 'react';
import ResizableSplitter from '../ui/ResizableSplitter';
import type { getOverlayAppearance } from '../../lib/overlayAppearance';
import { clampSplit, splitBounds } from '../../lib/splitClamp';

interface SplitterShellProps {
    /** The bar across the top of the shell. */
    topBar: React.ReactNode;
    left: React.ReactNode;
    right: React.ReactNode;
    splitterPosition: number;
    onSplitterChange: (next: number) => void;
    onSplitterReset: () => void;
    isExpanded: boolean;
    appearance: ReturnType<typeof getOverlayAppearance>;
    overlayPanelClass: string;
}

const SplitterShell: React.FC<SplitterShellProps> = ({
    topBar,
    left,
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
            {topBar}
            <div ref={zonesRef} className="flex-1 min-h-0 flex flex-col">
                <section
                    aria-label="Live transcript"
                    className="min-w-0 min-h-0 overflow-hidden flex flex-col overlay-transcript-surface"
                    style={{ height: `${drawnPosition}%` }}
                >
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
                <section aria-label="Answers" className="min-w-0 min-h-0 flex-1 overflow-hidden flex flex-col">
                    <div className="flex-1 min-h-0 overflow-hidden flex flex-col">{right}</div>
                </section>
            </div>
        </div>
    );
};

export default SplitterShell;
