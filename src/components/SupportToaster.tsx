
import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Heart, X, ExternalLink } from 'lucide-react';
import { cn } from '../lib/utils';

interface SupportToasterProps {
    className?: string;
}

export const SupportToaster: React.FC<SupportToasterProps> = ({ className }) => {
    const [isVisible, setIsVisible] = useState(false);
    const [hasDonated, setHasDonated] = useState(false);
    const [isButtonHovered, setIsButtonHovered] = useState(false);

    useEffect(() => {
        let mounted = true;

        const checkStatus = async () => {
            // Wait 10s before checking
            await new Promise(resolve => setTimeout(resolve, 10000));

            try {
                if (!window.electronAPI?.getDonationStatus) return;

                const status = await window.electronAPI.getDonationStatus();
                if (mounted) {
                    setHasDonated(status.hasDonated);
                    if (status.shouldShow) {
                        setIsVisible(true);
                        window.electronAPI.markDonationToastShown();
                    }
                }
            } catch (e) {
                console.error("Failed to check donation status:", e);
            }
        };

        checkStatus();

        return () => { mounted = false; };
    }, []);

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (!import.meta.env.DEV) return;
            if ((e.metaKey || e.ctrlKey) && e.key === 's') {
                e.preventDefault();
                console.log("Debug: Toggling Donation Toaster");
                setIsVisible(prev => !prev);
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, []);

    const clickTimeRef = React.useRef<number | null>(null);

    useEffect(() => {
        const handleFocus = async () => {
            if (clickTimeRef.current) {
                const elapsed = Date.now() - clickTimeRef.current;
                if (elapsed > 20000) { // 20 seconds
                    console.log("User returned from support link after >20s. Presuming donation.");
                    await window.electronAPI?.setDonationComplete();
                    setHasDonated(true);
                    setIsVisible(false);
                }
                clickTimeRef.current = null;
            }
        };
        window.addEventListener('focus', handleFocus);
        return () => window.removeEventListener('focus', handleFocus);
    }, []);

    const handleDismiss = () => {
        setIsVisible(false);
    };

    const handleSupport = () => {
        clickTimeRef.current = Date.now();
        if (window.electronAPI?.openExternal) {
            window.electronAPI.openExternal('https://buymeacoffee.com/royisme');
        } else {
            window.open('https://buymeacoffee.com/royisme', '_blank');
        }
    };

    if (!isVisible) return null;

    return (
        <AnimatePresence>
            {isVisible && (
                <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-[2px]">
                    <motion.div
                        initial={{ opacity: 0, scale: 0.98, y: 4 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.98, y: 4 }}
                        transition={{ duration: 0.2, ease: [0.2, 0, 0, 1] }}
                        className={cn(
                            "relative w-[510px] h-[380px] overflow-hidden",
                            "rounded-[28px]",
                            "bg-gradient-to-b from-[#16171A] to-[#111214]",
                            "border border-white/[0.08]",
                            "shadow-[0_32px_64px_-16px_rgba(0,0,0,0.6),0_8px_24px_-8px_rgba(0,0,0,0.4),inset_0_1px_0_rgba(255,255,255,0.08)]",
                            "flex flex-col items-center",
                            className
                        )}
                    >
                        {/* 1. Header Section (Top Stack) */}
                        <div className="pt-[42px] flex flex-col items-center w-full px-[40px]">
                            {/* Icon - Liquid Fill Effect */}
                            <div className="relative mb-[28px] w-[32px] h-[32px]">
                                <style>
                                    {`
                                        @keyframes waveMove {
                                            from { background-position-x: 0; }
                                            to { background-position-x: -32px; } /* Must match background size width */
                                        }
                                    `}
                                </style>

                                <div className="absolute inset-0 bg-[#FF6A5C] blur-[32px] opacity-15 rounded-full" />

                                {/* 1. The Liquid Container (Masked to Heart Shape) */}
                                <div
                                    className="absolute inset-0 z-10"
                                    style={{
                                        // Standard Lucide Heart Path Mask
                                        maskImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24' fill='black'%3E%3Cpath d='M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z'/%3E%3C/svg%3E")`,
                                        WebkitMaskImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24' fill='black'%3E%3Cpath d='M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z'/%3E%3C/svg%3E")`,
                                        maskSize: 'contain',
                                        WebkitMaskSize: 'contain',
                                        maskRepeat: 'no-repeat',
                                        WebkitMaskRepeat: 'no-repeat',
                                        maskPosition: 'center',
                                        WebkitMaskPosition: 'center',
                                    }}
                                >
                                    {/* The Water */}
                                    <motion.div
                                        initial={{ height: "0%" }}
                                        animate={{ height: isButtonHovered ? "100%" : "0%" }}
                                        transition={{ duration: 1.5, ease: "easeInOut" }}
                                        className="absolute bottom-0 left-0 right-0 w-full bg-[#FF6A5C]"
                                        style={{
                                            backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='100' height='20' viewBox='0 0 100 20' preserveAspectRatio='none'%3E%3Cpath d='M0 20 V10 Q25 0 50 10 T100 10 V20 H0 Z' fill='%23FF6A5C' /%3E%3C/svg%3E")`,
                                            backgroundSize: '32px 100%', // Match width of icon approx
                                            backgroundRepeat: 'repeat-x',
                                        }}
                                    >
                                        {/* Inner Wave Top - Sits at the top of the filling column */}
                                        <div
                                            className="absolute -top-[5px] left-0 right-0 h-[10px] w-full"
                                            style={{
                                                backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='100' height='20' viewBox='0 0 100 20' preserveAspectRatio='none'%3E%3Cpath d='M0 20 V10 Q25 0 50 10 T100 10 V20 H0 Z' fill='%23FF6A5C' /%3E%3C/svg%3E")`,
                                                backgroundSize: '32px 100%',
                                                animation: 'waveMove 1s linear infinite',
                                            }}
                                        />
                                    </motion.div>
                                </div>

                                {/* 2. Outline Overlay (Sit on top) */}
                                <Heart
                                    size={32}
                                    className="text-[#FF6A5C] drop-shadow-[0_0_12px_rgba(255,106,92,0.4)] relative z-20 pointer-events-none"
                                    strokeWidth={1.5}
                                />
                            </div>

                            {/* Typography Stack */}
                            <div className="flex flex-col items-center text-center">
                                {/* Headline */}
                                <h3 className="text-[26px] font-[600] leading-[1.2] text-[#F3F3F3] tracking-[-0.01em] mb-[12px] antialiased">
                                    Built by one.<br />
                                    Used by thousands.
                                </h3>
                                {/* Body */}
                                <p className="text-[14px] leading-[1.6] text-white/60 max-w-[480px] font-medium antialiased">
                                    Pika is built and maintained by one developer.<br />
                                    If it’s part of your daily workflow, your support keeps<br />
                                    it moving forward.
                                </p>
                            </div>
                        </div>

                        {/* 2. Actions Footer (Bottom Stack) */}
                        {/* Changed pb-[42px] to pb-[32px] to move button down closer to edge */}
                        <div className="mt-auto w-full flex flex-col items-center pb-[32px]">

                            {/* Primary Button */}
                            <button
                                onClick={handleSupport}
                                onMouseEnter={() => setIsButtonHovered(true)}
                                onMouseLeave={() => setIsButtonHovered(false)}
                                className="group relative w-[320px] h-[48px] rounded-[16px] overflow-hidden transition-all duration-300 hover:scale-[1.01] active:scale-[0.99] shadow-[0_4px_16px_rgba(255,106,92,0.1)] hover:shadow-[0_8px_24px_rgba(255,106,92,0.2)] mb-[16px] border border-white/5"
                            >
                                <div className="absolute inset-0 bg-gradient-to-b from-[#FF6A5C] to-[#E55B4D] opacity-100 transition-all" />
                                <div className="absolute inset-0 bg-white/10 opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
                                <span className="relative z-10 text-[15px] font-[600] text-white/95 group-hover:text-white flex items-center justify-center gap-2 tracking-wide">
                                    Support the Builder
                                </span>
                            </button>

                            {/* Secondary Button */}
                            <button
                                onClick={handleDismiss}
                                className="text-[14px] text-white/30 font-medium hover:text-white/60 transition-colors duration-200"
                            >
                                Not now
                            </button>
                        </div>
                    </motion.div>
                </div>
            )}
        </AnimatePresence>
    );
};
