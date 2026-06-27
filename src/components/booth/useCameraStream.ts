/**
 * Hook: acquire and manage the camera stream.
 * Supports front/back flip via facingMode prop, audio for video mode,
 * and highest-quality acquisition via camera.ts getCameraStream.
 *
 * Resilience: browsers (especially iOS Safari) pause the <video> or end the
 * camera track when the tab is backgrounded, and do NOT auto-resume — the feed
 * would otherwise stay frozen on the last frame until a manual refresh. We
 * therefore (a) explicitly play() the element, (b) resume playback when the page
 * becomes visible again, and (c) re-acquire the stream when its track ends/mutes.
 *
 * Returns { videoRef, stream, ready, error, retry, facingMode, flipCamera,
 *           canFlip }
 */
import { useRef, useEffect, useState, useCallback } from 'react';
import { getCameraStream, hasMultipleCameras, stopStream, Facing } from '../../lib/camera';

export type CameraError = 'NotAllowedError' | 'NotFoundError' | 'unknown';

interface UseCameraStream {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  stream: MediaStream | null;
  ready: boolean;
  error: CameraError | null;
  retry: () => void;
  facingMode: Facing;
  flipCamera: () => void;
  canFlip: boolean;
}

export function useCameraStream(enabled = true, withAudio = false): UseCameraStream {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<CameraError | null>(null);
  const [facingMode, setFacingMode] = useState<Facing>('user');
  const [canFlip, setCanFlip] = useState(false);
  const retryCounter = useRef(0);
  const [retryTick, setRetryTick] = useState(0);
  const streamRef = useRef<MediaStream | null>(null);

  const retry = useCallback(() => {
    retryCounter.current += 1;
    setRetryTick(retryCounter.current);
  }, []);

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
        localStream = await getCameraStream({ facingMode, withAudio });
        if (cancelled) {
          stopStream(localStream);
          return;
        }
        streamRef.current = localStream;
        setStream(localStream);
        hasMultipleCameras().then((multi) => { if (!cancelled && multi) setCanFlip(true); }).catch(() => {});

        // Re-acquire if the camera track ends (OS reclaimed it on background) or
        // stays muted — these don't recover on their own.
        for (const track of localStream.getVideoTracks()) {
          track.onended = () => { if (!cancelled) retry(); };
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
        const name = (err as Error).name;
        if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
          setError('NotAllowedError');
        } else if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
          setError('NotFoundError');
        } else {
          setError('unknown');
        }
      }
    }

    start();

    return () => {
      cancelled = true;
      if (localStream) stopStream(localStream);
      if (videoRef.current) videoRef.current.srcObject = null;
      streamRef.current = null;
      setStream(null);
      setReady(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [retryTick, enabled, facingMode, withAudio, retry, playVideo]);

  // Resume when the tab/app returns to the foreground. If the track died while
  // hidden, re-acquire; otherwise just resume the paused element.
  useEffect(() => {
    if (!enabled) return;
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      const track = streamRef.current?.getVideoTracks()[0];
      if (!streamRef.current || !track || track.readyState === 'ended') {
        retry();
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
  }, [enabled, retry, playVideo]);

  const flipCamera = useCallback(() => {
    setFacingMode((prev) => (prev === 'user' ? 'environment' : 'user'));
  }, []);

  return { videoRef, stream, ready, error, retry, facingMode, flipCamera, canFlip };
}
