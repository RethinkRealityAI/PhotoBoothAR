/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * CropStage — the large, interactive 9:16 preview of an uploaded image inside
 * the chosen frame. Drag to pan, wheel/pinch to zoom, rotate with the tools.
 *
 * The image is positioned with `cropImageStyle` (percentages of the 9:16 box),
 * the exact transform `compositeUpload` bakes to the wall — so the stage is
 * truly WYSIWYG at any size, with no measuring or sub-pixel drift. Only the pan
 * gesture reads the live box size, to convert pixel drags into frame fractions.
 */
import { useCallback, useRef, useState, PointerEvent, WheelEvent } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Hand, Sparkles } from 'lucide-react';
import { computeCropRect, FRAME_W, FRAME_H, UploadCrop } from '../booth/capture';
import { cropImageStyle } from './framePreview';

export const MIN_ZOOM = 1;
export const MAX_ZOOM = 4;

/** Clamp pan offsets so the (cover-fit, zoomed) image never reveals an edge. */
export function clampCrop(crop: UploadCrop, imgW: number, imgH: number): UploadCrop {
  // Use the rotated footprint so 90°/270° turns clamp against the right extents.
  const r = computeCropRect(imgW, imgH, FRAME_W, FRAME_H, crop.zoom, 0, 0, crop.rotation);
  const quarterTurned = ((Math.round(crop.rotation / 90) % 2) + 2) % 2 === 1;
  const footW = quarterTurned ? r.h : r.w;
  const footH = quarterTurned ? r.w : r.h;
  const maxX = Math.max(0, (footW - FRAME_W) / 2 / FRAME_W);
  const maxY = Math.max(0, (footH - FRAME_H) / 2 / FRAME_H);
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
  // Single-pointer pan baseline.
  const drag = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);
  // Active pointers (for pinch) + the pinch baseline.
  const pointers = useRef<Map<number, { x: number; y: number }>>(new Map());
  const pinch = useRef<{ dist: number; zoom: number } | null>(null);
  const [active, setActive] = useState(false);
  const [touched, setTouched] = useState(false);

  const pinchDist = () => {
    const pts = [...pointers.current.values()];
    if (pts.length < 2) return 0;
    return Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
  };

  const onPointerDown = useCallback(
    (e: PointerEvent) => {
      (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
      pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      setActive(true);
      setTouched(true);
      if (pointers.current.size === 2) {
        drag.current = null;
        pinch.current = { dist: pinchDist() || 1, zoom: crop.zoom };
      } else {
        drag.current = { x: e.clientX, y: e.clientY, ox: crop.offsetX, oy: crop.offsetY };
      }
    },
    [crop.offsetX, crop.offsetY, crop.zoom],
  );

  const onPointerMove = useCallback(
    (e: PointerEvent) => {
      if (!pointers.current.has(e.pointerId)) return;
      pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

      // Two fingers → pinch zoom.
      if (pointers.current.size >= 2 && pinch.current) {
        const d = pinchDist();
        if (d > 0) {
          const next = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, pinch.current.zoom * (d / pinch.current.dist)));
          onChange(clampCrop({ ...crop, zoom: next }, imgW, imgH));
        }
        return;
      }

      // One finger → pan (convert pixel delta → fraction of the live box).
      const box = boxRef.current;
      if (!drag.current || !box) return;
      const bw = box.clientWidth || 1;
      const bh = box.clientHeight || 1;
      const dx = (e.clientX - drag.current.x) / bw;
      const dy = (e.clientY - drag.current.y) / bh;
      onChange(
        clampCrop({ ...crop, offsetX: drag.current.ox + dx, offsetY: drag.current.oy + dy }, imgW, imgH),
      );
    },
    [crop, imgW, imgH, onChange],
  );

  const endPointer = useCallback((e: PointerEvent) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
    if (pointers.current.size === 0) {
      drag.current = null;
      setActive(false);
    }
  }, []);

  const onWheel = useCallback(
    (e: WheelEvent) => {
      e.preventDefault();
      setTouched(true);
      const next = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, crop.zoom * (e.deltaY < 0 ? 1.08 : 0.92)));
      onChange(clampCrop({ ...crop, zoom: next }, imgW, imgH));
    },
    [crop, imgW, imgH, onChange],
  );

  return (
    <div
      ref={boxRef}
      className="relative mx-auto h-full max-h-full aspect-[9/16] overflow-hidden rounded-2xl bg-noir-900 select-none touch-none cursor-grab active:cursor-grabbing"
      style={{
        border: '1px solid rgba(var(--accent-rgb),0.3)',
        boxShadow: '0 24px 70px -24px rgba(0,0,0,0.85), 0 0 0 1px rgba(var(--accent-rgb),0.08)',
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endPointer}
      onPointerCancel={endPointer}
      onWheel={onWheel}
    >
      {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions */}
      <img
        src={srcUrl}
        alt=""
        draggable={false}
        className="will-change-transform"
        style={cropImageStyle(crop, imgW, imgH)}
      />
      {frameUrl && (
        <img
          src={frameUrl}
          alt=""
          aria-hidden
          className="absolute inset-0 w-full h-full pointer-events-none"
        />
      )}

      {/* Rule-of-thirds fit guides — fade in only while adjusting. */}
      <div
        className="absolute inset-0 pointer-events-none transition-opacity duration-200"
        style={{ opacity: active ? 1 : 0 }}
      >
        <div className="absolute inset-y-0 left-1/3 w-px bg-white/25" />
        <div className="absolute inset-y-0 left-2/3 w-px bg-white/25" />
        <div className="absolute inset-x-0 top-1/3 h-px bg-white/25" />
        <div className="absolute inset-x-0 top-2/3 h-px bg-white/25" />
      </div>

      {/* Sleek instruction hint — top-center, auto-dismisses on first interaction. */}
      <AnimatePresence>
        {frameUrl && !touched && (
          <motion.div
            key="hint"
            className="absolute inset-x-0 top-3 flex justify-center px-3 pointer-events-none"
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.35 }}
          >
            <div className="glass-strong rounded-full px-3 py-1.5 flex items-center gap-1.5 border border-gold-400/25 shadow-lg max-w-[92%]">
              <Hand className="w-3 h-3 text-gold-300 shrink-0" />
              <span className="font-label uppercase tracking-wide text-[8px] text-champagne/85 text-center leading-tight">
                Drag · pinch to zoom
              </span>
            </div>
          </motion.div>
        )}
        {!frameUrl && (
          <motion.div
            key="noframe"
            className="absolute inset-x-0 top-3 flex justify-center px-3 pointer-events-none"
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.35 }}
          >
            <div className="glass-strong rounded-full px-3 py-1.5 flex items-center gap-1.5 border border-gold-400/20 shadow-lg max-w-[92%]">
              <Sparkles className="w-3 h-3 text-gold-300/80 shrink-0" />
              <span className="font-label uppercase tracking-wide text-[8px] text-champagne/70 text-center leading-tight">
                Pick a frame to position it — or post as-is
              </span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
