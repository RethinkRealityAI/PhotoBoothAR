/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * PopLayer — "pop the balloons" (Pop party). A transparent layer over the
 * live balloon wall: a tap pops the balloons around it (lib/openGesture.ts
 * popAt), each bursts in its own colour, and once most of the reachable ones
 * are gone the rest float away (the opener's normal opening).
 *
 * LiveGate draws the pop itself (swell and vanish) from `poppedRef`; this
 * layer owns the hit test and the confetti burst, on one small canvas that
 * only runs while bits are in the air.
 */
import { useCallback, useEffect, useMemo, useRef, type MutableRefObject } from 'react';
import { livePieces } from '../../../lib/liveGates';
import { popAt, popsLeft, popTargets } from '../../../lib/openGesture';

export interface PopLayerProps {
  seed: string;
  poppedRef: MutableRefObject<Map<string, number>>;
  disabled: boolean;
  reducedMotion: boolean;
  /** Balloons still to pop before it opens (for the prompt). */
  onLeft: (left: number) => void;
  onAllPopped: () => void;
}

interface Bit {
  x: number;
  y: number;
  vx: number;
  vy: number;
  rot: number;
  spin: number;
  w: number;
  h: number;
  color: string;
  born: number;
  ring?: boolean;
}

const BIT_LIFE_MS = 900;

export default function PopLayer({ seed, poppedRef, disabled, reducedMotion, onLeft, onAllPopped }: PopLayerProps) {
  const pieces = useMemo(() => livePieces('balloons', seed), [seed]);
  const targets = useMemo(() => popTargets(pieces), [pieces]);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const bits = useRef<Bit[]>([]);
  const raf = useRef(0);
  const finished = useRef(false);

  useEffect(() => {
    onLeft(popsLeft(targets, new Set()));
  }, [targets, onLeft]);

  /** Stage point (900x1600, slice) → canvas CSS pixels. */
  const stageToCss = useCallback((x: number, y: number) => {
    const svg = svgRef.current;
    const m = svg?.getScreenCTM();
    const c = canvasRef.current?.getBoundingClientRect();
    if (!m || !c) return { x: 0, y: 0, s: 1 };
    const p = new DOMPoint(x, y).matrixTransform(m);
    return { x: p.x - c.left, y: p.y - c.top, s: m.a };
  }, []);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const r = canvas.getBoundingClientRect();
    const dpr = Math.min(1.5, window.devicePixelRatio || 1);
    if (canvas.width !== Math.round(r.width * dpr)) {
      canvas.width = Math.round(r.width * dpr);
      canvas.height = Math.round(r.height * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, r.width, r.height);
    const now = performance.now();
    bits.current = bits.current.filter((b) => now - b.born < BIT_LIFE_MS);
    for (const b of bits.current) {
      if (now < b.born) continue; // a ripple's later pops wait their beat
      const s = (now - b.born) / 1000;
      const a = 1 - (now - b.born) / BIT_LIFE_MS;
      if (b.ring) {
        ctx.globalAlpha = a * 0.8;
        ctx.strokeStyle = b.color;
        ctx.lineWidth = 3 * a + 0.5;
        ctx.beginPath();
        ctx.arc(b.x, b.y, b.w + s * 260, 0, Math.PI * 2);
        ctx.stroke();
        continue;
      }
      const x = b.x + b.vx * s;
      const y = b.y + b.vy * s + 420 * s * s;
      ctx.globalAlpha = Math.min(1, a * 1.4);
      ctx.fillStyle = b.color;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(b.rot + b.spin * s);
      ctx.fillRect(-b.w / 2, -b.h / 2, b.w, b.h);
      ctx.restore();
    }
    ctx.globalAlpha = 1;
    if (bits.current.length) raf.current = requestAnimationFrame(draw);
  }, []);

  useEffect(() => () => cancelAnimationFrame(raf.current), []);

  const onDown = useCallback(
    (e: React.PointerEvent<SVGSVGElement>) => {
      if (disabled || finished.current) return;
      const m = svgRef.current?.getScreenCTM();
      if (!m) return;
      const at = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse());
      const popped = new Set<number>();
      pieces.forEach((p, i) => {
        if (poppedRef.current.has(p.key)) popped.add(i);
      });
      const hit = popAt(pieces, popped, at);
      if (!hit.length) return;
      const now = performance.now();
      hit.forEach((i, k) => {
        // A little ripple: nearest first, the rest a beat behind.
        poppedRef.current.set(pieces[i].key, now + k * 28);
        popped.add(i);
        if (reducedMotion) return;
        const c = stageToCss(pieces[i].x, pieces[i].y);
        const color = pieces[i].color ?? '#FFFFFF';
        bits.current.push({ x: c.x, y: c.y, vx: 0, vy: 0, rot: 0, spin: 0, w: 24 * c.s * 2, h: 0, color: '#FFFFFF', born: now + k * 28, ring: true });
        for (let j = 0; j < 9; j++) {
          const a = (j / 9) * Math.PI * 2 + Math.random() * 0.6;
          const v = 140 + Math.random() * 220;
          bits.current.push({
            x: c.x,
            y: c.y,
            vx: Math.cos(a) * v,
            vy: Math.sin(a) * v - 120,
            rot: Math.random() * Math.PI,
            spin: (Math.random() - 0.5) * 12,
            w: 5 + Math.random() * 5,
            h: 3 + Math.random() * 4,
            color: j % 3 === 0 ? '#FFFFFF' : color,
            born: now + k * 28,
          });
        }
      });
      try {
        navigator.vibrate?.(hit.length > 2 ? [10, 30, 12] : 10);
      } catch {
        /* not allowed here */
      }
      cancelAnimationFrame(raf.current);
      raf.current = requestAnimationFrame(draw);
      const left = popsLeft(targets, popped);
      onLeft(left);
      if (left === 0) {
        finished.current = true;
        onAllPopped();
      }
    },
    [disabled, pieces, poppedRef, reducedMotion, stageToCss, draw, targets, onLeft, onAllPopped],
  );

  return (
    <>
      <svg
        ref={svgRef}
        viewBox="0 0 900 1600"
        preserveAspectRatio="xMidYMid slice"
        className="absolute inset-0 h-full w-full"
        style={{ touchAction: 'manipulation', cursor: disabled ? undefined : 'pointer' }}
        onPointerDown={onDown}
        aria-hidden
        data-pop-layer
      />
      <canvas ref={canvasRef} aria-hidden className="pointer-events-none absolute inset-0 h-full w-full" />
    </>
  );
}
