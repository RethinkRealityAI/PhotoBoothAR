/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * TrackingReadout — live numbers for the tracking pipeline, for the phone in
 * the owner's hand: how long each inference takes, how stale the pose being
 * drawn is, whether a face / how many hands are held. Mounted only behind
 * `?debug=tracking` (the `?debug=occluder` idiom), so it costs nothing and
 * shows nothing to a guest. Reads the module stats every 250ms; no per-frame
 * React work.
 */
import { useEffect, useState } from 'react';
import { faceTrackingStats } from '../../lib/faceRig';
import { handTrackingStats } from '../../lib/handRig';

export function trackingDebugRequested(search: string): boolean {
  return new URLSearchParams(search).get('debug') === 'tracking';
}

interface Readout {
  fps: number;
  faceMs: number;
  ageMs: number;
  hasFace: boolean;
  handMs: number;
  hands: number;
  handScale: number;
}

export default function TrackingReadout({ className = '' }: { className?: string }) {
  const [r, setR] = useState<Readout | null>(null);
  // Self-gating on the URL, so any surface can mount this unconditionally and
  // pay nothing unless the owner asked for the numbers.
  const enabled = typeof window !== 'undefined' && trackingDebugRequested(window.location.search);
  useEffect(() => {
    if (!enabled) return;
    let frames = 0;
    let raf = 0;
    let lastTick = performance.now();
    let fps = 0;
    const count = () => { frames++; raf = requestAnimationFrame(count); };
    raf = requestAnimationFrame(count);
    const id = window.setInterval(() => {
      const now = performance.now();
      fps = (frames * 1000) / Math.max(1, now - lastTick);
      frames = 0;
      lastTick = now;
      const f = faceTrackingStats();
      const h = handTrackingStats();
      setR({ fps, faceMs: f.inferMs, ageMs: f.ageMs, hasFace: f.hasFace, handMs: h.inferMs, hands: h.hands, handScale: h.scale });
    }, 250);
    return () => { window.clearInterval(id); cancelAnimationFrame(raf); };
  }, [enabled]);
  if (!enabled || r === null) return null;
  const n = (v: number, d = 0) => (Number.isFinite(v) ? v.toFixed(d) : '—');
  return (
    <div
      data-testid="tracking-readout"
      className={`pointer-events-none select-none rounded-lg liquid-glass px-2.5 py-1.5 font-mono text-[10px] leading-4 text-brand-fg/90 ${className}`}
    >
      <div>render {n(r.fps)} fps</div>
      <div>face {r.hasFace ? 'held' : 'none'} · infer {n(r.faceMs)} ms · age {n(r.ageMs)} ms</div>
      <div>hands {r.hands} · infer {n(r.handMs)} ms · size ×{n(r.handScale, 2)}</div>
    </div>
  );
}
