import React from 'react';
import { Mic, MessageSquare } from 'lucide-react';
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

const ZoneHeader: React.FC<{ icon: React.ReactNode; label: string }> = ({ icon, label }) => (
    <div className="flex items-center gap-1.5 px-3 py-1 text-[10px] font-semibold uppercase tracking-wider overlay-text-muted border-b border-border-subtle/50 bg-black/10 select-none shrink-0">
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
    return (
        <div
            className={`relative w-full flex-1 min-h-0 border rounded-[24px] overflow-hidden flex flex-col draggable-area overlay-shell-surface ${overlayPanelClass}`}
            style={appearance.shellStyle}
        >
            <div className="flex-1 min-h-0 flex flex-col">
                <section
                    className="min-w-0 min-h-0 overflow-hidden flex flex-col bg-white/[0.02]"
                    style={{ height: `${splitterPosition}%` }}
                >
                    <ZoneHeader icon={<Mic className="w-2.5 h-2.5" />} label="Live Transcript" />
                    <div className="flex-1 min-h-0 overflow-hidden flex flex-col">{left}</div>
                </section>
                <ResizableSplitter
                    position={splitterPosition}
                    onPositionChange={onSplitterChange}
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
