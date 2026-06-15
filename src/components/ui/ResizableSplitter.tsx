import React, { useCallback, useEffect, useRef, useState } from 'react';

interface ResizableSplitterProps {
  position: number;
  onPositionChange: (position: number) => void;
  min?: number;
  max?: number;
  orientation?: 'vertical' | 'horizontal';
}

const ResizableSplitter: React.FC<ResizableSplitterProps> = ({
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

  const isHorizontal = orientation === 'horizontal';
  return (
    <div
      ref={splitterRef}
      onMouseDown={handleMouseDown}
      className={`relative flex-shrink-0 group ${isHorizontal ? 'h-1.5 cursor-row-resize' : 'w-1.5 cursor-col-resize'} ${isDragging ? 'z-50' : ''}`}
    >
      <div
        className={`absolute transition-colors ${
          isHorizontal
            ? 'top-1/2 -translate-y-1/2 left-0 right-0 h-px'
            : 'left-1/2 -translate-x-1/2 top-0 bottom-0 w-px'
        } ${
          isDragging
            ? 'bg-accent-primary shadow-[0_0_6px_rgba(59,130,246,0.5)]'
            : 'bg-border-subtle group-hover:bg-accent-primary/60'
        }`}
      />
    </div>
  );
};

export default ResizableSplitter;
