import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from 'react-query';
import { useMainEvent } from '../../hooks/useMainEvent';

interface ResizableSplitterProps {
  position: number;
  onPositionChange: (position: number) => void;
  /** Double-click restores the default split. */
  onReset?: () => void;
  min?: number;
  max?: number;
  orientation?: 'vertical' | 'horizontal';
}

const ResizableSplitter: React.FC<ResizableSplitterProps> = ({
  position,
  onPositionChange,
  onReset,
  min = 20,
  max = 80,
  orientation = 'vertical',
}) => {
  const [isDragging, setIsDragging] = useState(false);
  const splitterRef = useRef<HTMLDivElement>(null);
  const priorPassthroughRef = useRef<boolean>(false);
  const queryClient = useQueryClient();

  const { data: passthrough = false } = useQuery<boolean>(
    ['overlay-mouse-passthrough'],
    () => window.electronAPI?.getOverlayMousePassthrough?.() ?? Promise.resolve(false)
  );

  useMainEvent(
    window.electronAPI?.onOverlayMousePassthroughChanged,
    (val: boolean) => {
      queryClient.setQueryData(['overlay-mouse-passthrough'], val);
    }
  );

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    const step = e.shiftKey ? 10 : 2;
    const back = orientation === 'horizontal' ? 'ArrowUp' : 'ArrowLeft';
    const forward = orientation === 'horizontal' ? 'ArrowDown' : 'ArrowRight';
    if (e.key !== back && e.key !== forward) return;
    e.preventDefault();
    onPositionChange(Math.min(max, Math.max(min, position + (e.key === forward ? step : -step))));
  }, [max, min, onPositionChange, orientation, position]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    // Save cached passthrough state before disabling for drag
    priorPassthroughRef.current = queryClient.getQueryData<boolean>(['overlay-mouse-passthrough']) ?? passthrough;
    window.electronAPI?.setOverlayMousePassthrough?.(false);
    setIsDragging(true);
  }, [passthrough, queryClient]);

  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      const parent = splitterRef.current?.parentElement;
      if (!parent) return;
      const rect = parent.getBoundingClientRect();
      const pct = orientation === 'horizontal'
        ? ((e.clientY - rect.top) / rect.height) * 100
        : ((e.clientX - rect.left) / rect.width) * 100;
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

  const isHorizontal = orientation === 'horizontal';
  return (
    <div
      ref={splitterRef}
      onMouseDown={handleMouseDown}
      onDoubleClick={onReset}
      onKeyDown={handleKeyDown}
      role="separator"
      tabIndex={0}
      aria-orientation={orientation === 'horizontal' ? 'horizontal' : 'vertical'}
      aria-valuenow={Math.round(position)}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-label="Resize transcript and answer"
      className={`no-drag relative flex-shrink-0 group ${isHorizontal ? 'h-1.5 cursor-row-resize' : 'w-1.5 cursor-col-resize'} ${isDragging ? 'z-50' : ''}`}
    >
      <div
        className={`absolute transition-colors ${
          isHorizontal
            ? 'top-1/2 -translate-y-1/2 left-0 right-0 h-px'
            : 'left-1/2 -translate-x-1/2 top-0 bottom-0 w-px'
        } ${
          isDragging
            ? 'bg-accent-primary shadow-[0_0_6px_rgba(59,130,246,0.5)]'
            : 'bg-[var(--overlay-border-soft)] group-hover:bg-[var(--overlay-border)]'
        }`}
      />
    </div>
  );
};

export default ResizableSplitter;
