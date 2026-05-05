import React from 'react';
import { CalendarPlus, SearchX } from 'lucide-react';
import { motion } from 'framer-motion';

interface EmptyStateProps {
    type: 'empty' | 'no-results';
    onStartMeeting?: () => void;
}

const EmptyState: React.FC<EmptyStateProps> = ({ type, onStartMeeting }) => {
    const isInitialEmpty = type === 'empty';
    const Icon = isInitialEmpty ? CalendarPlus : SearchX;

    return (
        <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
            className={`flex flex-col items-center justify-center rounded-2xl border border-border-subtle bg-bg-elevated/60 text-center ${isInitialEmpty ? 'min-h-80 p-10' : 'min-h-48 p-8'}`}
        >
            <div className={`rounded-2xl bg-accent-primary/10 text-accent-primary ${isInitialEmpty ? 'p-5 mb-6' : 'p-4 mb-4'}`}>
                <Icon size={isInitialEmpty ? 44 : 28} strokeWidth={1.7} />
            </div>
            <h3 className="text-lg font-semibold text-text-primary">
                {isInitialEmpty ? 'Start your first meeting' : 'No meetings match your search'}
            </h3>
            <p className="mt-2 max-w-md text-sm leading-relaxed text-text-secondary">
                {isInitialEmpty
                    ? 'When you finish a meeting, Pika will save summaries, transcripts, and recordings here.'
                    : 'Try a different keyword or widen the time range.'}
            </p>
            {isInitialEmpty && onStartMeeting && (
                <button
                    type="button"
                    onClick={onStartMeeting}
                    className="mt-6 rounded-full bg-accent-primary px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-accent-primary/90 focus:outline-none focus:ring-2 focus:ring-accent-primary/40"
                >
                    Start your first meeting
                </button>
            )}
        </motion.div>
    );
};

export default EmptyState;
