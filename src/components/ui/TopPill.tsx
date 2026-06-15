import { ChevronUp, ChevronDown, Pause, Play, Square, GripHorizontal, X } from "lucide-react";
import icon from "../../../assets/icon.png";
import type { OverlayAppearance } from "../../lib/overlayAppearance";
import { shouldShowTopPillRunControls } from "./topPillControls";

interface TopPillProps {
    expanded: boolean;
    onToggle: () => void;
    onQuit: () => void;
    appearance: OverlayAppearance;
    onLogoClick?: () => void;
    isPaused?: boolean;
    isProcessing?: boolean;
    onPauseToggle?: () => void;
    onStop?: () => void;
}

export default function TopPill({
    expanded,
    onToggle,
    onQuit,
    appearance,
    onLogoClick,
    isPaused = false,
    isProcessing = false,
    onPauseToggle,
    onStop,
}: TopPillProps) {
    const showRunControls = shouldShowTopPillRunControls(expanded, Boolean(onPauseToggle || onStop));

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

                {showRunControls && (
                    <div
                        className="draggable-area hidden min-[460px]:flex items-center gap-1 px-2 overlay-text-muted"
                        aria-label="Drag Pika window"
                        title="Drag Pika window"
                    >
                        <GripHorizontal className="w-4 h-4" />
                        <span className="text-[10px] uppercase tracking-[0.12em]">Drag</span>
                    </div>
                )}

                {showRunControls && onPauseToggle && (
                    <button
                        onClick={onPauseToggle}
                        aria-label={isPaused ? "Resume meeting" : "Pause meeting"}
                        aria-pressed={isPaused}
                        className={`
              no-drag h-8 px-3
              rounded-full
              overlay-icon-surface overlay-icon-surface-hover
              overlay-text-primary
              flex items-center gap-1.5 justify-center
              text-[11px] font-medium
              interaction-base interaction-press
              ${isPaused ? 'text-state-warning' : ''}
            `}
                        style={appearance.iconStyle}
                    >
                        {isPaused ? <Play className="w-3.5 h-3.5" /> : <Pause className="w-3.5 h-3.5" />}
                        <span className="hidden min-[390px]:inline">{isPaused ? "Resume" : "Pause"}</span>
                    </button>
                )}

                {showRunControls && onStop && (
                    <button
                        onClick={onStop}
                        aria-label={isProcessing ? "Stop current answer" : "Stop current action"}
                        className={`
              no-drag h-8 px-3
              rounded-full
              overlay-icon-surface
              overlay-text-primary
              flex items-center gap-1.5 justify-center
              text-[11px] font-medium
              interaction-base interaction-press
              hover:bg-state-danger-soft hover:text-state-danger
            `}
                        style={appearance.iconStyle}
                    >
                        <Square className="w-3.5 h-3.5" />
                        <span className="hidden min-[390px]:inline">Stop</span>
                    </button>
                )}

                {/* QUIT BUTTON */}
                <button
                    onClick={onQuit}
                    aria-label="Quit Pika"
                    className={`
            no-drag w-8 h-8
            rounded-full
            overlay-icon-surface
            overlay-text-primary
            flex items-center justify-center
            interaction-base interaction-press
            hover:bg-state-danger-soft hover:text-state-danger
          `}
                    style={appearance.iconStyle}
                >
                    <X className="w-4 h-4" />
                </button>
            </div>
        </div>
    );
}
