/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Fit a full-bleed photo: drag to choose what stays in view, zoom in, and see
 * it in the two shapes it will be shown in (a phone and a big screen) at once.
 * Writes `{ x, y, zoom }` (sceneThemes.SceneImageFit) — the same numbers the
 * guest page applies, so what the host frames here is what guests get.
 */
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { Move, RotateCcw, ZoomIn } from 'lucide-react';
import type { SceneImageFit } from '../../../lib/sceneThemes';

const DEFAULT_FIT: SceneImageFit = { x: 50, y: 50, zoom: 1 };
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

function FramedImage({ url, fit, className }: { url: string; fit: SceneImageFit; className: string }) {
  return (
    <div className={`relative overflow-hidden ${className}`}>
      <img
        src={url}
        alt=""
        draggable={false}
        className="absolute inset-0 h-full w-full object-cover"
        style={{
          objectPosition: `${fit.x}% ${fit.y}%`,
          transform: fit.zoom !== 1 ? `scale(${fit.zoom})` : undefined,
          transformOrigin: `${fit.x}% ${fit.y}%`,
        }}
      />
    </div>
  );
}

export default function ImageFitTool({ url, fit, onChange }: {
  url: string;
  fit: SceneImageFit | undefined;
  onChange: (fit: SceneImageFit) => void;
}) {
  const f = fit ?? DEFAULT_FIT;
  const boxRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; fit: SceneImageFit } | null>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);

  useEffect(() => {
    const img = new Image();
    img.onload = () => setSize({ w: img.naturalWidth, h: img.naturalHeight });
    img.src = url;
  }, [url]);

  const onDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, fit: f };
  };
  const onMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    const box = boxRef.current?.getBoundingClientRect();
    if (!d || !box) return;
    // Dragging the photo right brings its left side into view (focal x down).
    const k = 100 / d.fit.zoom;
    onChange({
      ...d.fit,
      x: clamp(Math.round(d.fit.x - ((e.clientX - d.x) / box.width) * k), 0, 100),
      y: clamp(Math.round(d.fit.y - ((e.clientY - d.y) / box.height) * k), 0, 100),
    });
  };
  const onUp = () => { drag.current = null; };
  const nudge = (dx: number, dy: number) => onChange({ ...f, x: clamp(f.x + dx, 0, 100), y: clamp(f.y + dy, 0, 100) });

  const small = size !== null && Math.max(size.w, size.h) < 1600;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex gap-4 items-end">
        <div
          ref={boxRef}
          className="wz-fit w-[148px] sm:w-[170px] shrink-0 rounded-[22px] overflow-hidden aspect-[9/16] focus-visible:outline-2 focus-visible:outline-white"
          role="slider"
          tabIndex={0}
          aria-label="Photo position. Drag, or use the arrow keys."
          aria-valuetext={`${Math.round(f.x)}% across, ${Math.round(f.y)}% down`}
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={onUp}
          onKeyDown={(e) => {
            const step = e.shiftKey ? 10 : 3;
            if (e.key === 'ArrowLeft') { e.preventDefault(); nudge(-step, 0); }
            if (e.key === 'ArrowRight') { e.preventDefault(); nudge(step, 0); }
            if (e.key === 'ArrowUp') { e.preventDefault(); nudge(0, -step); }
            if (e.key === 'ArrowDown') { e.preventDefault(); nudge(0, step); }
          }}
        >
          <FramedImage url={url} fit={f} className="h-full w-full" />
          <div className="wz-fit-guide rounded-[22px]" aria-hidden />
          <span className="pointer-events-none absolute bottom-2 left-1/2 -translate-x-1/2 inline-flex items-center gap-1 rounded-full bg-black/45 px-2.5 py-1 text-[11.5px] text-white">
            <Move className="h-3 w-3" aria-hidden /> Drag
          </span>
        </div>
        <div className="min-w-0 flex-1 flex flex-col gap-2">
          <p className="text-[12px] text-white/70">Big screen</p>
          <FramedImage url={url} fit={f} className="w-full aspect-video rounded-[12px] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.3)]" />
          <p className="text-[12px] text-white/60 leading-snug">The big screen shows more of the sides. Keep faces and words near the middle.</p>
        </div>
      </div>
      <div className="flex items-center gap-3">
        <ZoomIn className="h-4 w-4 text-white/75 shrink-0" aria-hidden />
        <label className="sr-only" htmlFor="wz-zoom">Zoom</label>
        <input
          id="wz-zoom"
          type="range"
          min={1}
          max={3}
          step={0.05}
          value={f.zoom}
          onChange={(e) => onChange({ ...f, zoom: Number(e.target.value) })}
          className="flex-1 accent-white"
        />
        <button
          type="button"
          onClick={() => onChange(DEFAULT_FIT)}
          className="pressable inline-flex items-center gap-1.5 rounded-full px-3 min-h-10 text-[13px] liquid-glass-raised"
        >
          <RotateCcw className="h-3.5 w-3.5" aria-hidden /> Reset
        </button>
      </div>
      {size && (
        <p className={`text-[12.5px] ${small ? 'text-[#FFE1A8]' : 'text-white/60'}`}>
          {size.w} × {size.h} px.{' '}
          {small ? 'This photo is on the small side and may look soft on a big screen.' : 'Looks sharp.'}
        </p>
      )}
    </div>
  );
}
