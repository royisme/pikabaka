import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';

interface ReleaseNoteSection {
    title: string;
    items: string[];
}

interface ParsedReleaseNotes {
    version: string;
    summary: string;
    sections: ReleaseNoteSection[];
    fullBody?: string;
    url?: string;
}

interface UpdateModalProps {
    isOpen: boolean;
    updateInfo: any;
    parsedNotes: ParsedReleaseNotes | null;
    onDismiss: () => void;
    status: 'idle' | 'ready';
}

const UpdateModal: React.FC<UpdateModalProps> = ({
    isOpen,
    updateInfo,
    parsedNotes,
    onDismiss,
    status
}) => {
    // Helper to format version string
    const formatVersion = (v: string) => {
        if (!v) return 'Unknown';
        if (v === 'latest') return 'Latest';
        if (v === 'vlatest') return 'Latest';
        return v.startsWith('v') ? v : `v${v}`;
    };

    const displayVersion = formatVersion(updateInfo?.version);

    const showFallback = !parsedNotes || (!parsedNotes.summary && (!parsedNotes.sections || parsedNotes.sections.length === 0));

    // Auto-scroll logic
    const scrollContainerRef = React.useRef<HTMLDivElement>(null);
    const isUserInteractionRef = React.useRef(false);
    const animationFrameRef = React.useRef<number>();

    React.useEffect(() => {
        if (showFallback || !isOpen) return;

        const scroll = () => {
            if (isUserInteractionRef.current || !scrollContainerRef.current) return;

            const el = scrollContainerRef.current;
            // Smooth scroll speed
            el.scrollTop += 0.5;

            // Check if reached bottom (with small buffer)
            if (el.scrollTop + el.clientHeight >= el.scrollHeight - 1) {
                el.scrollTop = 0; // Cycle to top
            }

            animationFrameRef.current = requestAnimationFrame(scroll);
        };

        // Start scrolling after a small delay to let render finish
        const timeoutId = setTimeout(() => {
            animationFrameRef.current = requestAnimationFrame(scroll);
        }, 1000);

        return () => {
            clearTimeout(timeoutId);
            if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
        };
    }, [status, showFallback, isOpen]);

    const handleUserScrollInteraction = () => {
        isUserInteractionRef.current = true;
        if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
    };

    return (
        <AnimatePresence>
            {isOpen && (
                <div className="fixed inset-0 z-titlebar flex items-center justify-center font-sans antialiased">
                    {/* Backdrop */}
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.3 }}
                        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
                        onClick={onDismiss}
                    />

                    {/* Modal - Apple Style: Premium, Deep Shadow, Subtle Border */}
                    <motion.div
                        initial={{ opacity: 0, scale: 0.96, y: 8 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.96, y: 8 }}
                        transition={{
                            type: "spring",
                            stiffness: 350,
                            damping: 30
                        }}
                        className="relative w-[510px] h-[380px] bg-[#1E1E1E]/90 backdrop-blur-2xl rounded-xl shadow-[0_50px_100px_-20px_rgba(0,0,0,0.5)] border border-white/[0.08] overflow-hidden flex flex-col"
                    >
                        {/* Content Container */}
                            <div className="p-7 pb-4 flex flex-col gap-2 h-full min-h-0">
                                {/* Header Group */}
                                <div className="flex flex-col gap-0.5 text-center relative flex-shrink-0 pt-1">
                                    <h2 className="text-[19px] font-semibold text-white tracking-tight">
                                        Update Ready
                                    </h2>
                                    <p className="text-[13px] text-white/50 font-medium tracking-wide">
                                        Version {displayVersion} is downloaded and ready to install.
                                    </p>
                                </div>

                                {/* Minimal List - Scrollable area */}
                                <div
                                    ref={scrollContainerRef}
                                    onWheel={handleUserScrollInteraction}
                                    onTouchMove={handleUserScrollInteraction}
                                    onMouseDown={handleUserScrollInteraction}
                                    className="py-2 flex-1 overflow-y-auto custom-scrollbar min-h-[120px] pr-2 -mr-2"
                                >
                                    {showFallback ? (
                                        <p className="text-[13px] text-white/60 text-center leading-relaxed mt-8">
                                            Includes performance improvements and bug fixes.
                                        </p>
                                    ) : (
                                        <div className="space-y-5 px-1">
                                            {parsedNotes?.sections?.map((section, idx) => {
                                                if (section.items.length === 0) return null;
                                                if (section.title === 'Summary') return null;

                                                return (
                                                    <div key={idx} className="space-y-2.5">
                                                        {/* Section Header: Refined, Medium Weight */}
                                                        <h3 className="text-[13px] font-medium text-white/90 pl-1">
                                                            {section.title}
                                                        </h3>
                                                        <ul className="space-y-2">
                                                            {section.items.map((item, i) => (
                                                                <li key={i} className="text-[13px] text-white/70 leading-[1.5] flex items-start gap-3 pl-1">
                                                                    <span className="text-white/30 mt-[6px] text-[10px] transform scale-75 flex-shrink-0">
                                                                        —
                                                                    </span>
                                                                    <span>{item}</span>
                                                                </li>
                                                            ))}
                                                        </ul>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    )}
                                </div>

                                {/* Footer Actions */}
                                <div className="flex items-center justify-between flex-shrink-0">
                                    {/* Secondary Action - Left Aligned, Plain Text */}
                                    <button
                                        onClick={onDismiss}
                                        className="text-[13px] font-medium text-white/40 hover:text-white/70 transition-colors"
                                    >
                                        Not Now
                                    </button>

                                    {/* Primary Action - Right Aligned, System Blue */}
                                    <button
                                        onClick={() => window.electronAPI.restartAndInstall()}
                                        className="px-5 py-[6px] bg-[#007AFF] hover:bg-[#0062CC] text-white text-[13px] font-medium rounded-lg shadow-sm transition-colors"
                                    >
                                        Restart & Install
                                    </button>
                                </div>
                            </div>
                    </motion.div>
                </div>
            )}
        </AnimatePresence>
    );
};

export default UpdateModal;
