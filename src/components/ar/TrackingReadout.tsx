/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Tester-only tracking readout for the phone engine comparison: which face
 * engine runs (and why it fell back), whether the composite is frame-locked
 * (and why), detections/s, and RAW pose jitter over the last ~2s. Renders
 * NOTHING unless the URL carries `?faceEngine=…`, `?framelock=…` or
 * `?trackdebug` (or this tab remembered an override), and never on a legacy
 * single-event build.
 *
 * Safe beside the booth by construction: plain DOM, `pointer-events-none`
 * (taps pass through to the shutter), and captures never include it — the
 * photo is drawn by StageCanvas.capturePhoto onto an OFFSCREEN canvas from the
 * video + shader + 3D canvases only, and a video is captureStream() of that
 * preview canvas; neither reads the DOM.
 */
import { useEffect, useState, useSyncExternalStore } from 'react';
import {
  IS_LEGACY_BUILD,
  extraFaceSlotCount,
  getActiveFaceEngineInfo,
  getExtraFaces,
  subscribeFaceEngine,
} from '../../lib/faceEngine';
import { trackingReadoutEnabled } from '../../lib/faceEngine/engineSelect';
import { TrackingStatsRing, type TrackingStats } from '../../lib/faceEngine/trackingStats';
import { setRawPoseTap } from '../../lib/faceRig';

function readoutEnabled(): boolean {
  if (IS_LEGACY_BUILD || typeof window === 'undefined') return false;
  let store: Storage | null = null;
  try { store = window.sessionStorage; } catch { store = null; }
  return trackingReadoutEnabled(window.location.search, store);
}

const fmt = (v: number | null, digits: number) => (v === null ? '—' : v.toFixed(digits));

export default function TrackingReadout() {
  const [enabled] = useState(readoutEnabled);
  const info = useSyncExternalStore(subscribeFaceEngine, getActiveFaceEngineInfo, getActiveFaceEngineInfo);
  const [stats, setStats] = useState<TrackingStats | null>(null);
  /** Multi-face: [faces tracked now, max] — null when the engine tracks one face only. */
  const [faces, setFaces] = useState<[number, number] | null>(null);

  // Fresh numbers per engine: an engine switch restarts the window, so a
  // reading never mixes two engines' samples.
  useEffect(() => {
    if (!enabled) return;
    const ring = new TrackingStatsRing();
    setRawPoseTap((s, pos, quat) => {
      ring.markDetection(s.t);
      if (pos !== null && quat !== null) ring.pushPose(s.t, pos.x, pos.y, pos.z, quat.x, quat.y, quat.z, quat.w);
    });
    setStats(null);
    const id = window.setInterval(() => {
      const now = performance.now();
      const st = ring.stats(now);
      setStats(st);
      const slots = extraFaceSlotCount();
      // The primary counts while it produced a sample in the last second.
      const extras = getExtraFaces().filter((e) => now - e.t < 1000).length;
      setFaces(slots === 0 ? null : [(st.detectionsPerSec ?? 0) > 0 ? 1 + extras : 0, slots + 1]);
    }, 500);
    return () => {
      window.clearInterval(id);
      setRawPoseTap(null);
    };
  }, [enabled, info.active]);

  if (!enabled) return null;

  const active = info.active ?? (info.failed ? 'none' : 'loading');
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed left-2 z-[70] max-w-[calc(100vw-1rem)] rounded-lg glass px-2 py-1 font-label text-[10px] leading-tight text-brand-fg"
      style={{ top: 'max(0.5rem, env(safe-area-inset-top))' }}
    >
      <div>
        face: <b>{active}</b>
        {info.requested !== info.active && <span className="text-brand-muted"> (asked {info.requested})</span>}
      </div>
      {info.fellBack && (
        <div className="text-brand-muted">fell back: {info.reason ?? 'unknown'}</div>
      )}
      <div>
        frame-lock: <b>{info.frameLock ? 'on' : 'off'}</b>
        <span className="text-brand-muted"> ({info.frameLockSource})</span>
      </div>
      {info.error !== null && <div className="text-brand-muted">error: {info.error}</div>}
      {faces !== null && <div className="tabular-nums">faces: <b>{faces[0]}</b>/{faces[1]}</div>}
      <div className="tabular-nums">
        {fmt(stats?.detectionsPerSec ?? null, 1)} det/s · pos ±{fmt(stats?.posJitterCm ?? null, 2)} cm · rot ±{fmt(stats?.rotJitterDeg ?? null, 2)}°
      </div>
    </div>
  );
}
