/**
 * Hook: acquire and manage the camera stream.
 * Supports front/back flip via facingMode prop, audio for video mode,
 * and highest-quality acquisition via camera.ts getCameraStream.
 *
 * Resilience: browsers (especially iOS Safari) pause the <video> or end the
 * camera track when the tab is backgrounded, and do NOT auto-resume — the feed
 * would otherwise stay frozen on the last frame until a manual refresh. We
 * therefore (a) explicitly play() the element, (b) resume playback when the page
 * becomes visible again, and (c) re-acquire the stream when its track ends,
 * stays muted, or stops delivering frames (lib/cameraHealth.ts decides; never
 * while the page is hidden, where getUserMedia can hang or be refused).
 *
 * Returns { videoRef, stream, ready, error, retry, facingMode, flipCamera,
 *           canFlip }
 */
import { useRef, useEffect, useState, useCallback } from 'react';
import {
  acquireMicTrack, getCameraStream, hasMultipleCameras, stopStream, classifyCameraError,
  type Facing, type CameraFailure,
} from '../../lib/camera';
import {
  cameraHealthVerdict, tickIsTrustworthy, STALL_PLAY_MS, type CameraReacquireReason,
} from '../../lib/cameraHealth';

/** How often the camera watchdog samples the stream. */
const WATCHDOG_PERIOD_MS = 1_000;

/** Something the hook did on its own to bring the camera back (for telemetry). */
export interface CameraIncident {
  kind: 'reacquire' | 'give-up';
  reason: CameraReacquireReason;
  /** Re-opens since the picture was last healthy, including this one. */
  attempt: number;
}

/** Kept as the exported name every consumer (CameraError screen, Booth)
 *  already imports; the vocabulary itself lives in lib/camera.ts. */
export type CameraError = CameraFailure;

interface UseCameraStream {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  stream: MediaStream | null;
  /** The microphone on `stream` while `withAudio` is on (null = none yet / refused). */
  micTrack: MediaStreamTrack | null;
  ready: boolean;
  error: CameraError | null;
  retry: () => void;
  facingMode: Facing;
  flipCamera: () => void;
  canFlip: boolean;
}

/**
 * A camera owned by someone else (world mode: 8th Wall opens the back camera
 * for its floor tracking). `acquire` replaces getCameraStream; `release`
 * replaces stopping the tracks. Changing `key` reopens the camera.
 */
export interface CameraSourceOverride {
  key: string;
  facing: Facing;
  acquire: () => Promise<MediaStream>;
  release: (stream: MediaStream) => void;
}

/** False only while the page is hidden (no document = tests/SSR = visible). */
function nowVisible(): boolean {
  return typeof document === 'undefined' || document.visibilityState !== 'hidden';
}

/**
 * `primeMic`: ask for the microphone in the same prompt as the camera when the
 * stream first opens (lib/camera.ts), so video mode never prompts later. Read
 * when the camera opens; changing it never restarts the camera.
 */
export function useCameraStream(
  enabled = true, withAudio = false, primeMic = false,
  opts: {
    initialFacing?: Facing;
    source?: CameraSourceOverride | null;
    /** Told when the hook re-opens the camera by itself (Booth logs it on the platform). */
    onIncident?: (incident: CameraIncident) => void;
  } = {},
): UseCameraStream {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [micTrack, setMicTrack] = useState<MediaStreamTrack | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<CameraError | null>(null);
  const [facingMode, setFacingMode] = useState<Facing>(opts.source?.facing ?? opts.initialFacing ?? 'user');
  const [canFlip, setCanFlip] = useState(false);
  const retryCounter = useRef(0);
  const [retryTick, setRetryTick] = useState(0);
  const streamRef = useRef<MediaStream | null>(null);
  const primeMicRef = useRef(primeMic);
  primeMicRef.current = primeMic;
  const sourceRef = useRef(opts.source ?? null);
  sourceRef.current = opts.source ?? null;
  const sourceKey = opts.source?.key ?? '';
  /** One combined prompt per page: a camera flip or re-acquire asks for the picture only. */
  const micPrimedRef = useRef(false);
  const onIncidentRef = useRef(opts.onIncident);
  onIncidentRef.current = opts.onIncident;
  /** Self-healing bookkeeping (lib/cameraHealth.ts): survives the camera effect's re-runs. */
  const healRef = useRef({ lastReacquireAt: Number.NEGATIVE_INFINITY, inARow: 0 });

  const bump = useCallback(() => {
    retryCounter.current += 1;
    setRetryTick(retryCounter.current);
  }, []);
  /** The guest's own retry (error screen): a fresh start for the self-healing budget. */
  const retry = useCallback(() => {
    healRef.current.inARow = 0;
    bump();
  }, [bump]);
  /** The hook re-opening the camera by itself. */
  const reacquire = useCallback((reason: CameraReacquireReason) => {
    const h = healRef.current;
    h.lastReacquireAt = performance.now();
    h.inARow += 1;
    onIncidentRef.current?.({ kind: 'reacquire', reason, attempt: h.inARow });
    bump();
  }, [bump]);

  // Best-effort play() — autoplay can be denied/interrupted; call it explicitly.
  const playVideo = useCallback(() => {
    const v = videoRef.current;
    if (v) v.play().catch(() => { /* a later user gesture / visibility resume retries */ });
  }, []);

  // Decide whether to show the flip button. enumerateDevices() is unreliable
  // BEFORE camera permission (mobile Safari often reports a single unlabeled
  // device), so we (a) treat any mobile/touch device as flip-capable up-front,
  // and (b) re-check after the stream is acquired (labels populate then).
  useEffect(() => {
    let alive = true;
    const isMobile =
      typeof navigator !== 'undefined' &&
      (/Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent) ||
        (typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches));
    if (isMobile) setCanFlip(true);
    hasMultipleCameras()
      .then((multi) => { if (alive && multi) setCanFlip(true); })
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    let localStream: MediaStream | null = null;

    setError(null);
    setReady(false);

    async function start() {
      try {
        const prime = primeMicRef.current && !micPrimedRef.current;
        micPrimedRef.current = micPrimedRef.current || prime;
        const src = sourceRef.current;
        localStream = src
          ? await src.acquire()
          : await getCameraStream({ facingMode, primeMic: prime }); // the microphone itself joins below
        if (cancelled) {
          if (src) src.release(localStream); else stopStream(localStream);
          return;
        }
        streamRef.current = localStream;
        setStream(localStream);
        hasMultipleCameras().then((multi) => { if (!cancelled && multi) setCanFlip(true); }).catch(() => {});

        // Re-acquire if the camera track ends (OS reclaimed it). Not from a
        // hidden page: getUserMedia there can hang or be refused, which is how
        // a guest came back to a dark booth. The visibility handler below
        // re-opens it the moment they return. (A track that stays muted is the
        // watchdog's job.)
        for (const track of localStream.getVideoTracks()) {
          track.onended = () => { if (!cancelled && nowVisible()) reacquire('ended'); };
        }

        if (videoRef.current) {
          videoRef.current.srcObject = localStream;
          videoRef.current.onloadedmetadata = () => {
            if (cancelled) return;
            setReady(true);
            playVideo();
          };
          playVideo();
        }
      } catch (err: unknown) {
        if (cancelled) return;
        // Full taxonomy (lib/camera.classifyCameraError): permission, missing
        // hardware, camera-held-by-another-app (NotReadable), overconstrained,
        // and the typed webview/insecure-context pre-flight throw — each gets
        // its own copy on the error screen instead of a generic retry.
        setError(classifyCameraError(err));
      }
    }

    start();

    const ownedBy = sourceRef.current;
    return () => {
      cancelled = true;
      if (localStream) { if (ownedBy) ownedBy.release(localStream); else stopStream(localStream); }
      if (videoRef.current) videoRef.current.srcObject = null;
      streamRef.current = null;
      setStream(null);
      setReady(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [retryTick, enabled, facingMode, reacquire, playVideo, sourceKey]);

  // The microphone joins and leaves the RUNNING camera stream. It used to be a
  // dependency of the camera effect above, so switching photo -> video stopped
  // the camera and started it again: a blank preview, the face tracker reset,
  // and the guest out of the flow. Now only the microphone opens (the browser
  // asks for it the first time), the picture never stops, and going back to
  // photo releases the microphone so its indicator goes off.
  useEffect(() => {
    if (!withAudio || !stream) return;
    let cancelled = false;
    let mine: MediaStreamTrack | null = null;
    void acquireMicTrack().then((track) => {
      if (!track) return; // refused or missing: recording says so and retries at the record tap
      if (cancelled) { track.stop(); return; }
      mine = track;
      for (const old of stream.getAudioTracks()) { stream.removeTrack(old); old.stop(); }
      stream.addTrack(track);
      setMicTrack(track);
    });
    return () => {
      cancelled = true;
      if (mine) {
        try { stream.removeTrack(mine); } catch { /* stream already torn down */ }
        mine.stop();
      }
      setMicTrack(null);
    };
  }, [withAudio, stream]);

  // Resume when the tab/app returns to the foreground. If the track died while
  // hidden, re-acquire; otherwise just resume the paused element (a track that
  // stays muted after the return is re-opened by the watchdog below).
  useEffect(() => {
    if (!enabled) return;
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      const track = streamRef.current?.getVideoTracks()[0];
      if (!streamRef.current || !track || track.readyState === 'ended') {
        if (streamRef.current) reacquire('ended'); else bump(); // no stream: open one, as before
      } else {
        playVideo();
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    window.addEventListener('pageshow', onVisible);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
      window.removeEventListener('pageshow', onVisible);
    };
  }, [enabled, reacquire, bump, playVideo]);

  // ── Watchdog ──────────────────────────────────────────────────────────
  // Once a second, while the camera is open: is it muted, frozen or gone?
  // lib/cameraHealth.ts decides (play() first, then re-open, spaced out and
  // capped; never while hidden). Our own camera only: a camera another engine
  // owns (world mode's 8th Wall) is left to that engine.
  useEffect(() => {
    if (!enabled || !ready || !stream || sourceKey !== '') return;
    const track = stream.getVideoTracks()[0];
    if (!track) return;
    const video = videoRef.current;
    let mutedSince = track.muted ? performance.now() : 0;
    const onMute = () => { if (mutedSince === 0) mutedSince = performance.now(); };
    const onUnmute = () => { mutedSince = 0; };
    track.addEventListener('mute', onMute);
    track.addEventListener('unmute', onUnmute);

    let lastFrameAt = performance.now();
    /** A frame arrived since this stream opened (a re-open only counts as healed then). */
    let sawFrame = false;
    let lastTime = video?.currentTime ?? 0;
    let rvfc = 0;
    const hasRvfc = !!video && typeof video.requestVideoFrameCallback === 'function';
    const onFrame = () => {
      lastFrameAt = performance.now();
      sawFrame = true;
      if (video) rvfc = video.requestVideoFrameCallback(onFrame);
    };
    if (hasRvfc) rvfc = video!.requestVideoFrameCallback(onFrame);

    let lastTick = performance.now();
    let gaveUp = false;
    const id = window.setInterval(() => {
      const now = performance.now();
      const onTime = tickIsTrustworthy(now - lastTick, WATCHDOG_PERIOD_MS);
      lastTick = now;
      const visible = nowVisible();
      if (!hasRvfc && video && video.currentTime !== lastTime) { lastTime = video.currentTime; lastFrameAt = now; sawFrame = true; }
      // Hidden time and a late tick never count as a frozen camera.
      if (!visible || !onTime) { lastFrameAt = now; if (!visible) return; }
      const h = healRef.current;
      const mutedForMs = mutedSince === 0 ? 0 : now - mutedSince;
      const stalled = now - lastFrameAt;
      if (sawFrame && mutedForMs === 0 && stalled < STALL_PLAY_MS) h.inARow = 0; // healthy again
      const verdict = cameraHealthVerdict({
        visible,
        track: track.readyState,
        mutedForMs,
        frameStalledMs: stalled,
        sinceReacquireMs: now - h.lastReacquireAt,
        reacquiresInARow: h.inARow,
      });
      if (verdict.action === 'play') playVideo();
      else if (verdict.action === 'reacquire' && verdict.reason) reacquire(verdict.reason);
      else if (verdict.action === 'give-up' && verdict.reason && !gaveUp) {
        gaveUp = true;
        onIncidentRef.current?.({ kind: 'give-up', reason: verdict.reason, attempt: h.inARow });
        // The camera will not come back by itself (usually another app or tab
        // holds it): say so, with the error screen's Try again, instead of a
        // dark booth.
        setError('NotReadableError');
      }
    }, WATCHDOG_PERIOD_MS);
    return () => {
      window.clearInterval(id);
      track.removeEventListener('mute', onMute);
      track.removeEventListener('unmute', onUnmute);
      if (hasRvfc && rvfc) video!.cancelVideoFrameCallback(rvfc);
    };
  }, [enabled, ready, stream, sourceKey, reacquire, playVideo]);

  const flipCamera = useCallback(() => {
    setFacingMode((prev) => (prev === 'user' ? 'environment' : 'user'));
  }, []);

  return { videoRef, stream, micTrack, ready, error, retry, facingMode, flipCamera, canFlip };
}
