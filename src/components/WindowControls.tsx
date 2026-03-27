import React, { useState, useEffect } from 'react';
import { Minus, X } from 'lucide-react';
import { isMac } from '../utils/platformUtils';

/**
 * WindowControls — Custom minimize / maximize / close buttons.
 * Returns null immediately on macOS (native traffic lights are used there).
 * The null-return is at the TOP, before any hooks, satisfying React's rules.
 */
const WindowControls: React.FC = () => {
  // Return null early if on macOS — BEFORE any hooks would be called.
  // NOTE: isMac is a module-level constant evaluated once at module load, so it
  // is safe to use as an early-return guard (same value every render, no hook).
  if (isMac) return null;

  // Hooks — only reachable on Windows / Linux
  const [isMaximized, setIsMaximized] = useState(false);

  useEffect(() => {
    let active = true;

    // Query initial maximized state (e.g. app reopened while maximized)
    window.electronAPI?.windowIsMaximized().then((maximized: boolean) => {
      if (active) setIsMaximized(maximized);
    }).catch(() => {});

    const unsubscribe = window.electronAPI?.onWindowMaximizedChanged((maximized: boolean) => {
      setIsMaximized(maximized);
    });

    return () => {
      active = false;
      unsubscribe?.();
    };
  }, []);

  const handleMinimize = () => window.electronAPI?.windowMinimize();
  const handleMaximize = () => window.electronAPI?.windowMaximize();
  const handleClose = () => window.electronAPI?.windowClose();

  return (
    <div className="flex h-[40px]">
      <button
        onClick={handleMinimize}
        className="flex items-center justify-center w-[46px] h-full border-0 bg-transparent text-text-secondary hover:text-text-primary hover:bg-white/10 transition-colors duration-100"
        title="Minimize"
      >
        <Minus size={16} strokeWidth={1.5} />
      </button>
      <button
        onClick={handleMaximize}
        className="flex items-center justify-center w-[46px] h-full border-0 bg-transparent text-text-secondary hover:text-text-primary hover:bg-white/10 transition-colors duration-100"
        title={isMaximized ? 'Restore' : 'Maximize'}
      >
        {isMaximized ? (
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
            <rect x="5" y="3" width="8" height="8" rx="0.5" />
            <path d="M3 5V11C3 11.5523 3.44772 12 4 12H10" />
          </svg>
        ) : (
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
            <rect x="3.5" y="3.5" width="9" height="9" rx="0.5" />
          </svg>
        )}
      </button>
      <button
        onClick={handleClose}
        className="flex items-center justify-center w-[46px] h-full border-0 bg-transparent text-text-secondary hover:text-white hover:bg-red-500 transition-colors duration-100"
        title="Close"
      >
        <X size={16} strokeWidth={1.5} />
      </button>
    </div>
  );
};

export default WindowControls;
