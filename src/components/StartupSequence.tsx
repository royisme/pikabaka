import React, { useEffect } from 'react';
import { motion } from 'framer-motion';
import appIcon from '../../assets/icon.png';

interface StartupSequenceProps {
    onComplete: () => void;
}

const StartupSequence: React.FC<StartupSequenceProps> = ({ onComplete }) => {
    useEffect(() => {
        const timer = setTimeout(() => {
            onComplete();
        }, 2200);
        return () => clearTimeout(timer);
    }, [onComplete]);

    return (
        <div className="fixed inset-0 z-overlay bg-[#000000] flex flex-col items-center justify-center overflow-hidden">
            {/* Volumetric Backlight - Adds depth/atmosphere */}
            <motion.div
                className="absolute w-96 h-96 bg-white/10 rounded-full blur-[120px]"
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1.2 }}
                transition={{ duration: 3, ease: "easeOut" }}
            />

            <motion.img
                src={appIcon}
                alt="App Icon"
                className="w-24 h-24 object-contain relative z-10"
                initial={{
                    opacity: 0,
                    scale: 0.5,
                    filter: 'brightness(0.75) drop-shadow(0 0 0px rgba(255,255,255,0))',
                }}
                animate={{
                    opacity: 1,
                    scale: 1,
                    filter: [
                        'brightness(0.75) drop-shadow(0 0 0px rgba(255,255,255,0))',
                        'brightness(0.75) drop-shadow(0 0 0px rgba(255,255,255,0))',
                        'brightness(1) drop-shadow(0 0 20px rgba(255,255,255,0.3))',
                    ],
                }}
                transition={{
                    opacity: { duration: 0.6, ease: "easeOut" },
                    scale: { duration: 1.8, ease: [0.16, 1, 0.3, 1] }, // Expo Out - Extremely smooth
                    filter: { times: [0, 0.25, 1], duration: 1.8, ease: "easeInOut" }
                }}
            />

            <p
                className="relative z-10 mt-6 font-sans text-base md:text-lg italic tracking-label text-text-secondary opacity-0 animate-fade-in-up"
                style={{
                    animationDelay: 'var(--motion-slow)',
                    animationDuration: 'calc(var(--motion-slow) + var(--motion-base))',
                }}
            >
                Hear. Think. Speak — with an AI in the loop.
            </p>
        </div>
    );
};

export default StartupSequence;
