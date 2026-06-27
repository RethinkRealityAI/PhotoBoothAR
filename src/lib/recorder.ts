/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * High-quality video recording via MediaRecorder. Records a MediaStream
 * (typically `canvas.captureStream()` for the filtered composite, plus an
 * optional audio track) to a single Blob, with a hard max-duration cap.
 */

/**
 * Pick the best-supported recording container/codec for this browser.
 *
 * WebM is preferred over MP4: with timeslice recording the Blob is assembled by
 * concatenating chunks, which is valid for WebM but produces a corrupt file for
 * fragmented MP4 in several browsers (a cause of "videos won't play"). Every
 * preferred option also pairs Opus audio so recordings keep sound. MP4/H.264 is
 * kept last as the Safari fallback (Safari's MediaRecorder only emits MP4).
 */
export function pickVideoMimeType(): string {
  const candidates = [
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm;codecs=h264,opus',
    'video/webm',
    'video/mp4;codecs=h264,aac', // Safari
    'video/mp4',
  ];
  if (typeof MediaRecorder === 'undefined') return '';
  for (const t of candidates) {
    try {
      if (MediaRecorder.isTypeSupported(t)) return t;
    } catch {
      /* ignore */
    }
  }
  return '';
}

export function recordingSupported(): boolean {
  return typeof MediaRecorder !== 'undefined' && typeof HTMLCanvasElement.prototype.captureStream === 'function';
}

export interface RecorderOptions {
  maxMs?: number;          // hard cap (default 30s)
  videoBitsPerSecond?: number; // default ~10 Mbps for high quality
  onTick?: (elapsedMs: number) => void;
  onMaxReached?: () => void;
}

/**
 * Records a stream to a Blob. Call start(stream), then stop() to resolve the Blob.
 * Automatically stops at maxMs.
 */
export class StreamRecorder {
  private rec: MediaRecorder | null = null;
  private chunks: BlobPart[] = [];
  private startTs = 0;
  private tickTimer: ReturnType<typeof setInterval> | null = null;
  private maxTimer: ReturnType<typeof setTimeout> | null = null;
  private stopResolve: ((b: Blob) => void) | null = null;
  readonly mimeType: string;

  constructor(private opts: RecorderOptions = {}) {
    this.mimeType = pickVideoMimeType();
  }

  get recording() {
    return !!this.rec && this.rec.state === 'recording';
  }

  start(stream: MediaStream) {
    if (!recordingSupported()) throw new Error('Recording not supported in this browser');
    this.chunks = [];
    const options: MediaRecorderOptions = {
      videoBitsPerSecond: this.opts.videoBitsPerSecond ?? 10_000_000,
    };
    if (this.mimeType) options.mimeType = this.mimeType;
    this.rec = new MediaRecorder(stream, options);
    this.rec.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) this.chunks.push(e.data);
    };
    this.rec.start(250); // gather chunks periodically so we never lose data
    this.startTs = performance.now();

    this.tickTimer = setInterval(() => {
      this.opts.onTick?.(performance.now() - this.startTs);
    }, 100);

    const maxMs = this.opts.maxMs ?? 30_000;
    this.maxTimer = setTimeout(() => {
      this.opts.onMaxReached?.();
      this.stop();
    }, maxMs);
  }

  /** Stop recording and resolve with the assembled Blob. */
  stop(): Promise<Blob> {
    return new Promise((resolve) => {
      if (!this.rec || this.rec.state === 'inactive') {
        resolve(new Blob(this.chunks, { type: this.blobType() }));
        return;
      }
      this.stopResolve = resolve;
      this.rec.onstop = () => {
        this.cleanupTimers();
        resolve(new Blob(this.chunks, { type: this.blobType() }));
      };
      try {
        // Flush any buffered media so very short clips still produce a valid file.
        if (this.rec.state === 'recording') this.rec.requestData();
        this.rec.stop();
      } catch {
        this.cleanupTimers();
        resolve(new Blob(this.chunks, { type: this.blobType() }));
      }
    });
  }

  private blobType(): string {
    return (this.mimeType || 'video/webm').split(';')[0];
  }

  private cleanupTimers() {
    if (this.tickTimer) clearInterval(this.tickTimer);
    if (this.maxTimer) clearTimeout(this.maxTimer);
    this.tickTimer = null;
    this.maxTimer = null;
  }

  dispose() {
    this.cleanupTimers();
    try {
      if (this.rec && this.rec.state !== 'inactive') this.rec.stop();
    } catch {
      /* ignore */
    }
    this.rec = null;
    this.stopResolve = null;
  }
}

/** Build a recordable stream from a compositing canvas + optional source audio. */
export function buildRecordStream(canvas: HTMLCanvasElement, audioFrom?: MediaStream | null, fps = 30): MediaStream {
  const stream = canvas.captureStream(fps);
  const audioTrack = audioFrom?.getAudioTracks()[0];
  if (audioTrack) stream.addTrack(audioTrack);
  return stream;
}
