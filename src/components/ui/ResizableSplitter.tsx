import React, { useCallback, useEffect, useRef, useState } from 'react';

interface ResizableSplitterProps {
  position: number;
  onPositionChange: (position: number) => void;
  min?: number;
  max?: number;
  orientation?: 'vertical' | 'horizontal';
}

const ResizableSplitter: React.FC<ResizableSplitterProps> = ({
  position,
  onPositionChange,
  min = 20,
  max = 80,
  orientation = 'vertical',
}) => {
  const [isDragging, setIsDragging] = useState(false);
  const splitterRef = useRef<HTMLDivElement>(null);
  const priorPassthroughRef = useRef<boolean>(false);
  const passthroughCacheRef = useRef<boolean>(false);

  // Cache passthrough state so we can synchronously read it on mousedown
  useEffect(() => {
    void window.electronAPI?.getOverlayMousePassthrough?.().then((val: boolean) => {
      passthroughCacheRef.current = val;
    });
    const interval = window.setInterval(() => {
      void window.electronAPI?.getOverlayMousePassthrough?.().then((val: boolean) => {
        passthroughCacheRef.current = val;
      });
    }, 1000);
    return () => window.clearInterval(interval);
  }, []);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    // Save cached passthrough state before disabling for drag
    priorPassthroughRef.current = passthroughCacheRef.current;
    window.electronAPI?.setOverlayMousePassthrough?.(false);
    setIsDragging(true);
  }, []);

  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      const parent = splitterRef.current?.parentElement;
      if (!parent) return;
      const rect = parent.getBoundingClientRect();
      const dimension = orientation === 'horizontal' ? rect.height : rect.width;
      if (dimension <= 0) return;

      const pct = orientation === 'horizontal'
        ? ((e.clientY - rect.top) / dimension) * 100
        : ((e.clientX - rect.left) / dimension) * 100;
      onPositionChange(Math.min(max, Math.max(min, pct)));
    };

    const handleMouseUp = () => {
      setIsDragging(false);
      // Restore prior passthrough state after drag
      window.electronAPI?.setOverlayMousePassthrough?.(priorPassthroughRef.current);
    };

    document.body.classList.add('select-none');
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.body.classList.remove('select-none');
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, max, min, onPositionChange, orientation]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? 5 : 2;
    const isDecrease =
      (orientation === 'vertical' && e.key === 'ArrowLeft') ||
      (orientation === 'horizontal' && e.key === 'ArrowUp');
    const isIncrease =
      (orientation === 'vertical' && e.key === 'ArrowRight') ||
      (orientation === 'horizontal' && e.key === 'ArrowDown');

    if (!isDecrease && !isIncrease) return;

    e.preventDefault();
    onPositionChange(Math.min(max, Math.max(min, position + (isIncrease ? step : -step))));
  }, [max, min, onPositionChange, orientation, position]);

  const isHorizontal = orientation === 'horizontal';
  return (
    <div
      ref={splitterRef}
      role="separator"
      aria-label={isHorizontal ? 'Resize panes vertically' : 'Resize Live Transcript and AI Chat panes'}
      aria-orientation={isHorizontal ? 'horizontal' : 'vertical'}
      aria-valuemin={Math.round(min)}
      aria-valuemax={Math.round(max)}
      aria-valuenow={Math.round(position)}
      tabIndex={0}
      onMouseDown={handleMouseDown}
      onKeyDown={handleKeyDown}
      className={`relative flex-shrink-0 group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-primary/70 ${isHorizontal ? 'h-2.5 cursor-row-resize' : 'w-2.5 cursor-col-resize'} ${isDragging ? 'z-50' : ''}`}
    >
      <div
        className={`absolute rounded-full transition-all duration-150 ${
          isHorizontal
            ? 'left-3 right-3 top-1/2 h-1 -translate-y-1/2'
            : 'bottom-3 top-3 left-1/2 w-1 -translate-x-1/2'
        } ${
          isDragging
            ? 'bg-accent-primary shadow-[0_0_8px_rgba(59,130,246,0.6)]'
            : 'bg-border-subtle group-hover:bg-accent-primary/70 group-focus-visible:bg-accent-primary/70'
        }`}
      />
    </div>
  );
};

export default ResizableSplitter;
