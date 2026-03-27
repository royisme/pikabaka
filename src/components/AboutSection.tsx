import React, { useEffect, useRef, useState } from 'react';
import { Heart, ExternalLink } from 'lucide-react';
import { motion } from 'framer-motion';

interface AboutSectionProps { }

const APP_VERSION = '1.0.0';
const BMC_URL = 'https://buymeacoffee.com/royisme';

const stagger = {
    hidden: {},
    show: {
        transition: { staggerChildren: 0.08, delayChildren: 0.1 }
    }
};

const fadeUp = {
    hidden: { opacity: 0, y: 6 },
    show: {
        opacity: 1,
        y: 0,
        transition: { type: 'spring' as const, stiffness: 260, damping: 28 }
    }
};

export const AboutSection: React.FC<AboutSectionProps> = () => {
    const donationClickTimeRef = useRef<number | null>(null);
    const [isHovered, setIsHovered] = useState(false);

    useEffect(() => {
        const handleFocus = async () => {
            if (donationClickTimeRef.current) {
                const elapsed = Date.now() - donationClickTimeRef.current;
                if (elapsed > 20000) {
                    await window.electronAPI?.setDonationComplete();
                }
                donationClickTimeRef.current = null;
            }
        };

        window.addEventListener('focus', handleFocus);
        return () => window.removeEventListener('focus', handleFocus);
    }, []);

    const handleOpenLink = (e: React.MouseEvent<HTMLAnchorElement | HTMLButtonElement>, url: string) => {
        e.preventDefault();
        if (url.includes('buymeacoffee.com')) {
            donationClickTimeRef.current = Date.now();
        }
        if (window.electronAPI?.openExternal) {
            window.electronAPI.openExternal(url);
        } else {
            window.open(url, '_blank');
        }
    };

    return (
        <motion.div
            className="pb-10"
            variants={stagger}
            initial="hidden"
            animate="show"
        >
            {/* Identity */}
            <motion.div variants={fadeUp} className="pt-6 pb-10">
                <div className="flex items-baseline gap-3">
                    <h3 className="text-xl font-bold tracking-tightest text-text-primary font-display">
                        Pika
                    </h3>
                    <span className="text-[11px] font-mono text-text-tertiary/70 tabular-nums">
                        v{APP_VERSION}
                    </span>
                </div>
                <p className="text-sm text-text-secondary leading-relaxed mt-3 max-w-[52ch]">
                    Interview copilot and meeting assistant. Transcription, answer
                    suggestions, and screen analysis — running locally on your device.
                </p>
            </motion.div>

            {/* Divider */}
            <motion.div variants={fadeUp} className="border-t border-border-subtle" />

            {/* Support card */}
            <motion.div variants={fadeUp} className="pt-8">
                <div
                    className="group relative rounded-xl overflow-hidden"
                    onMouseEnter={() => setIsHovered(true)}
                    onMouseLeave={() => setIsHovered(false)}
                >
                    {/* Subtle warm glow on hover */}
                    <motion.div
                        className="absolute inset-0 rounded-xl pointer-events-none"
                        animate={{
                            boxShadow: isHovered
                                ? 'inset 0 0 0 1px rgba(244,114,100,0.15), 0 8px 32px -8px rgba(244,114,100,0.08)'
                                : 'inset 0 0 0 1px var(--border-subtle), 0 0 0 0px transparent'
                        }}
                        transition={{ type: 'spring', stiffness: 200, damping: 30 }}
                    />

                    <div className="relative bg-bg-item-surface p-6 flex items-start gap-5">
                        {/* Heart icon with subtle breathing animation */}
                        <div className="relative mt-0.5">
                            <motion.div
                                className="w-10 h-10 rounded-xl flex items-center justify-center"
                                style={{ background: 'rgba(244,114,100,0.08)' }}
                                animate={{
                                    scale: isHovered ? 1.05 : 1,
                                }}
                                transition={{ type: 'spring', stiffness: 300, damping: 20 }}
                            >
                                <Heart
                                    size={18}
                                    className="text-[#f47264]"
                                    fill={isHovered ? 'currentColor' : 'none'}
                                    strokeWidth={1.8}
                                />
                            </motion.div>
                        </div>

                        <div className="flex-1 min-w-0">
                            <h5 className="text-[13px] font-semibold text-text-primary leading-tight">
                                Support this project
                            </h5>
                            <p className="text-xs text-text-tertiary mt-1.5 leading-relaxed max-w-[40ch]">
                                Pika is built and maintained independently. If it helps your workflow, a coffee goes a long way.
                            </p>

                            <motion.button
                                onClick={(e) => handleOpenLink(e, BMC_URL)}
                                className="mt-4 inline-flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold transition-colors bg-text-primary text-bg-main"
                                whileHover={{ y: -1 }}
                                whileTap={{ scale: 0.97 }}
                                transition={{ type: 'spring', stiffness: 400, damping: 25 }}
                            >
                                Buy Me a Coffee
                                <ExternalLink size={11} className="opacity-50" />
                            </motion.button>
                        </div>
                    </div>
                </div>
            </motion.div>

            {/* Footer meta */}
            <motion.div variants={fadeUp} className="pt-8 flex items-center justify-between">
                <p className="text-[11px] text-text-tertiary/50 font-mono tracking-wide">
                    Electron + React + Rust
                </p>
            </motion.div>
        </motion.div>
    );
};
