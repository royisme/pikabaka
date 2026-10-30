import React from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Minus, X } from 'lucide-react';
import { isMac } from '../utils/platformUtils';
import { useMainEvent } from '../hooks/useMainEvent';

/**
 * WindowControls — Custom minimize / maximize / close buttons.
 * macOS draws native traffic lights, so the buttons are routed away in a hook-free wrapper and the
 * component that owns the hooks stays unconditional.
 */
const WindowControls: React.FC = () => (isMac ? null : <WindowControlButtons />);

const WindowControlButtons: React.FC = () => {
  const queryClient = useQueryClient();
  const { data: isMaximized = false } = useQuery<boolean>({ queryKey: ['window-maximized'], queryFn: () => window.electronAPI?.windowIsMaximized() ?? Promise.resolve(false) });

  useMainEvent(window.electronAPI?.onWindowMaximizedChanged, (maximized: boolean) => {
    queryClient.setQueryData(['window-maximized'], maximized);
  });

  const handleMinimize = () => window.electronAPI?.windowMinimize();
  const handleMaximize = () => window.electronAPI?.windowMaximize();
  const handleClose = () => window.electronAPI?.windowClose();

  return (
    <div className="flex h-[40px]">
      <button
        onClick={handleMinimize}
        className="flex items-center justify-center w-[46px] h-full border-0 bg-transparent text-text-secondary hover:text-text-primary hover:bg-white/10 transition-colors duration-100"
        title="Minimize"
        aria-label="Minimize window"
      >
        <Minus size={16} strokeWidth={1.5} />
      </button>
      <button
        onClick={handleMaximize}
        className="flex items-center justify-center w-[46px] h-full border-0 bg-transparent text-text-secondary hover:text-text-primary hover:bg-white/10 transition-colors duration-100"
        title={isMaximized ? 'Restore' : 'Maximize'}
        aria-label={isMaximized ? 'Restore window' : 'Maximize window'}
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
        className="flex items-center justify-center w-[46px] h-full border-0 bg-transparent text-text-secondary hover:text-white hover:bg-state-danger transition-colors duration-100"
        title="Close"
        aria-label="Close window"
      >
        <X size={16} strokeWidth={1.5} />
      </button>
    </div>
  );
};

export default WindowControls;
