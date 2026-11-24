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
  getFrameLockFallbacks,
  getFrameLockLagMs,
  subscribeFaceEngine,
} from '../../lib/faceEngine';
import { trackingReadoutEnabled } from '../../lib/faceEngine/engineSelect';
import { TrackingStatsRing, type TrackingStats } from '../../lib/faceEngine/trackingStats';
import { setRawPoseTap } from '../../lib/faceRig';
import { formatGranted, formatMax } from '../../lib/cameraQuality';
import { boothFrameCounters, resolveBoothFpsCap } from '../../lib/frameBudget';
import { boothPictureClock, cameraDelayMs, smoothedPictureAgeMs } from '../../lib/pictureClock';
import { getAudioSyncStatus } from '../../lib/audioSync';
import { describeEncoder } from '../../lib/recorder';

/** The booth/studio camera element, read straight from the DOM (no prop threading). */
function cameraVideo(): HTMLVideoElement | null {
  const byId = document.getElementById('booth-video');
  if (byId instanceof HTMLVideoElement && byId.srcObject) return byId;
  for (const v of Array.from(document.querySelectorAll('video'))) if (v.srcObject) return v;
  return null;
}

/** "cam 1080×1920 @30 · max 3840×2160 @60" for the tester — what the camera actually granted. */
function readCamera(): string | null {
  const v = cameraVideo();
  const src = v?.srcObject;
  if (!v || !(src instanceof MediaStream)) return null;
  const track = src.getVideoTracks()[0];
  if (!track) return null;
  let granted: string | null = null;
  let max: string | null = null;
  try { granted = formatGranted(track.getSettings()); } catch { granted = null; }
  try { max = typeof track.getCapabilities === 'function' ? formatMax(track.getCapabilities()) : null; } catch { max = null; }
  granted ??= formatGranted({ width: v.videoWidth, height: v.videoHeight });
  if (granted === null) return null;
  return max !== null ? `${granted} · max ${max}` : granted;
}

function readoutEnabled(): boolean {
  if (IS_LEGACY_BUILD || typeof window === 'undefined') return false;
  let store: Storage | null = null;
  try { store = window.sessionStorage; } catch { store = null; }
  return trackingReadoutEnabled(window.location.search, store);
}

/**
 * The camera stream's microphone, for the tester: its state, whether call
 * processing is on, and the peak level it is delivering right now. A mic that
 * says "live" but sits near -100 dB is handing the page silence, which is the
 * "videos have no sound" failure.
 */
class MicMeter {
  private ctx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private trackId = '';
  private buf = new Float32Array(2048);
  /** Browsers start an AudioContext suspended until a tap. */
  private readonly resume = () => { void this.ctx?.resume().catch(() => {}); };

  constructor() { window.addEventListener('pointerdown', this.resume, { passive: true }); }

  read(): string {
    const src = cameraVideo()?.srcObject;
    const track = src instanceof MediaStream ? src.getAudioTracks()[0] : undefined;
    if (!track) return 'none';
    const state = track.readyState === 'ended' ? 'ended' : track.muted ? 'muted' : track.enabled ? 'live' : 'disabled';
    let ec = '';
    try { ec = track.getSettings().echoCancellation ? ' · ec on' : ' · ec off'; } catch { ec = ''; }
    return `${state}${ec} · peak ${this.peakDb(track)}`;
  }

  private peakDb(track: MediaStreamTrack): string {
    try {
      if (track.id !== this.trackId) {
        this.source?.disconnect();
        this.ctx ??= new AudioContext();
        this.analyser ??= this.ctx.createAnalyser();
        this.analyser.fftSize = this.buf.length;
        this.source = this.ctx.createMediaStreamSource(new MediaStream([track]));
        this.source.connect(this.analyser); // analyser only: nothing reaches the speaker
        this.trackId = track.id;
      }
      if (this.ctx?.state !== 'running' || !this.analyser) return 'tap';
      this.analyser.getFloatTimeDomainData(this.buf);
      let peak = 0;
      for (const v of this.buf) peak = Math.max(peak, Math.abs(v));
      return peak > 0 ? `${(20 * Math.log10(peak)).toFixed(0)} dB` : 'silent';
    } catch {
      return '—';
    }
  }

  dispose() {
    window.removeEventListener('pointerdown', this.resume);
    this.source?.disconnect();
    void this.ctx?.close().catch(() => {});
  }
}

const fmt = (v: number | null, digits: number) => (v === null ? '—' : v.toFixed(digits));

export default function TrackingReadout() {
  const [enabled] = useState(readoutEnabled);
  const info = useSyncExternalStore(subscribeFaceEngine, getActiveFaceEngineInfo, getActiveFaceEngineInfo);
  const [stats, setStats] = useState<TrackingStats | null>(null);
  /** Multi-face: [faces tracked now, max] — null when the engine tracks one face only. */
  const [faces, setFaces] = useState<[number, number] | null>(null);
  /** Camera granted size/fps (+ the device max where the browser reports it). */
  const [camera, setCamera] = useState<string | null>(null);
  /** Times the 3D picture fell back to the live camera because tracking stalled. */
  const [lockFallbacks, setLockFallbacks] = useState(0);
  /** How far the locked picture trails the live camera (ms), null when showing live. */
  const [lockLag, setLockLag] = useState<number | null>(null);
  /** Per-second rates: composites drawn, 3D renders, new camera frames. */
  const [fps, setFps] = useState<{ screen: number; r3d: number; cam: number | null } | null>(null);
  /** Microphone state + live peak level (MicMeter). */
  const [mic, setMic] = useState<string | null>(null);
  /** How old the drawn picture is, the sound delay matching it, and the clip encoder. */
  const [sync, setSync] = useState<{ age: number | null; locked: boolean; cam: number; camMeasured: boolean; sound: string; enc: string } | null>(null);

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
    // New camera frames, counted by the browser's own per-frame callback where
    // it exists (Chrome/Safari); null elsewhere.
    let camFrames = 0;
    let camVideo: HTMLVideoElement | null = null;
    let camHandle = 0;
    type RVFC = HTMLVideoElement & { requestVideoFrameCallback?: (cb: () => void) => number; cancelVideoFrameCallback?: (h: number) => void };
    const onCamFrame = () => {
      camFrames++;
      const v = camVideo as RVFC | null;
      if (v?.requestVideoFrameCallback) camHandle = v.requestVideoFrameCallback(onCamFrame);
    };
    const micMeter = new MicMeter();
    let last = { t: performance.now(), composite: boothFrameCounters.composite, render3d: boothFrameCounters.render3d, cam: 0 };
    const id = window.setInterval(() => {
      const now = performance.now();
      const st = ring.stats(now);
      setStats(st);
      const slots = extraFaceSlotCount();
      // The primary counts while it produced a sample in the last second.
      const extras = getExtraFaces().filter((e) => now - e.t < 1000).length;
      setFaces(slots === 0 ? null : [(st.detectionsPerSec ?? 0) > 0 ? 1 + extras : 0, slots + 1]);
      setCamera(readCamera());
      setLockFallbacks(getFrameLockFallbacks());
      setLockLag(getFrameLockLagMs(now));
      setMic(micMeter.read());
      const snd = getAudioSyncStatus();
      setSync({
        age: smoothedPictureAgeMs(boothPictureClock, now),
        locked: boothPictureClock.locked,
        cam: cameraDelayMs(boothPictureClock),
        camMeasured: boothPictureClock.cameraSamples > 0,
        sound: snd === null ? 'off' : snd.state === 'on' ? `${snd.delayMs.toFixed(0)} ms (hop ${snd.hopMs.toFixed(0)})` : 'waiting for a tap',
        enc: describeEncoder(),
      });
      const v = cameraVideo() as RVFC | null;
      if (v !== camVideo) {
        if (camVideo && (camVideo as RVFC).cancelVideoFrameCallback) (camVideo as RVFC).cancelVideoFrameCallback!(camHandle);
        camVideo = v;
        if (v?.requestVideoFrameCallback) camHandle = v.requestVideoFrameCallback(onCamFrame);
      }
      const dt = (now - last.t) / 1000;
      if (dt > 0) {
        setFps({
          screen: (boothFrameCounters.composite - last.composite) / dt,
          r3d: (boothFrameCounters.render3d - last.render3d) / dt,
          cam: camVideo && (camVideo as RVFC).requestVideoFrameCallback ? (camFrames - last.cam) / dt : null,
        });
      }
      last = { t: now, composite: boothFrameCounters.composite, render3d: boothFrameCounters.render3d, cam: camFrames };
    }, 500);
    return () => {
      window.clearInterval(id);
      micMeter.dispose();
      if (camVideo && (camVideo as RVFC).cancelVideoFrameCallback) (camVideo as RVFC).cancelVideoFrameCallback!(camHandle);
      camVideo = null;
      setRawPoseTap(null);
    };
  }, [enabled, info.active]);

  if (!enabled) return null;

  const active = info.active ?? (info.failed ? 'none' : 'loading');
  const cap = resolveBoothFpsCap(window.location.search);
  const capLabel = cap > 0 ? String(cap) : 'off';
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
        {info.frameLock && <span className="tabular-nums"> · stalls→live <b>{lockFallbacks}</b></span>}
        {info.frameLock && <span className="tabular-nums"> · lag <b>{lockLag === null ? 'live' : `${lockLag.toFixed(0)} ms`}</b></span>}
      </div>
      {info.error !== null && <div className="text-brand-muted">error: {info.error}</div>}
      {camera !== null && <div className="tabular-nums">cam: <b>{camera}</b></div>}
      {mic !== null && <div className="tabular-nums">mic: <b>{mic}</b></div>}
      {sync !== null && sync.age !== null && (
        <div className="tabular-nums">
          picture <b>{sync.age.toFixed(0)} ms</b> old
          <span className="text-brand-muted"> ({sync.locked ? 'tracked frame' : 'live camera'} · camera {sync.cam.toFixed(0)}{sync.camMeasured ? '' : ' assumed'})</span>
        </div>
      )}
      {sync !== null && (
        <div className="tabular-nums">sound delay: <b>{sync.sound}</b> · clip: <b>{sync.enc}</b></div>
      )}
      {faces !== null && <div className="tabular-nums">faces: <b>{faces[0]}</b>/{faces[1]}</div>}
      {fps !== null && (
        <div className="tabular-nums">
          screen <b>{fps.screen.toFixed(0)}</b> · 3D <b>{fps.r3d.toFixed(0)}</b>
          {fps.cam !== null && <> · cam <b>{fps.cam.toFixed(0)}</b></>} fps
          <span className="text-brand-muted"> (cap {capLabel})</span>
        </div>
      )}
      <div className="tabular-nums">
        {fmt(stats?.detectionsPerSec ?? null, 1)} det/s · pos ±{fmt(stats?.posJitterCm ?? null, 2)} cm · rot ±{fmt(stats?.rotJitterDeg ?? null, 2)}°
      </div>
    </div>
  );
}
