/**
 * Drag-to-position control for 2D overlay/border.
 * Renders on top of the live feed; drag to update x/y (% of frame).
 * Also shows a compact scale slider and rotation input.
 */
import { useRef, useCallback } from 'react';
import { Transform2D } from '../../types';
import { RotateCw, ZoomIn } from 'lucide-react';

interface Props {
  transform: Transform2D;
  onChange: (t: Transform2D) => void;
  containerRef: React.RefObject<HTMLDivElement | null>;
}

export default function OverlayDragHandle({ transform, onChange, containerRef }: Props) {
  const dragging = useRef(false);
  const lastPos = useRef({ x: 0, y: 0 });

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (!containerRef.current) return;
      e.currentTarget.setPointerCapture(e.pointerId);
      dragging.current = true;
      lastPos.current = { x: e.clientX, y: e.clientY };
    },
    [containerRef],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!dragging.current || !containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const dx = ((e.clientX - lastPos.current.x) / rect.width) * 100;
      const dy = ((e.clientY - lastPos.current.y) / rect.height) * 100;
      lastPos.current = { x: e.clientX, y: e.clientY };
      onChange({ ...transform, x: transform.x + dx, y: transform.y + dy });
    },
    [transform, onChange, containerRef],
  );

  const onPointerUp = useCallback((e: React.PointerEvent) => {
    e.currentTarget.releasePointerCapture(e.pointerId);
    dragging.current = false;
  }, []);

  return (
    <div
      className="absolute inset-0 z-30 touch-none"
      style={{ cursor: 'move' }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      {/* Small toolbar at bottom for scale + rotation */}
      <div
        className="absolute bottom-2 left-1/2 -translate-x-1/2 glass rounded-xl px-3 py-2 flex items-center gap-3 pointer-events-auto"
        onPointerDown={(e) => e.stopPropagation()}
      >
        {/* Scale */}
        <ZoomIn className="w-3.5 h-3.5 text-gold-400 shrink-0" />
        <input
          type="range"
          min={0.2}
          max={3}
          step={0.05}
          value={transform.scale}
          onChange={(e) => onChange({ ...transform, scale: parseFloat(e.target.value) })}
          className="w-20 accent-gold-400"
        />
        {/* Rotation */}
        <RotateCw className="w-3.5 h-3.5 text-gold-400 shrink-0 ml-1" />
        <input
          type="range"
          min={-180}
          max={180}
          step={1}
          value={transform.rotation}
          onChange={(e) => onChange({ ...transform, rotation: parseFloat(e.target.value) })}
          className="w-20 accent-gold-400"
        />
        <button
          className="font-label text-[8px] uppercase tracking-wide text-champagne/50 ml-1 hover:text-gold-400"
          onClick={() => onChange({ scale: 1, x: 0, y: 0, rotation: 0 })}
        >
          Reset
        </button>
      </div>
    </div>
  );
}
