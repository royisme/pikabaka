import React, { useCallback, useEffect, useRef, useState } from 'react';

interface ResizableSplitterProps {
  position: number;
  onPositionChange: (position: number) => void;
  min?: number;
  max?: number;
}

const ResizableSplitter: React.FC<ResizableSplitterProps> = ({
  onPositionChange,
  min = 20,
  max = 80,
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
      const pct = ((e.clientX - rect.left) / rect.width) * 100;
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
  }, [isDragging, max, min, onPositionChange]);

  return (
    <div
      ref={splitterRef}
      onMouseDown={handleMouseDown}
      className={`relative w-1.5 cursor-col-resize flex-shrink-0 group ${isDragging ? 'z-50' : ''}`}
    >
      <div
        className={`absolute left-1/2 -translate-x-1/2 top-0 bottom-0 w-px transition-colors ${
          isDragging
            ? 'bg-accent-primary shadow-[0_0_6px_rgba(59,130,246,0.5)]'
            : 'bg-border-subtle group-hover:bg-accent-primary/60'
        }`}
      />
    </div>
  );
};

export default ResizableSplitter;
