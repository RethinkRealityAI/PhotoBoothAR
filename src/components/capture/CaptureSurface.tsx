/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * CaptureSurface — reusable, event-agnostic camera capture core.
 *
 * DESIGN CHOICE (Phase 5): this is a deliberately SIMPLER standalone built on
 * the same primitives as the booth (useCameraStream / lib/camera.ts for
 * acquisition, lib/recorder.ts StreamRecorder for video) rather than an
 * extraction of Booth's StageCanvas pipeline. Card contributions don't need
 * the AR/shader/3D stack, and extracting StageCanvas cleanly risked Booth
 * regressions — so Booth keeps its own composition untouched, and this
 * component renders a plain <video> preview and captures via a one-shot
 * canvas draw (photo) or by recording the raw camera stream (video).
 *
 * Works OUTSIDE EventProvider (no store/theme dependencies) — safe on the
 * public /c/... routes.
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { motion } from 'motion/react';
import { AlertTriangle, RefreshCw, SwitchCamera } from 'lucide-react';
import { useCameraStream } from '../booth/useCameraStream';
import { streamResolution } from '../../lib/camera';
import { StreamRecorder, recordingSupported } from '../../lib/recorder';

export interface CaptureMeta {
  mediaType: 'photo' | 'video';
  /** Video only — measured wall-clock duration. */
  durationMs?: number;
  width: number;
  height: number;
}

interface Props {
  mode: 'photo' | 'video';
  /** Hard video cap in seconds (default 30). */
  maxVideoSec?: number;
  onCapture: (blob: Blob, meta: CaptureMeta) => void;
  /** Optional overlay chrome rendered above the preview (non-interactive area). */
  children?: ReactNode;
  /**
   * Reserved for API parity with the booth stack. The standalone surface
   * never bakes a signature into captures (cards are not watermarked), so
   * this is currently a no-op.
   */
  watermark?: boolean;
  className?: string;
}

export default function CaptureSurface({
  mode,
  maxVideoSec = 30,
  onCapture,
  children,
  watermark = false,
  className = '',
}: Props) {
  void watermark; // see prop doc — intentionally unused in the standalone surface

  const { videoRef, stream, ready, error, retry, facingMode, flipCamera, canFlip } =
    useCameraStream(true, mode === 'video');
  const isFront = facingMode === 'user';

  const streamRef = useRef<MediaStream | null>(null);
  useEffect(() => {
    streamRef.current = stream;
  }, [stream]);

  // ── Video recording ────────────────────────────────────────────────
  const maxMs = maxVideoSec * 1000;
  const recorderRef = useRef<StreamRecorder | null>(null);
  const recordStartRef = useRef(0);
  const [recording, setRecording] = useState(false);
  const [recordingMs, setRecordingMs] = useState(0);
  const canRecord = recordingSupported();

  const stopRecording = useCallback(async (recOverride?: StreamRecorder) => {
    const rec = recOverride ?? recorderRef.current;
    if (!rec) return;
    recorderRef.current = null;
    const blob = await rec.stop();
    rec.dispose();
    const durationMs = Math.max(0, Math.round(performance.now() - recordStartRef.current));
    setRecording(false);
    setRecordingMs(0);
    const { width, height } = streamRef.current
      ? streamResolution(streamRef.current)
      : { width: 1280, height: 720 };
    onCapture(blob, { mediaType: 'video', durationMs, width, height });
  }, [onCapture]);

  const startRecording = useCallback(() => {
    const s = streamRef.current;
    if (!s || recorderRef.current || !canRecord) return;
    setRecording(true);
    setRecordingMs(0);
    recordStartRef.current = performance.now();
    const rec = new StreamRecorder({
      maxMs,
      onTick: (ms) => setRecordingMs(ms),
      onMaxReached: () => stopRecording(rec),
    });
    recorderRef.current = rec;
    // Record the raw camera stream (video + mic) — no compositing needed here.
    rec.start(s);
  }, [canRecord, maxMs, stopRecording]);

  // Cleanup on unmount / mode change — also resets the recording UI in case
  // the caller flips modes mid-recording.
  useEffect(() => {
    return () => {
      recorderRef.current?.dispose();
      recorderRef.current = null;
      setRecording(false);
      setRecordingMs(0);
    };
  }, [mode]);

  // ── Photo capture ──────────────────────────────────────────────────
  const capturePhoto = useCallback(() => {
    const video = videoRef.current;
    if (!video || video.readyState < 2) return;
    const w = video.videoWidth || 1280;
    const h = video.videoHeight || 720;
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    // Match the mirrored preview so what-you-see-is-what-you-get.
    if (isFront) {
      ctx.translate(w, 0);
      ctx.scale(-1, 1);
    }
    ctx.drawImage(video, 0, 0, w, h);
    canvas.toBlob(
      (blob) => {
        if (blob) onCapture(blob, { mediaType: 'photo', width: w, height: h });
      },
      'image/jpeg',
      0.9,
    );
  }, [videoRef, isFront, onCapture]);

  const handleShutter = useCallback(() => {
    if (mode === 'photo') {
      capturePhoto();
    } else if (recording) {
      stopRecording();
    } else {
      startRecording();
    }
  }, [mode, recording, capturePhoto, startRecording, stopRecording]);

  // ── Progress ring geometry ─────────────────────────────────────────
  const recordProgress = Math.min(recordingMs / maxMs, 1);
  const ringCircumference = 2 * Math.PI * 26;

  // ── Error state ────────────────────────────────────────────────────
  if (error) {
    return (
      <div className={`relative flex flex-col items-center justify-center gap-4 rounded-2xl bg-white/[0.03] border border-white/10 p-8 text-center ${className}`}>
        <AlertTriangle className="w-8 h-8 text-gold-400" strokeWidth={1.5} />
        <p className="font-sans text-sm text-brand-muted/80 leading-relaxed max-w-xs">
          {error === 'NotAllowedError'
            ? 'Camera access was blocked. Allow it in your browser settings, then retry.'
            : error === 'NotFoundError'
              ? 'No camera was found on this device.'
              : 'The camera could not be started.'}
        </p>
        <button
          onClick={retry}
          className="flex items-center gap-2 rounded-full bg-white/[0.08] hover:bg-white/[0.14] px-5 py-2.5 font-label uppercase tracking-luxe text-[10px] text-brand-fg transition"
        >
          <RefreshCw className="w-3.5 h-3.5" /> Retry
        </button>
      </div>
    );
  }

  return (
    <div className={`relative overflow-hidden rounded-2xl bg-black ${className}`}>
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        className="absolute inset-0 w-full h-full object-cover"
        style={{ transform: isFront ? 'scaleX(-1)' : 'none' }}
      />

      {!ready && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/60">
          <div className="flex flex-col items-center gap-3">
            <div className="w-9 h-9 rounded-full border-2 border-white/10 border-t-[color:var(--color-accent)] animate-spin" />
            <p className="font-label uppercase tracking-luxe text-[9px] text-brand-muted/60">Starting camera…</p>
          </div>
        </div>
      )}

      {/* Caller overlay (hints, frames) */}
      {children}

      {/* Recording pill */}
      {recording && (
        <div className="absolute top-3 left-1/2 -translate-x-1/2 flex items-center gap-1.5 rounded-full bg-black/55 px-3 py-1">
          <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
          <span className="font-label text-[10px] uppercase tracking-wide text-red-400">
            {Math.floor(recordingMs / 1000)}s / {maxVideoSec}s
          </span>
        </div>
      )}

      {/* Controls */}
      {ready && (
        <div className="absolute bottom-0 left-0 right-0 flex items-center justify-between px-5 pb-4 pt-10 bg-gradient-to-t from-black/70 to-transparent">
          <div className="w-11">
            {canFlip && !recording && (
              <button
                onClick={flipCamera}
                title="Switch camera"
                aria-label="Switch camera"
                className="w-11 h-11 rounded-full bg-white/[0.12] backdrop-blur flex items-center justify-center text-white/80 hover:text-white transition active:scale-90"
              >
                <SwitchCamera className="w-5 h-5" />
              </button>
            )}
          </div>

          {mode === 'photo' ? (
            <motion.button
              onClick={handleShutter}
              whileTap={{ scale: 0.88 }}
              aria-label="Take photo"
              className="relative w-16 h-16 rounded-full bg-white/90 flex items-center justify-center"
            >
              <span className="absolute inset-1.5 rounded-full border-2 border-black/25" />
            </motion.button>
          ) : !canRecord ? (
            <p className="font-sans text-[11px] text-white/70 text-center max-w-[12rem]">
              Video recording isn't supported in this browser — upload a file instead.
            </p>
          ) : recording ? (
            <div className="relative w-16 h-16">
              <svg className="absolute inset-0 -rotate-90" width="64" height="64" viewBox="0 0 64 64">
                <circle cx="32" cy="32" r="26" fill="none" stroke="rgba(255,255,255,0.2)" strokeWidth="3" />
                <circle
                  cx="32" cy="32" r="26" fill="none" stroke="#ef4444" strokeWidth="3" strokeLinecap="round"
                  strokeDasharray={ringCircumference}
                  strokeDashoffset={ringCircumference * (1 - recordProgress)}
                  style={{ transition: 'stroke-dashoffset 0.1s linear' }}
                />
              </svg>
              <button
                onClick={handleShutter}
                aria-label="Stop recording"
                className="relative w-16 h-16 rounded-full flex items-center justify-center"
              >
                <span className="w-6 h-6 rounded-md bg-red-500" />
              </button>
            </div>
          ) : (
            <motion.button
              onClick={handleShutter}
              whileTap={{ scale: 0.88 }}
              aria-label="Start recording"
              className="relative w-16 h-16 rounded-full border-4 border-red-500 flex items-center justify-center"
              style={{ background: 'rgba(239,68,68,0.15)' }}
            >
              <span className="w-5 h-5 rounded-full bg-red-500" />
            </motion.button>
          )}

          <div className="w-11" />
        </div>
      )}
    </div>
  );
}
