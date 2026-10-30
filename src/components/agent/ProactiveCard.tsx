import React from 'react';
import { motion } from 'framer-motion';
import { X } from 'lucide-react';
import type { AgentProactiveCard } from '../../types/electron';

const KIND_LABEL: Record<string, string> = {
    answer_question: 'Question for you',
    explain_term: 'Term',
    check_fact: 'Worth checking',
    action_item: 'Action item',
};

interface ProactiveCardProps {
    card: AgentProactiveCard;
    onDismiss: () => void;
    onAskMore: () => void;
}

/**
 * Pika's one quiet suggestion. It sits in the column above the chat, never over it: the chat gives
 * way (at most 40% of the column goes to the card). The kind label marks it (not size), it fades in
 * over 150ms, makes no sound, and goes only when dismissed or replaced. Only the text scrolls, so
 * the dismiss and Ask more buttons never leave the card.
 */
const ProactiveCard: React.FC<ProactiveCardProps> = ({ card, onDismiss, onAskMore }) => (
    <motion.aside
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.15 }}
        role="status"
        aria-label="Pika suggestion"
        className="no-drag mx-2 mt-2 flex max-h-[40%] shrink-0 flex-col overflow-hidden rounded-xl border overlay-hairline overlay-shell-surface px-3 py-2"
    >
        <div className="flex shrink-0 items-start gap-2">
            <p className="min-w-0 flex-1 text-[11px] font-medium uppercase tracking-wide overlay-text-secondary">{KIND_LABEL[card.kind] ?? 'Suggestion'}</p>
            <button
                type="button"
                aria-label="Dismiss"
                title="Dismiss"
                onClick={onDismiss}
                className="no-drag -mr-1 shrink-0 inline-flex h-7 w-7 items-center justify-center rounded-full overlay-text-secondary hover:text-[var(--overlay-text-primary)]"
            >
                <X className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
        </div>
        <div className="min-h-0 overflow-y-auto">
            <p className="mt-0.5 text-[14px] leading-snug overlay-text-primary break-words">{card.text}</p>
        </div>
        <button
            type="button"
            onClick={onAskMore}
            className="no-drag mt-1 shrink-0 self-start text-[11px] font-medium overlay-text-secondary underline-offset-2 hover:underline hover:text-[var(--overlay-text-primary)]"
        >
            Ask more
        </button>
    </motion.aside>
);

export default ProactiveCard;
