/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * High-quality video recording via MediaRecorder. Records a MediaStream
 * (typically `canvas.captureStream()` for the filtered composite, plus an
 * optional audio track) to a single Blob, with a hard max-duration cap.
 */
import { convertMp4, isMp4Type, prewarmMp4 } from './mp4Export';

/**
 * Pick the best-supported recording container/codec for this browser.
 *
 * MP4 (H.264) first, because a guest's clip has to open in Photos, WhatsApp
 * and Instagram, and those want MP4 (Dapo, 2026-11-25: "videos ... we get them
 * in MP4, not WebM"). Chrome 126+ (desktop and Android) and Safari record it.
 * AAC sound is asked for first; where the browser only has Opus-in-MP4 the
 * sound is re-encoded to AAC after recording (lib/mp4Export.ts), which also
 * rewrites Chrome's fragmented MP4 as a plain one, so the old "chunked MP4 is
 * corrupt" problem cannot reach a saved file. WebM is the fallback for
 * browsers with no MP4 recorder (older Chrome, Firefox).
 */
export function pickVideoMimeType(): string {
  if (typeof MediaRecorder === 'undefined') return '';
  for (const t of orderVideoCandidates(encoderInfo)) {
    try {
      if (MediaRecorder.isTypeSupported(t)) return t;
    } catch {
      /* ignore */
    }
  }
  return '';
}

/** What the browser says about encoding one codec at the booth's clip size. */
export interface EncoderInfo {
  supported: boolean;
  /** true = a hardware encoder (the browser's "power efficient"). */
  powerEfficient: boolean;
}
export type EncoderInfoMap = Partial<Record<'vp8' | 'vp9' | 'avc1', EncoderInfo>>;

/**
 * Candidate order. VP8 before VP9 by default: the booth encodes WHILE it
 * tracks a face and draws 3D, on a phone. VP9 is a far heavier encoder in
 * software, and its CPU comes straight out of the face tracker, which is what
 * made the live picture lag while recording. Same WebM container, same
 * players; at the booth's 4-5 Mbps a 720p clip looks the same in either.
 *
 * The one exception is measured, not assumed: when the browser reports a
 * HARDWARE VP9 encoder and no hardware VP8 one (primeEncoderInfo), VP9 is the
 * cheaper of the two on that phone and goes first.
 */
export function orderVideoCandidates(info: EncoderInfoMap | null): string[] {
  const vp9Cheaper = info?.vp9?.supported === true && info.vp9.powerEfficient && !(info.vp8?.supported === true && info.vp8.powerEfficient);
  const webm = vp9Cheaper
    ? ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus']
    : ['video/webm;codecs=vp8,opus', 'video/webm;codecs=vp9,opus'];
  return [
    ...MP4_CANDIDATES,
    ...webm,
    'video/webm;codecs=h264,opus',
    'video/webm',
    'video/mp4',
  ];
}

/** H.264 MP4, best sound first. `h264,aac` is the spelling Safari answers to. */
export const MP4_CANDIDATES = [
  'video/mp4;codecs=avc1,mp4a.40.2',
  'video/mp4;codecs=h264,aac',
  'video/mp4;codecs=avc1,opus',
  'video/mp4;codecs=avc1',
];

let encoderInfo: EncoderInfoMap | null = null;
let encoderInfoPromise: Promise<EncoderInfoMap | null> | null = null;

/**
 * Ask the browser (once) whether it encodes VP8 / VP9 in hardware at the clip
 * size. Best-effort: a browser without MediaCapabilities, or one that rejects
 * the question, leaves the default order. Call early (booth mount) so the
 * answer is in by the time a guest records.
 */
export function primeEncoderInfo(width: number, height: number): Promise<EncoderInfoMap | null> {
  if (encoderInfoPromise) return encoderInfoPromise;
  encoderInfoPromise = (async () => {
    const mc = typeof navigator !== 'undefined' ? navigator.mediaCapabilities : undefined;
    if (!mc || typeof mc.encodingInfo !== 'function') return null;
    const ask = async (codec: 'vp8' | 'vp9' | 'avc1'): Promise<EncoderInfo | undefined> => {
      try {
        const r = await mc.encodingInfo({
          type: 'record',
          video: { contentType: codec === 'avc1' ? 'video/mp4;codecs=avc1.42E01F' : `video/webm;codecs=${codec}`, width, height, bitrate: 5_000_000, framerate: 30 },
        });
        return { supported: r.supported === true, powerEfficient: r.powerEfficient === true };
      } catch {
        return undefined;
      }
    };
    const [vp8, vp9, avc1] = await Promise.all([ask('vp8'), ask('vp9'), ask('avc1')]);
    const map: EncoderInfoMap = {};
    if (vp8) map.vp8 = vp8;
    if (vp9) map.vp9 = vp9;
    if (avc1) map.avc1 = avc1;
    encoderInfo = map;
    return map;
  })();
  return encoderInfoPromise;
}

/** "avc1 · hardware" for the tester readout: the codec a clip would use now, and how it encodes. */
export function describeEncoder(): string {
  const mime = pickVideoMimeType();
  if (!mime) return 'none';
  const raw = /codecs=([a-z0-9]+)/i.exec(mime)?.[1] ?? mime.split('/')[1];
  const codec = raw === 'h264' ? 'avc1' : raw;
  const i = codec === 'vp8' || codec === 'vp9' || codec === 'avc1' ? encoderInfo?.[codec] : undefined;
  return i ? `${codec} · ${i.powerEfficient ? 'hardware' : 'software'}` : codec;
}

export function recordingSupported(): boolean {
  return typeof MediaRecorder !== 'undefined' && typeof HTMLCanvasElement.prototype.captureStream === 'function';
}

export interface RecorderOptions {
  maxMs?: number;          // hard cap (default 30s)
  /** Default 5 Mbps — quality/size balance (~18 MB per 30s clip; 10 Mbps
   *  doubled that, painful on guests' cellular uploads). */
  videoBitsPerSecond?: number;
  onTick?: (elapsedMs: number) => void;
  onMaxReached?: () => void;
  /** MediaRecorder emitted an error mid-recording — without this the recording
   *  just silently truncates. Optional and additive: callers that don't pass it
   *  keep the old behavior. */
  onError?: (e: Event) => void;
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
      videoBitsPerSecond: this.opts.videoBitsPerSecond ?? 5_000_000,
    };
    if (this.mimeType) options.mimeType = this.mimeType;
    this.rec = new MediaRecorder(stream, options);
    this.rec.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) this.chunks.push(e.data);
    };
    // Surface mid-recording failures (disk, codec, stream death) — otherwise
    // the recorder just stops emitting chunks and the clip silently truncates.
    this.rec.onerror = (e) => {
      this.opts.onError?.(e);
    };
    this.rec.start(250); // gather chunks periodically so we never lose data
    prewarmMp4(this.mimeType);
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

  /**
   * Stop recording and resolve with the finished clip. An MP4 recording is
   * rewritten as a plain, AAC-sound MP4 first (lib/mp4Export.ts, packets
   * copied, so picture/sound timing is untouched); if that fails for any
   * reason the recording comes back exactly as the browser wrote it.
   * Measure the clip's length BEFORE awaiting this: the tidy takes time.
   */
  async stop(): Promise<Blob> {
    const raw = await this.stopRaw();
    if (!isMp4Type(raw.type) || raw.size === 0) return raw;
    const t0 = performance.now();
    const r = await convertMp4(raw, { level: 'remux' });
    this.lastTidy = `${r.outcome} in ${Math.round(performance.now() - t0)} ms`;
    return r.blob;
  }

  /** "converted in 240 ms" — what stop() did to the last clip (tester readout / logs). */
  lastTidy = '';

  private stopRaw(): Promise<Blob> {
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

/** Just the track state `liveAudioTrack` reads (keeps it testable in node). */
type AudioTrackLike = Pick<MediaStreamTrack, 'readyState' | 'enabled' | 'muted'>;

/**
 * The stream's first audio track if it can actually deliver sound right now.
 * An ended, disabled or muted track records silence, so the booth swaps in a
 * fresh microphone instead of recording a silent clip.
 */
export function liveAudioTrack<T extends AudioTrackLike>(tracks: readonly T[]): T | null {
  return tracks.find((t) => t.readyState === 'live' && t.enabled && !t.muted) ?? null;
}

/**
 * Build a recordable stream from a compositing canvas + optional sound.
 *
 * `audio`: a stream (its first audio track is used) or one track, e.g. the
 * delayed microphone from lib/audioSync.ts.
 *
 * `fps`: a number samples the canvas on the browser's own timer at that rate.
 * null records EVERY frame the canvas draws, for a canvas that already draws
 * at a capped rate: a second 30 Hz timer beside a 30 Hz draw loop drifts
 * against it, so some drawn frames were never recorded and others waited up to
 * a frame (a choppy clip, and a picture that much later than its sound).
 */
export function buildRecordStream(
  canvas: HTMLCanvasElement,
  audio?: MediaStream | MediaStreamTrack | null,
  fps: number | null = 30,
): MediaStream {
  const stream = fps === null ? canvas.captureStream() : canvas.captureStream(fps);
  let audioTrack: MediaStreamTrack | null | undefined;
  if (audio && typeof (audio as MediaStream).getAudioTracks === 'function') audioTrack = (audio as MediaStream).getAudioTracks()[0];
  else audioTrack = audio as MediaStreamTrack | null | undefined;
  if (audioTrack) stream.addTrack(audioTrack);
  return stream;
}
