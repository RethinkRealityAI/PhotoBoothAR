/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * wallHooks — the browser-facing half of surviving six unattended hours on a
 * venue projector. Every decision these hooks feed lives in lib/wallRuntime.ts
 * where it is pure and tested; what is left here is only the wiring to APIs a
 * node test environment does not have.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { wallScale } from '../../lib/wallRuntime';

/* ------------------------------------------------------------------ */
/* Page visibility                                                      */
/* ------------------------------------------------------------------ */

/**
 * Whether the wall is actually on screen.
 *
 * Nothing on the wall observed this before: the poll, the slideshow, the
 * spotlight, the challenge ticker and the leaderboard all kept intervals
 * running while the tab was hidden. Browsers throttle those intervals rather
 * than stopping them, so a projector laptop that slept for ten minutes came
 * back and fired every backed-up timer at once.
 */
export function usePageVisible(): boolean {
  const [visible, setVisible] = useState(
    () => typeof document === 'undefined' || document.visibilityState !== 'hidden',
  );
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const onChange = () => setVisible(document.visibilityState !== 'hidden');
    document.addEventListener('visibilitychange', onChange);
    return () => document.removeEventListener('visibilitychange', onChange);
  }, []);
  return visible;
}

/* ------------------------------------------------------------------ */
/* Screen wake lock                                                     */
/* ------------------------------------------------------------------ */

interface WakeLockSentinelLike {
  released?: boolean;
  release: () => Promise<void>;
  addEventListener?: (type: 'release', cb: () => void) => void;
}
interface WakeLockLike {
  request: (type: 'screen') => Promise<WakeLockSentinelLike>;
}

function wakeLockApi(): WakeLockLike | null {
  if (typeof navigator === 'undefined') return null;
  const wl = (navigator as Navigator & { wakeLock?: unknown }).wakeLock;
  if (wl === null || wl === undefined || typeof wl !== 'object') return null;
  const req = (wl as { request?: unknown }).request;
  return typeof req === 'function' ? (wl as WakeLockLike) : null;
}

/**
 * Keep the screen awake while the wall is showing.
 *
 * A projector laptop with default power settings sleeps mid-gala and the wall
 * is simply gone. The lock is dropped by the browser whenever the page is
 * hidden, so it has to be re-acquired on every visibilitychange — that dance
 * is the whole reason this is a hook and not a one-liner. Unsupported
 * browsers (Safari < 16.4, most embedded signage) silently do nothing.
 */
export function useWakeLock(enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return;
    const api = wakeLockApi();
    if (api === null) return; // no support — nothing to do, and nothing to warn about

    let cancelled = false;
    let sentinel: WakeLockSentinelLike | null = null;

    const acquire = async () => {
      if (cancelled) return;
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      if (sentinel !== null && sentinel.released !== true) return;
      try {
        sentinel = await api.request('screen');
        // The browser can drop the lock on its own (power policy, focus loss).
        sentinel.addEventListener?.('release', () => { sentinel = null; });
      } catch {
        // Denied (not user-activated, battery saver, insecure context) — the
        // wall still works, it just cannot promise the screen stays on.
        sentinel = null;
      }
    };

    const onVisibility = () => {
      if (document.visibilityState === 'visible') void acquire();
    };

    void acquire();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisibility);
      void sentinel?.release().catch(() => { /* already released */ });
      sentinel = null;
    };
  }, [enabled]);
}

/* ------------------------------------------------------------------ */
/* Viewport + scale                                                     */
/* ------------------------------------------------------------------ */

export interface WallViewport {
  width: number;
  height: number;
  /** Multiplier every wall type size is expressed in — see wallRuntime.wallScale. */
  scale: number;
}

/** Live viewport size plus the legibility scale for it. */
export function useWallViewport(projection: boolean): WallViewport {
  const read = useCallback((): { width: number; height: number } => {
    if (typeof window === 'undefined') return { width: 1440, height: 900 };
    return { width: window.innerWidth, height: window.innerHeight };
  }, []);

  const [size, setSize] = useState(read);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    let frame = 0;
    const onResize = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => setSize(read()));
    };
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', onResize);
    onResize();
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('orientationchange', onResize);
    };
  }, [read]);

  return {
    width: size.width,
    height: size.height,
    scale: wallScale(size.width, size.height, projection),
  };
}

/* ------------------------------------------------------------------ */
/* Reduced motion                                                       */
/* ------------------------------------------------------------------ */

/** Live `prefers-reduced-motion: reduce`. Every animation added in this wave
 *  reads it rather than assuming it once at mount. */
export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  });
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = () => setReduced(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return reduced;
}

/* ------------------------------------------------------------------ */
/* GPU availability                                                     */
/* ------------------------------------------------------------------ */

/**
 * Probe for a WebGL context BEFORE deciding to run a particle ceremony.
 *
 * ParticleBeam does the same check internally, but it answers by rendering
 * null and calling `onDone` — correct for the landing page, where a WAAPI
 * clone carries the visual, and wrong here, where it would mean an arrival
 * with no ceremony at all. Checking first lets the wall choose the classic
 * BeamIn instead. (Deliberate ~8-line twin of ParticleBeam's private
 * `webglAvailable`; exporting from that file would have meant editing a
 * component the marketing page also renders.)
 */
export function canUseWebgl(): boolean {
  if (typeof document === 'undefined') return false;
  try {
    const probe = document.createElement('canvas');
    return (probe.getContext('webgl2') ?? probe.getContext('webgl')) !== null;
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------ */
/* Burn-in drift                                                        */
/* ------------------------------------------------------------------ */

/**
 * A monotonically increasing "seconds since mount", sampled slowly.
 *
 * The persistent header, footer and QR chip are high-contrast and never move,
 * which over a six-hour projection is exactly how you etch a panel. Feeding
 * this into wallRuntime.burnInOffset drifts them a few pixels on a ~3.5 minute
 * cycle. Sampled at 4 s (not per frame) because the whole point is that it is
 * too slow to notice — a rAF loop would cost more than the effect is worth.
 */
export function useSlowClock(active: boolean, sampleMs = 4000): number {
  const [seconds, setSeconds] = useState(0);
  const startRef = useRef<number>(Date.now());
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => {
      setSeconds((Date.now() - startRef.current) / 1000);
    }, sampleMs);
    return () => clearInterval(id);
  }, [active, sampleMs]);
  return seconds;
}
