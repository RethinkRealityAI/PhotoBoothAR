/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * CropStage — interactive 9:16 preview of an uploaded image inside the chosen
 * frame. Drag to pan, wheel/pinch-zoom to zoom. The CSS transform here mirrors
 * `computeCropRect` exactly, so what you see is what gets baked by
 * `compositeUpload` at post time.
 */
import { useCallback, useLayoutEffect, useRef, useState, PointerEvent, WheelEvent } from 'react';
import { computeCropRect, FRAME_W, FRAME_H, UploadCrop } from '../booth/capture';

export const MIN_ZOOM = 1;
export const MAX_ZOOM = 4;

/** Clamp pan offsets so the (cover-fit, zoomed) image never reveals an edge. */
export function clampCrop(crop: UploadCrop, imgW: number, imgH: number): UploadCrop {
  const r = computeCropRect(imgW, imgH, FRAME_W, FRAME_H, crop.zoom, 0, 0);
  const maxX = Math.max(0, (r.w - FRAME_W) / 2 / FRAME_W);
  const maxY = Math.max(0, (r.h - FRAME_H) / 2 / FRAME_H);
  return {
    ...crop,
    offsetX: Math.max(-maxX, Math.min(maxX, crop.offsetX)),
    offsetY: Math.max(-maxY, Math.min(maxY, crop.offsetY)),
  };
}

interface Props {
  srcUrl: string;
  imgW: number;
  imgH: number;
  frameUrl: string | null;
  crop: UploadCrop;
  onChange: (crop: UploadCrop) => void;
}

export default function CropStage({ srcUrl, imgW, imgH, frameUrl, crop, onChange }: Props) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  const drag = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);

  useLayoutEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const measure = () => setBox({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Dest rect in canvas units, then scaled to the on-screen box (both 9:16).
  const rect = computeCropRect(imgW || 1, imgH || 1, FRAME_W, FRAME_H, crop.zoom, crop.offsetX, crop.offsetY);
  const sx = box.w / FRAME_W;
  const sy = box.h / FRAME_H;

  const onPointerDown = useCallback(
    (e: PointerEvent) => {
      (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
      drag.current = { x: e.clientX, y: e.clientY, ox: crop.offsetX, oy: crop.offsetY };
    },
    [crop.offsetX, crop.offsetY],
  );

  const onPointerMove = useCallback(
    (e: PointerEvent) => {
      if (!drag.current || !box.w) return;
      const dx = (e.clientX - drag.current.x) / box.w;
      const dy = (e.clientY - drag.current.y) / box.h;
      onChange(
        clampCrop(
          { ...crop, offsetX: drag.current.ox + dx, offsetY: drag.current.oy + dy },
          imgW,
          imgH,
        ),
      );
    },
    [box.w, box.h, crop, imgW, imgH, onChange],
  );

  const endDrag = useCallback(() => {
    drag.current = null;
  }, []);

  const onWheel = useCallback(
    (e: WheelEvent) => {
      e.preventDefault();
      const next = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, crop.zoom * (e.deltaY < 0 ? 1.08 : 0.92)));
      onChange(clampCrop({ ...crop, zoom: next }, imgW, imgH));
    },
    [crop, imgW, imgH, onChange],
  );

  return (
    <div
      ref={boxRef}
      className="relative mx-auto h-full max-h-full aspect-[9/16] overflow-hidden rounded-2xl bg-noir-900 shadow-2xl select-none touch-none"
      style={{ border: '1px solid rgba(var(--accent-rgb),0.25)' }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onWheel={onWheel}
    >
      {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions */}
      <img
        src={srcUrl}
        alt=""
        draggable={false}
        className="absolute will-change-transform cursor-grab active:cursor-grabbing"
        style={{
          left: rect.x * sx,
          top: rect.y * sy,
          width: rect.w * sx,
          height: rect.h * sy,
          transform: crop.rotation ? `rotate(${crop.rotation}deg)` : undefined,
          transformOrigin: 'center center',
        }}
      />
      {frameUrl && (
        <img
          src={frameUrl}
          alt=""
          aria-hidden
          className="absolute inset-0 w-full h-full pointer-events-none"
        />
      )}
      {/* subtle grid guide while interacting */}
      <div className="absolute inset-0 pointer-events-none opacity-0 hover:opacity-100 transition-opacity">
        <div className="absolute inset-y-0 left-1/3 w-px bg-white/10" />
        <div className="absolute inset-y-0 left-2/3 w-px bg-white/10" />
        <div className="absolute inset-x-0 top-1/3 h-px bg-white/10" />
        <div className="absolute inset-x-0 top-2/3 h-px bg-white/10" />
      </div>
    </div>
  );
}
