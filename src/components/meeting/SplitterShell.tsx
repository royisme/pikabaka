import React from 'react';
import ResizableSplitter from '../ui/ResizableSplitter';
import type { getOverlayAppearance } from '../../lib/overlayAppearance';

interface SplitterShellProps {
    left: React.ReactNode;
    right: React.ReactNode;
    splitterPosition: number;
    onSplitterChange: (next: number) => void;
    isExpanded: boolean;
    appearance: ReturnType<typeof getOverlayAppearance>;
    overlayPanelClass: string;
}

const SplitterShell: React.FC<SplitterShellProps> = ({
    left,
    right,
    splitterPosition,
    onSplitterChange,
    appearance,
    overlayPanelClass,
}) => {
    return (
        <div
            className={`relative w-full border rounded-[24px] overflow-hidden flex flex-col draggable-area overlay-shell-surface ${overlayPanelClass}`}
            style={appearance.shellStyle}
        >
            <div className="flex-1 min-h-0 flex">
                <div className="min-w-0 min-h-0" style={{ width: `${splitterPosition}%` }}>
                    {left}
                </div>
                <ResizableSplitter
                    position={splitterPosition}
                    onPositionChange={onSplitterChange}
                />
                <div className="min-w-0 min-h-0 flex-1">
                    {right}
                </div>
            </div>
        </div>
    );
};

export default SplitterShell;
