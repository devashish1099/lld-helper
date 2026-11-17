import { useRef } from 'react';

/**
 * Drag handle that resizes an adjacent panel. `direction` is the axis being resized;
 * `invert` flips the delta for panels that sit right of / below the handle.
 */
export function Splitter({
  direction,
  value,
  min,
  max,
  invert = false,
  onChange,
  onDoubleClick,
}: {
  direction: 'horizontal' | 'vertical';
  value: number;
  min: number;
  max: number;
  invert?: boolean;
  onChange: (v: number) => void;
  onDoubleClick?: () => void;
}) {
  const start = useRef<{ pos: number; value: number } | null>(null);
  const horizontal = direction === 'horizontal';

  const onPointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    start.current = { pos: horizontal ? e.clientX : e.clientY, value };
    document.body.style.cursor = horizontal ? 'col-resize' : 'row-resize';
    document.body.style.userSelect = 'none';
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!start.current) return;
    const delta = (horizontal ? e.clientX : e.clientY) - start.current.pos;
    onChange(Math.round(Math.min(max, Math.max(min, start.current.value + (invert ? -delta : delta)))));
  };
  const onPointerUp = () => {
    start.current = null;
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  };

  return (
    <div
      role="separator"
      aria-orientation={horizontal ? 'vertical' : 'horizontal'}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onDoubleClick={onDoubleClick}
      className={`relative z-10 shrink-0 bg-line transition-colors hover:bg-accent active:bg-accent ${
        horizontal ? 'w-px cursor-col-resize before:absolute before:inset-y-0 before:-left-1 before:-right-1' : 'h-px cursor-row-resize before:absolute before:inset-x-0 before:-top-1 before:-bottom-1'
      } before:content-['']`}
    />
  );
}
