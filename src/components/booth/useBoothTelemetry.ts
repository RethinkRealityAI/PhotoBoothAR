/**
 * Booth telemetry: watches the camera, the face tracker and the guest's look
 * choices, and records what happens (lib/telemetry.ts). OBSERVE ONLY — this
 * hook never restarts, pauses or re-wires the camera; useCameraStream owns
 * that. Track listeners use addEventListener, never `onended =`, so the
 * re-acquire handler useCameraStream installs is untouched.
 *
 * Platform booths only (`enabled` = source === 'db'): legacy event builds keep
 * their behaviour exactly.
 */
import { useEffect, useRef, type RefObject } from 'react';
import {
  initialCameraWatch, stepCameraWatch, framesAdvanced, type CameraSignal,
} from '../../lib/cameraWatch';
import { reportIncident, track } from '../../lib/telemetry';
import { getActiveFaceEngineInfo, subscribeFaceEngine } from '../../lib/faceEngine';

const WATCH_EVERY_MS = 1000;
/** Consecutive frozen checks before the picture counts as frozen (~2 s). */
const FROZEN_CHECKS = 2;

export interface BoothTelemetryInput {
  enabled: boolean;
  videoRef: RefObject<HTMLVideoElement | null>;
  stream: MediaStream | null;
  ready: boolean;
  /** CameraError kind from useCameraStream, or null. */
  errorKind: string | null;
  facingMode: string;
  /** The booth is showing the live camera (not review/sending). */
  live: boolean;
  mediaMode: string;
  looks: { frame: string | null; prop: string | null; paint: string | null; effect: string | null };
}

export function useBoothTelemetry(input: BoothTelemetryInput): void {
  const { enabled, videoRef, stream, ready, errorKind, facingMode, live, mediaMode, looks } = input;
  const watch = useRef(initialCameraWatch());
  const lastFacing = useRef<string | null>(null);
  const liveRef = useRef(live);
  liveRef.current = live;
  const readyRef = useRef(ready);
  readyRef.current = ready;

  const feed = (sig: CameraSignal) => {
    const r = stepCameraWatch(watch.current, sig, Date.now());
    watch.current = r.state;
    for (const e of r.emits) {
      if (e.incident) reportIncident(e.name, { ...e.props, facing: facingMode, media: mediaMode });
      else track(e.name, e.props);
    }
  };
  const feedRef = useRef(feed);
  feedRef.current = feed;

  // Booth opened (once).
  useEffect(() => {
    if (!enabled) return;
    track('booth_opened', { media: mediaMode });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

  // Each camera stream: start/stop + its video track's own signals.
  useEffect(() => {
    if (!enabled || !stream) return;
    const tr = stream.getVideoTracks()[0] ?? null;
    let info: Record<string, string | number | boolean | null> = { facing: facingMode };
    try {
      const st = tr?.getSettings?.() ?? {};
      info = {
        facing: facingMode,
        width: st.width ?? null,
        height: st.height ?? null,
        fps: st.frameRate ?? null,
        track_state: tr?.readyState ?? null,
      };
    } catch { /* settings are best-effort */ }
    // Expected = the first stream, or a camera flip the guest asked for.
    const expected = lastFacing.current === null || lastFacing.current !== facingMode;
    lastFacing.current = facingMode;
    feedRef.current({ type: 'stream_start', expected, info });

    const onEnded = () => feedRef.current({ type: 'track_ended' });
    const onMute = () => feedRef.current({ type: 'track_muted' });
    const onUnmute = () => feedRef.current({ type: 'track_unmuted' });
    tr?.addEventListener('ended', onEnded);
    tr?.addEventListener('mute', onMute);
    tr?.addEventListener('unmute', onUnmute);
    return () => {
      tr?.removeEventListener('ended', onEnded);
      tr?.removeEventListener('mute', onMute);
      tr?.removeEventListener('unmute', onUnmute);
      feedRef.current({ type: 'stream_stop' });
    };
    // facingMode is read, not a trigger: a flip already produces a new stream.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, stream]);

  // Page visibility (the "left the tab and came back" case).
  useEffect(() => {
    if (!enabled) return;
    const onVis = () => {
      const hidden = document.visibilityState !== 'visible';
      const tr = stream?.getVideoTracks()[0];
      track(hidden ? 'booth_hidden' : 'booth_visible', {
        track_state: tr?.readyState ?? null,
        muted: tr?.muted ?? null,
      });
      feedRef.current({ type: hidden ? 'hidden' : 'visible' });
    };
    if (document.visibilityState !== 'visible') feedRef.current({ type: 'hidden' });
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [enabled, stream]);

  // Picture watchdog: is the <video> actually producing frames?
  useEffect(() => {
    if (!enabled) return;
    let prev: { frames: number | null; time: number } | null = null;
    let frozenChecks = 0;
    let blankChecks = 0;
    const id = window.setInterval(() => {
      try {
        const v = videoRef.current;
        const watching = liveRef.current && readyRef.current && document.visibilityState === 'visible';
        if (v && watching && v.srcObject) {
          const q = typeof v.getVideoPlaybackQuality === 'function' ? v.getVideoPlaybackQuality() : null;
          const cur = { frames: q ? q.totalVideoFrames : null, time: v.currentTime };
          if (framesAdvanced(prev, cur)) {
            if (frozenChecks >= FROZEN_CHECKS) feedRef.current({ type: 'frames_flowing' });
            frozenChecks = 0;
          } else if (++frozenChecks === FROZEN_CHECKS) {
            feedRef.current({ type: 'frames_stalled' });
          }
          prev = cur;
          if (v.videoWidth === 0) {
            if (++blankChecks === FROZEN_CHECKS) feedRef.current({ type: 'no_picture' });
          } else blankChecks = 0;
        } else {
          prev = null;
          frozenChecks = 0;
          blankChecks = 0;
        }
        feedRef.current({ type: 'tick' });
      } catch { /* never break the booth */ }
    }, WATCH_EVERY_MS);
    return () => window.clearInterval(id);
  }, [enabled, videoRef]);

  // Camera error screen.
  useEffect(() => {
    if (!enabled || errorKind === null) return;
    reportIncident('camera_error', { kind: errorKind, facing: facingMode });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, errorKind]);

  // Face tracker: which engine runs, fallbacks, failures.
  useEffect(() => {
    if (!enabled) return;
    let last = '';
    const onChange = () => {
      const i = getActiveFaceEngineInfo();
      const sig = `${i.active}|${i.fellBack}|${i.ready}|${i.failed}|${i.error ?? ''}`;
      if (sig === last) return;
      last = sig;
      const props = {
        requested: i.requested, active: i.active, ready: i.ready,
        fell_back: i.fellBack, reason: i.reason, failed: i.failed, error: i.error,
      };
      if (i.failed) reportIncident('tracker_failed', props);
      else track('tracker_state', props);
    };
    onChange();
    return subscribeFaceEngine(onChange);
  }, [enabled]);

  // Look switches (Frames / Props / Paint / Effects).
  const prevLooks = useRef(looks);
  useEffect(() => {
    if (!enabled) return;
    const p = prevLooks.current;
    prevLooks.current = looks;
    for (const slot of ['frame', 'prop', 'paint', 'effect'] as const) {
      if (p[slot] !== looks[slot]) {
        track('look_switched', {
          slot, from: p[slot], to: looks[slot], camera: watch.current.status,
        });
      }
    }
  }, [enabled, looks.frame, looks.prop, looks.paint, looks.effect]); // eslint-disable-line react-hooks/exhaustive-deps
}
