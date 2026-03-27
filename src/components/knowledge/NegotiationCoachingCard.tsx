import { useEffect, useRef, useState } from 'react';

interface NegotiationCoachingCardProps {
  phase: {
    name: string;
    objective: string;
    suggested_lines: string[];
    warnings: string[];
    silence_strategy?: boolean;
  };
  coaching_text?: string;
  suggested_response?: string;
  warning?: string;
  showSilenceTimer?: boolean;
  onSilenceTimerEnd?: () => void;
}

export const NegotiationCoachingCard = ({
  phase,
  coaching_text,
  suggested_response,
  warning,
  showSilenceTimer,
  onSilenceTimerEnd,
}: NegotiationCoachingCardProps) => {
  const [timerSeconds, setTimerSeconds] = useState(10);
  // Use ref to avoid re-triggering timer effect when parent re-renders with new callback
  const onEndRef = useRef(onSilenceTimerEnd);
  onEndRef.current = onSilenceTimerEnd;

  useEffect(() => {
    if (!showSilenceTimer || !phase.silence_strategy) return;

    setTimerSeconds(10);
    const interval = setInterval(() => {
      setTimerSeconds((prev) => {
        if (prev <= 1) {
          clearInterval(interval);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [showSilenceTimer, phase.silence_strategy]);

  // Fire callback when timer reaches 0 — outside of state updater
  useEffect(() => {
    if (timerSeconds === 0 && showSilenceTimer && phase.silence_strategy) {
      onEndRef.current?.();
    }
  }, [timerSeconds, showSilenceTimer, phase.silence_strategy]);

  const displayWarning = warning || (phase.warnings?.length ? phase.warnings[0] : null);

  return (
    <div className="flex flex-col gap-3 rounded-lg bg-surface-2 p-4">
      {/* Header */}
      <div className="flex items-center gap-2">
        <span className="flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2.5 py-1 text-xs font-medium text-emerald-400">
          <svg className="h-3 w-3" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
          </svg>
          {phase.name}
        </span>
        {phase.silence_strategy && (
          <span className="rounded-full bg-amber-500/10 px-2 py-1 text-xs text-amber-400">
            Silence OK
          </span>
        )}
      </div>

      {/* Objective */}
      <p className="text-sm text-text-secondary">{phase.objective}</p>

      {/* Coaching text */}
      {coaching_text && (
        <p className="text-sm text-text-primary">{coaching_text}</p>
      )}

      {/* Suggested response */}
      {suggested_response && (
        <div className="rounded-lg bg-surface-3 p-3">
          <p className="mb-1 text-xs font-medium text-emerald-400">Suggested Response</p>
          <p className="text-sm text-text-primary">{suggested_response}</p>
        </div>
      )}

      {/* Alternative suggested lines */}
      {phase.suggested_lines?.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <p className="text-xs font-medium text-text-muted">Also consider:</p>
          {phase.suggested_lines.map((line, i) => (
            <p key={i} className="text-sm text-text-secondary">
              • {line}
            </p>
          ))}
        </div>
      )}

      {/* Warning */}
      {displayWarning && (
        <div className="flex items-start gap-2 rounded-lg bg-amber-500/10 p-3">
          <svg className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-400" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
          </svg>
          <p className="text-sm text-amber-400">{displayWarning}</p>
        </div>
      )}

      {/* Silence timer */}
      {showSilenceTimer && phase.silence_strategy && (
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5">
            <svg className="h-4 w-4 text-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span className="text-sm text-text-muted">
              Silence: <span className="font-mono text-text-secondary">{timerSeconds}s</span>
            </span>
          </div>
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-3">
            <div
              className="h-full bg-amber-500/30 transition-all duration-1000"
              style={{ width: `${(timerSeconds / 10) * 100}%` }}
            />
          </div>
        </div>
      )}
    </div>
  );
};
