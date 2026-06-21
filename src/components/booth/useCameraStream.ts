/**
 * Hook: acquire and manage the camera stream.
 * Supports front/back flip via facingMode prop, audio for video mode,
 * and highest-quality acquisition via camera.ts getCameraStream.
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
        setStream(localStream);
        // Now that permission is granted, device labels are available — confirm
        // whether a flip is genuinely possible.
        hasMultipleCameras().then((multi) => { if (!cancelled && multi) setCanFlip(true); }).catch(() => {});
        if (videoRef.current) {
          videoRef.current.srcObject = localStream;
          videoRef.current.onloadedmetadata = () => {
            if (!cancelled) setReady(true);
          };
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
      setStream(null);
      setReady(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [retryTick, enabled, facingMode, withAudio]);

  const retry = useCallback(() => {
    retryCounter.current += 1;
    setRetryTick(retryCounter.current);
  }, []);

  const flipCamera = useCallback(() => {
    setFacingMode((prev) => (prev === 'user' ? 'environment' : 'user'));
  }, []);

  return { videoRef, stream, ready, error, retry, facingMode, flipCamera, canFlip };
}
