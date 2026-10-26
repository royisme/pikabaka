import { useEffect, useState } from "react";
import { ChevronUp, ChevronDown } from "lucide-react";
import icon from "../../../assets/icon.png";
import type { OverlayAppearance } from "../../lib/overlayAppearance";

interface TopPillProps {
    expanded: boolean;
    onToggle: () => void;
    onQuit: () => void;
    appearance: OverlayAppearance;
    onLogoClick?: () => void;
}

export default function TopPill({
    expanded,
    onToggle,
    onQuit,
    appearance,
    onLogoClick,
}: TopPillProps) {
    // Stop sits next to Hide mid-call: the first press arms it, the second within 3 seconds quits.
    const [confirmingQuit, setConfirmingQuit] = useState(false);
    useEffect(() => {
        if (!confirmingQuit) return;
        const timer = window.setTimeout(() => setConfirmingQuit(false), 3000);
        return () => window.clearTimeout(timer);
    }, [confirmingQuit]);

    return (
        <div className="flex justify-center mt-2 select-none z-50">
            <div
                className="
          draggable-area
          flex items-center gap-2
          rounded-full
          overlay-pill-surface
          backdrop-blur-md
          pl-1.5 pr-1.5 py-1.5
          transition-all duration-300 ease-sculpted
        "
                style={appearance.pillStyle}
            >
                {/* LOGO BUTTON */}
                <button
                    onClick={onLogoClick}
                    aria-label="Open dashboard"
                    className={`
            w-8 h-8
            rounded-full
            overlay-icon-surface
            overlay-icon-surface-hover
            flex items-center justify-center
            relative overflow-hidden
            interaction-base interaction-press
          `}
                    style={appearance.iconStyle}
                >
                    <img
                        src={icon}
                        alt="Pika"
                        className="w-[24px] h-[24px] object-contain opacity-95 scale-105 drop-shadow-sm"
                        draggable="false"
                        onDragStart={(e) => e.preventDefault()}
                    />
                </button>

                {/* CENTER SEGMENT */}
                <button
                    onClick={onToggle}
                    className={`
            flex items-center gap-2
            group
            px-4 py-1.5
            rounded-full
            backdrop-blur-md
            overlay-chip-surface
            overlay-text-interactive
            text-[12px]
            font-medium
            border
            interaction-base interaction-hover interaction-press
          `}
                    style={appearance.chipStyle}
                >
                    <span className="opacity-70 group-hover:opacity-100 transition-opacity duration-200">
                        {expanded ? (
                            <ChevronUp className="w-3.5 h-3.5" />
                        ) : (
                            <ChevronDown className="w-3.5 h-3.5" />
                        )}
                    </span>
                    <span className="tracking-wide opacity-80 group-hover:opacity-100">{expanded ? "Hide" : "Show"}</span>
                </button>

                {/* STOP / QUIT BUTTON */}
                <button
                    onClick={() => (confirmingQuit ? onQuit() : setConfirmingQuit(true))}
                    aria-label={confirmingQuit ? "Press again to stop and quit" : "Stop and quit"}
                    title={confirmingQuit ? "Press again to stop and quit" : "Stop and quit"}
                    className={`
            w-8 h-8
            rounded-full
            overlay-icon-surface
            flex items-center justify-center
            interaction-base interaction-press
            hover:bg-state-danger-soft hover:text-state-danger
            ${confirmingQuit ? "bg-state-danger-soft text-state-danger" : "overlay-text-primary"}
          `}
                    style={appearance.iconStyle}
                >
                    <div className="w-3.5 h-3.5 rounded-[3px] bg-current opacity-80" />
                </button>
            </div>
        </div>
    );
}
